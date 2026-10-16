const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const db = require('./db');
const { daily, SIGNS } = require('./horoscope');
const { seedIfEmpty } = require('./seed');
const { chartFor } = require('./jathagam');

const PORT = process.env.PORT || 4000;
const DEV_OTP = '1234';                 // Replace with an SMS provider (Twilio, MSG91…) in production
const ASTROLOGER_SHARE = 0.7;           // Astrologer keeps 70% of each minute billed
const MIN_START_MINUTES = 3;            // Customer needs balance for this many minutes to start a chat
const REQUEST_TIMEOUT_MS = 60 * 1000;   // Unanswered requests expire after a minute
const BILLING_INTERVAL_MS = Number(process.env.BILLING_INTERVAL_MS) || 60 * 1000;

const { data, save } = db;
seedIfEmpty();

// Sessions that were live when the server stopped can't be billed any more; close them out.
for (const s of data.sessions) {
  if (s.status === 'active') Object.assign(s, { status: 'ended', endedAt: db.now(), endReason: 'server_restart' });
  if (s.status === 'requested') Object.assign(s, { status: 'missed', endedAt: db.now() });
}
save();

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- helpers ----------

const findUser = (id) => data.users.find((u) => u.id === id);
const findSession = (id) => data.sessions.find((s) => s.id === id);
const round2 = (n) => Math.round(n * 100) / 100;

function publicAstrologer(a) {
  const busy = data.sessions.some((s) => s.astrologerId === a.id && s.status === 'active');
  const { phone, earnings, ...rest } = a;
  return { ...rest, busy };
}

function publicCustomer(c) {
  const { phone, wallet, ...rest } = c;
  return rest;
}

const selfView = (u) => u; // the owner sees everything on their own record

function sessionView(s) {
  const customer = findUser(s.customerId);
  const astrologer = findUser(s.astrologerId);
  return {
    ...s,
    customer: customer && { id: customer.id, name: customer.name, sign: customer.sign, birthDate: customer.birthDate, birthTime: customer.birthTime, birthPlace: customer.birthPlace, gender: customer.gender },
    astrologer: astrologer && { id: astrologer.id, name: astrologer.name, avatarColor: astrologer.avatarColor, ratePerMin: astrologer.ratePerMin },
  };
}

const emitToUser = (userId, event, payload) => io.to(`user:${userId}`).emit(event, payload);

function broadcastSession(s) {
  const view = sessionView(s);
  emitToUser(s.customerId, 'session:update', view);
  emitToUser(s.astrologerId, 'session:update', view);
}

function broadcastAstrologer(a) {
  io.emit('astrologer:update', publicAstrologer(a));
}

function addTransaction(userId, type, amount, note, sessionId) {
  const tx = { id: db.id(), userId, type, amount: round2(amount), note, sessionId, createdAt: db.now() };
  data.transactions.push(tx);
  return tx;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// Wrap handlers so thrown HttpErrors become JSON responses.
const h = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
};

function auth(role) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const user = findUser(data.tokens[token]);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    if (role && user.role !== role) return res.status(403).json({ error: `Only ${role}s can do this` });
    req.user = user;
    req.token = token;
    next();
  };
}

// ---------- billing / session lifecycle ----------

const timers = new Map(); // sessionId -> { request?: Timeout, billing?: Interval }

function clearTimers(sessionId) {
  const t = timers.get(sessionId);
  if (!t) return;
  clearTimeout(t.request);
  clearInterval(t.billing);
  timers.delete(sessionId);
}

// Charge one minute. Returns false if the customer can't afford it.
function billMinute(s) {
  const customer = findUser(s.customerId);
  const astrologer = findUser(s.astrologerId);
  if (customer.wallet < s.ratePerMin) return false;
  customer.wallet = round2(customer.wallet - s.ratePerMin);
  astrologer.earnings = round2((astrologer.earnings || 0) + s.ratePerMin * ASTROLOGER_SHARE);
  s.billedMinutes += 1;
  s.amount = round2(s.amount + s.ratePerMin);
  s.astrologerEarning = round2(s.astrologerEarning + s.ratePerMin * ASTROLOGER_SHARE);
  emitToUser(customer.id, 'wallet:update', { balance: customer.wallet });
  emitToUser(astrologer.id, 'earnings:update', { earnings: astrologer.earnings });
  save();
  return true;
}

function endSession(s, reason) {
  if (!['active', 'requested'].includes(s.status)) return s;
  clearTimers(s.id);
  const wasActive = s.status === 'active';
  s.status = wasActive ? 'ended' : reason === 'timeout' ? 'missed' : reason === 'rejected' ? 'rejected' : 'cancelled';
  s.endedAt = db.now();
  s.endReason = reason;
  if (wasActive && s.amount > 0) {
    addTransaction(s.customerId, 'debit', -s.amount, `Chat with ${findUser(s.astrologerId).name} (${s.billedMinutes} min)`, s.id);
    addTransaction(s.astrologerId, 'credit', s.astrologerEarning, `Chat with ${findUser(s.customerId).name} (${s.billedMinutes} min)`, s.id);
  }
  save();
  broadcastSession(s);
  broadcastAstrologer(findUser(s.astrologerId));
  return s;
}

function startSession(s) {
  s.status = 'active';
  s.startedAt = db.now();
  clearTimers(s.id);
  if (!billMinute(s)) return endSession(s, 'insufficient_balance');
  const billing = setInterval(() => {
    if (!billMinute(s)) endSession(s, 'insufficient_balance');
  }, BILLING_INTERVAL_MS);
  timers.set(s.id, { billing });
  save();
  broadcastSession(s);
  broadcastAstrologer(findUser(s.astrologerId));
  return s;
}

function postMessage(s, sender, text) {
  text = String(text || '').trim().slice(0, 2000);
  if (!text) fail(400, 'Message is empty');
  if (s.status !== 'active') fail(400, 'This chat is not active');
  if (![s.customerId, s.astrologerId].includes(sender.id)) fail(403, 'Not your chat');
  const msg = { id: db.id(), sessionId: s.id, senderId: sender.id, senderRole: sender.role, text, createdAt: db.now() };
  data.messages.push(msg);
  save();
  emitToUser(s.customerId, 'message:new', msg);
  emitToUser(s.astrologerId, 'message:new', msg);
  return msg;
}

// ---------- auth ----------

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/auth/request-otp', h((req) => {
  const phone = String(req.body.phone || '').replace(/\D/g, '');
  if (phone.length < 10) fail(400, 'Enter a valid phone number');
  // In production: generate a random code, store a hash with expiry, and send it by SMS.
  return { ok: true, devOtp: DEV_OTP };
}));

app.post('/auth/verify', h((req) => {
  const phone = String(req.body.phone || '').replace(/\D/g, '');
  const { otp, role } = req.body;
  if (!['customer', 'astrologer'].includes(role)) fail(400, 'Invalid role');
  if (otp !== DEV_OTP) fail(401, 'Incorrect OTP');

  let user = data.users.find((u) => u.phone === phone && u.role === role);
  let isNew = false;
  if (!user) {
    isNew = true;
    user = role === 'customer'
      ? { id: db.id(), phone, role, name: '', gender: '', birthDate: '', birthTime: '', birthPlace: '', sign: '', wallet: 0, createdAt: db.now() }
      : {
          id: db.id(), phone, role, name: '', bio: '', skills: [], languages: [], experienceYears: 0,
          ratePerMin: 20, online: false, rating: 0, ratingCount: 0, earnings: 0,
          avatarColor: ['#7C3AED', '#DB2777', '#EA580C', '#0891B2', '#16A34A'][Math.floor(Math.random() * 5)],
          createdAt: db.now(),
        };
    data.users.push(user);
  }
  const token = crypto.randomBytes(24).toString('hex');
  data.tokens[token] = user.id;
  save();
  return { token, user: selfView(user), isNew };
}));

app.post('/auth/logout', auth(), h((req) => {
  delete data.tokens[req.token];
  if (req.user.role === 'astrologer' && req.user.online) {
    req.user.online = false;
    broadcastAstrologer(req.user);
  }
  save();
  return { ok: true };
}));

app.get('/me', auth(), h((req) => selfView(req.user)));

app.patch('/me', auth(), h((req) => {
  const u = req.user;
  const b = req.body;
  const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
  if (b.name !== undefined) u.name = str(b.name, 60);
  if (u.role === 'customer') {
    for (const k of ['gender', 'birthDate', 'birthTime', 'birthPlace']) if (b[k] !== undefined) u[k] = str(b[k]);
    if (b.sign !== undefined) {
      if (b.sign && !SIGNS.includes(b.sign)) fail(400, 'Unknown zodiac sign');
      u.sign = b.sign;
    }
  } else {
    if (b.bio !== undefined) u.bio = str(b.bio, 1000);
    if (b.skills !== undefined) u.skills = [].concat(b.skills).map((s) => str(s, 40)).filter(Boolean).slice(0, 10);
    if (b.languages !== undefined) u.languages = [].concat(b.languages).map((s) => str(s, 30)).filter(Boolean).slice(0, 10);
    if (b.experienceYears !== undefined) u.experienceYears = Math.max(0, Math.min(80, Number(b.experienceYears) || 0));
    if (b.ratePerMin !== undefined) {
      const rate = Number(b.ratePerMin);
      if (!(rate >= 5 && rate <= 500)) fail(400, 'Rate must be between ₹5 and ₹500 per minute');
      u.ratePerMin = Math.round(rate);
    }
    broadcastAstrologer(u);
  }
  save();
  return selfView(u);
}));

// ---------- content ----------

app.get('/horoscope/:sign', h((req) => daily(req.params.sign) || fail(404, 'Unknown sign')));

// ---------- customer: browse astrologers ----------

app.get('/astrologers', auth(), h((req) => {
  const { q, skill, language, online } = req.query;
  let list = data.users.filter((u) => u.role === 'astrologer' && u.name);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((a) => [a.name, a.bio, ...a.skills].join(' ').toLowerCase().includes(needle));
  }
  if (skill) list = list.filter((a) => a.skills.includes(skill));
  if (language) list = list.filter((a) => a.languages.includes(language));
  if (online === 'true') list = list.filter((a) => a.online);
  return list
    .map(publicAstrologer)
    .sort((a, b) => (b.online - a.online) || (a.busy - b.busy) || (b.rating - a.rating));
}));

app.get('/astrologers/:id', auth(), h((req) => {
  const a = findUser(req.params.id);
  if (!a || a.role !== 'astrologer') fail(404, 'Astrologer not found');
  const reviews = data.reviews
    .filter((r) => r.astrologerId === a.id)
    .slice(-20)
    .reverse()
    .map((r) => ({ ...r, customerName: findUser(r.customerId)?.name || 'Customer' }));
  return { ...publicAstrologer(a), reviews };
}));

// ---------- customer: wallet ----------

app.get('/wallet', auth(), h((req) => ({
  balance: req.user.role === 'customer' ? req.user.wallet : req.user.earnings,
  transactions: data.transactions.filter((t) => t.userId === req.user.id).reverse(),
})));

app.post('/wallet/recharge', auth('customer'), h((req) => {
  const amount = Number(req.body.amount);
  if (!(amount >= 50 && amount <= 50000)) fail(400, 'Recharge between ₹50 and ₹50,000');
  // In production: create a payment order (Razorpay/Stripe) and credit only after the webhook confirms it.
  req.user.wallet = round2(req.user.wallet + amount);
  addTransaction(req.user.id, 'recharge', amount, 'Wallet recharge');
  save();
  emitToUser(req.user.id, 'wallet:update', { balance: req.user.wallet });
  return { balance: req.user.wallet };
}));

// ---------- astrologer: availability, payouts, dashboard ----------

app.post('/astrologer/status', auth('astrologer'), h((req) => {
  const a = req.user;
  if (req.body.online && !a.name) fail(400, 'Complete your profile before going online');
  a.online = !!req.body.online;
  save();
  broadcastAstrologer(a);
  return selfView(a);
}));

app.post('/astrologer/payouts', auth('astrologer'), h((req) => {
  const a = req.user;
  const amount = Number(req.body.amount);
  if (!(amount >= 100)) fail(400, 'Minimum withdrawal is ₹100');
  if (amount > a.earnings) fail(400, 'Amount exceeds available earnings');
  a.earnings = round2(a.earnings - amount);
  addTransaction(a.id, 'payout', -amount, 'Withdrawal to bank account');
  save();
  return { earnings: a.earnings };
}));

app.get('/astrologer/dashboard', auth('astrologer'), h((req) => {
  const a = req.user;
  const mine = data.sessions.filter((s) => s.astrologerId === a.id);
  const today = new Date().toISOString().slice(0, 10);
  const todays = mine.filter((s) => s.status === 'ended' && (s.endedAt || '').startsWith(today));
  return {
    online: a.online,
    earnings: a.earnings,
    rating: a.rating,
    ratingCount: a.ratingCount,
    todayEarnings: round2(todays.reduce((sum, s) => sum + s.astrologerEarning, 0)),
    todayMinutes: todays.reduce((sum, s) => sum + s.billedMinutes, 0),
    todaySessions: todays.length,
    totalSessions: mine.filter((s) => s.status === 'ended').length,
    pending: mine.filter((s) => s.status === 'requested').map(sessionView),
    active: mine.filter((s) => s.status === 'active').map(sessionView),
  };
}));

// ---------- consultations ----------

app.get('/sessions', auth(), h((req) => {
  const key = req.user.role === 'customer' ? 'customerId' : 'astrologerId';
  return data.sessions.filter((s) => s[key] === req.user.id).reverse().map(sessionView);
}));

// Astrologers need a full birth chart, so a chat can't start without date, time and place of birth.
function birthDetailsProblem({ birthDate, birthTime, birthPlace }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate || '');
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] || +m[1] < 1900 || d > new Date()) return 'Your date of birth is missing or invalid.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(birthTime || '')) return 'Your time of birth is missing or invalid.';
  if (!String(birthPlace || '').trim()) return 'Your place of birth is missing.';
  return null;
}

function sessionFor(req) {
  const s = findSession(req.params.id);
  if (!s || ![s.customerId, s.astrologerId].includes(req.user.id)) fail(404, 'Chat not found');
  return s;
}

app.get('/sessions/:id', auth(), h((req) => sessionView(sessionFor(req))));

// Rasi chart + dasa/bhukti for the client in this chat (the place lookup is async, so no h()).
app.get('/sessions/:id/chart', auth('astrologer'), async (req, res) => {
  try {
    const c = findUser(sessionFor(req).customerId);
    res.json(await chartFor(c || {}));
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
});

app.get('/sessions/:id/messages', auth(), h((req) => {
  const s = sessionFor(req);
  return data.messages.filter((m) => m.sessionId === s.id);
}));

app.post('/sessions/:id/messages', auth(), h((req) => postMessage(sessionFor(req), req.user, req.body.text)));

app.post('/sessions', auth('customer'), h((req) => {
  const c = req.user;
  const a = findUser(req.body.astrologerId);
  if (!a || a.role !== 'astrologer') fail(404, 'Astrologer not found');
  if (!c.name) fail(400, 'Please complete your profile first');
  const birthProblem = birthDetailsProblem(c);
  if (birthProblem) fail(428, `${birthProblem} Add it in your profile before starting a chat.`);
  if (!a.online) fail(400, `${a.name} is offline right now`);
  if (data.sessions.some((s) => s.astrologerId === a.id && s.status === 'active')) fail(409, `${a.name} is busy in another chat`);
  if (data.sessions.some((s) => s.customerId === c.id && ['active', 'requested'].includes(s.status))) {
    fail(409, 'You already have a chat in progress');
  }
  const needed = a.ratePerMin * MIN_START_MINUTES;
  if (c.wallet < needed) fail(402, `You need at least ₹${needed} (${MIN_START_MINUTES} min) in your wallet`);

  const s = {
    id: db.id(), customerId: c.id, astrologerId: a.id, status: 'requested',
    ratePerMin: a.ratePerMin, requestedAt: db.now(), startedAt: null, endedAt: null,
    billedMinutes: 0, amount: 0, astrologerEarning: 0, endReason: null, reviewed: false,
    topic: String(req.body.topic || '').slice(0, 200),
  };
  data.sessions.push(s);
  save();
  timers.set(s.id, { request: setTimeout(() => endSession(s, 'timeout'), REQUEST_TIMEOUT_MS) });
  emitToUser(a.id, 'session:request', sessionView(s));
  broadcastSession(s);
  return sessionView(s);
}));

app.post('/sessions/:id/accept', auth('astrologer'), h((req) => {
  const s = sessionFor(req);
  if (s.status !== 'requested') fail(400, 'This request is no longer pending');
  if (data.sessions.some((o) => o.astrologerId === req.user.id && o.status === 'active')) fail(409, 'Finish your current chat first');
  return sessionView(startSession(s));
}));

app.post('/sessions/:id/reject', auth('astrologer'), h((req) => {
  const s = sessionFor(req);
  if (s.status !== 'requested') fail(400, 'This request is no longer pending');
  return sessionView(endSession(s, 'rejected'));
}));

app.post('/sessions/:id/end', auth(), h((req) => {
  const s = sessionFor(req);
  const reason = s.status === 'requested' ? 'cancelled' : `ended_by_${req.user.role}`;
  return sessionView(endSession(s, reason));
}));

app.post('/sessions/:id/review', auth('customer'), h((req) => {
  const s = sessionFor(req);
  if (s.status !== 'ended') fail(400, 'You can review only after the chat ends');
  if (s.reviewed) fail(400, 'Already reviewed');
  const rating = Math.round(Number(req.body.rating));
  if (!(rating >= 1 && rating <= 5)) fail(400, 'Rating must be 1–5');
  const review = {
    id: db.id(), sessionId: s.id, astrologerId: s.astrologerId, customerId: s.customerId,
    rating, comment: String(req.body.comment || '').slice(0, 500), createdAt: db.now(),
  };
  data.reviews.push(review);
  s.reviewed = true;
  const a = findUser(s.astrologerId);
  a.rating = round2((a.rating * a.ratingCount + rating) / (a.ratingCount + 1));
  a.ratingCount += 1;
  save();
  broadcastAstrologer(a);
  return review;
}));

// ---------- realtime ----------

io.use((socket, next) => {
  const user = findUser(data.tokens[socket.handshake.auth?.token]);
  if (!user) return next(new Error('unauthorized'));
  socket.user = user;
  next();
});

io.on('connection', (socket) => {
  const user = socket.user;
  socket.join(`user:${user.id}`);

  socket.on('message:send', ({ sessionId, text } = {}, ack) => {
    try {
      const s = findSession(sessionId);
      if (!s) fail(404, 'Chat not found');
      const msg = postMessage(s, user, text);
      ack?.({ ok: true, message: msg });
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });

  socket.on('typing', ({ sessionId } = {}) => {
    const s = findSession(sessionId);
    if (!s || s.status !== 'active') return;
    const other = user.id === s.customerId ? s.astrologerId : s.customerId;
    if (other !== user.id && [s.customerId, s.astrologerId].includes(user.id)) emitToUser(other, 'typing', { sessionId });
  });
});

server.listen(PORT, () => {
  console.log(`AstroConnect API listening on http://localhost:${PORT}`);
  console.log(`Dev OTP for every phone number: ${DEV_OTP}`);
});
