const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const db = require('./db');
const { daily, SIGNS } = require('./horoscope');
const { seedIfEmpty } = require('./seed');
const { chartFor } = require('./jathagam');
const { approvedAstrologer, isAllowed } = require('./approved');
const { callsEnabled, callToken, closeRoom } = require('./calls');
const { notify, isPushToken } = require('./push');
const passwords = require('./passwords');

const PORT = process.env.PORT || 4000;
const DEV_OTP = '1234';                 // Astrologers sign in with this; customers use a password
// When CUSTOMER_PASSWORD_ONLY=1, customers can no longer use the 1234 code (only mobile number + password).
const CUSTOMER_PASSWORD_ONLY = process.env.CUSTOMER_PASSWORD_ONLY === '1';
const ASTROLOGER_SHARE = 0.7;           // Astrologer keeps 70% of each minute billed
const MIN_START_MINUTES = 3;            // Customer needs balance for this many minutes to start a chat
const REQUEST_TIMEOUT_MS = 60 * 1000;   // Unanswered requests expire after a minute
const BILLING_INTERVAL_MS = Number(process.env.BILLING_INTERVAL_MS) || 60 * 1000;
// Prepaid minutes bought from the wallet; usable with any astrologer for chat or call, never expire.
const PACKAGES = [{ id: 'mins30', minutes: 30, price: 300 }];
const PACKAGE_MINUTE_VALUE = 10; // ₹ per package minute (₹300 / 30); the astrologer earns their share of this

const { data, save } = db;

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
  const { phone, earnings, pushTokens, ...rest } = a;
  return { ...rest, busy };
}

function publicCustomer(c) {
  const { phone, wallet, passwordHash, resetPassword, ...rest } = c;
  return rest;
}

// The owner sees their own record, minus secrets.
const selfView = ({ passwordHash, resetPassword, ...u }) => u;

function sessionView(s) {
  const customer = findUser(s.customerId);
  const astrologer = findUser(s.astrologerId);
  return {
    ...s,
    kind: s.kind || 'chat',
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

function addTransaction(userId, type, amount, note, sessionId, minutes) {
  const tx = { id: db.id(), userId, type, amount: round2(amount), note, sessionId, createdAt: db.now(), ...(minutes ? { minutes } : {}) };
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
    res.status(e.status || 500).json({ error: e.message || 'Server error', ...(e.needsPassword ? { needsPassword: true } : {}) });
  }
};

function auth(role) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const user = findUser(data.tokens[token]);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    if (!isAllowed(user)) {
      delete data.tokens[token];
      if (user.online) { user.online = false; broadcastAstrologer(user); }
      save();
      return res.status(401).json({ error: 'This number is no longer registered as an JothidaConnect astrologer.' });
    }
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
// Package minutes are used first; after that each minute is charged from the wallet at the astrologer's rate.
function billMinute(s) {
  const customer = findUser(s.customerId);
  const astrologer = findUser(s.astrologerId);
  const fromPackage = (customer.packageMinutes || 0) > 0;
  if (!fromPackage && customer.wallet < s.ratePerMin) return false;
  const earning = (fromPackage ? PACKAGE_MINUTE_VALUE : s.ratePerMin) * ASTROLOGER_SHARE;
  if (fromPackage) {
    customer.packageMinutes -= 1;
    s.packageMinutesUsed = (s.packageMinutesUsed || 0) + 1;
  } else {
    customer.wallet = round2(customer.wallet - s.ratePerMin);
    s.amount = round2(s.amount + s.ratePerMin);
  }
  astrologer.earnings = round2((astrologer.earnings || 0) + earning);
  s.billedMinutes += 1;
  s.astrologerEarning = round2(s.astrologerEarning + earning);
  emitToUser(customer.id, 'wallet:update', { balance: customer.wallet, packageMinutes: customer.packageMinutes || 0 });
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
  const label = s.kind === 'call' ? 'Call' : 'Chat';
  if (wasActive && s.billedMinutes > 0) {
    const fromPackage = s.packageMinutesUsed ? `, ${s.packageMinutesUsed} from package` : '';
    const note = (name) => `${label} with ${name} (${s.billedMinutes} min${fromPackage})`;
    addTransaction(s.customerId, 'debit', -s.amount, note(findUser(s.astrologerId).name), s.id, s.packageMinutesUsed || 0);
    addTransaction(s.astrologerId, 'credit', s.astrologerEarning, note(findUser(s.customerId).name), s.id);
  }
  if (s.kind === 'call') closeRoom(s.id);
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

// The mobile number identifies an account (one customer and one astrologer record per number), so
// accept +91 / 91 / 0 prefixes but always store the plain 10 digits.
function mobileNumber(raw) {
  let p = String(raw || '').replace(/\D/g, '');
  if (p.length === 12 && p.startsWith('91')) p = p.slice(2);
  else if (p.length === 11 && p.startsWith('0')) p = p.slice(1);
  if (!/^\d{10}$/.test(p)) fail(400, 'Enter your 10-digit mobile number');
  return p;
}

app.post('/auth/request-otp', h((req) => {
  mobileNumber(req.body.phone);
  // In production: generate a random code, store a hash with expiry, and send it by SMS.
  return { ok: true, devOtp: DEV_OTP };
}));

app.post('/auth/verify', h((req) => {
  const phone = mobileNumber(req.body.phone);
  const { otp, role } = req.body;
  if (!['customer', 'astrologer'].includes(role)) fail(400, 'Invalid role');
  if (role === 'customer' && CUSTOMER_PASSWORD_ONLY) fail(403, 'Please update the JothidaConnect app to sign in with your password.');
  if (otp !== DEV_OTP) fail(401, 'Incorrect OTP');
  return signInAs(phone, role);
}));

// ---------- customer passwords ----------

const findCustomer = (phone) => data.users.find((u) => u.role === 'customer' && u.phone === phone);

app.post('/auth/customer/login', h((req) => {
  const phone = mobileNumber(req.body.phone);
  const locked = passwords.lockedFor(phone);
  if (locked) fail(429, `Too many wrong attempts. Try again in ${locked} minute${locked === 1 ? '' : 's'}.`);
  const c = findCustomer(phone);
  if (!c) fail(404, 'There is no account for this number yet. Tap “Create account”.');
  if (!c.passwordHash) {
    const err = new HttpError(409, 'Set a password for your account to continue.');
    err.needsPassword = true;
    throw err;
  }
  if (!passwords.checkPassword(String(req.body.password || ''), c.passwordHash)) {
    passwords.recordFailure(phone);
    fail(401, 'Wrong mobile number or password.');
  }
  passwords.recordSuccess(phone);
  return signInAs(phone, 'customer');
}));

// New account, or an existing one without a password yet (created before passwords, or reset by the admin).
app.post('/auth/customer/register', h((req) => {
  const phone = mobileNumber(req.body.phone);
  const problem = passwords.passwordProblem(req.body.password);
  if (problem) fail(400, problem);
  if (findCustomer(phone)?.passwordHash) fail(409, 'This number already has an account. Sign in with your password.');
  const result = signInAs(phone, 'customer');
  findCustomer(phone).passwordHash = passwords.hashPassword(String(req.body.password));
  save();
  return result;
}));

app.post('/me/password', auth('customer'), h((req) => {
  const c = req.user;
  if (c.passwordHash && !passwords.checkPassword(String(req.body.current || ''), c.passwordHash)) fail(401, 'Your current password is incorrect.');
  const problem = passwords.passwordProblem(req.body.next);
  if (problem) fail(400, problem);
  c.passwordHash = passwords.hashPassword(String(req.body.next));
  save();
  return { ok: true };
}));

// Find or create the account for this number and role, and start a session for it.
function signInAs(phone, role) {
  const approved = role === 'astrologer' ? approvedAstrologer(phone) : null;
  if (role === 'astrologer' && !approved) fail(403, "This number isn't registered as an JothidaConnect astrologer. Ask the admin to add you.");

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
  if (approved?.name) user.name = approved.name; // the admin list owns astrologer names
  const token = crypto.randomBytes(24).toString('hex');
  data.tokens[token] = user.id;
  save();
  return { token, user: selfView(user), isNew };
}

app.post('/auth/logout', auth(), h((req) => {
  delete data.tokens[req.token];
  if (req.body?.pushToken) req.user.pushTokens = (req.user.pushTokens || []).filter((t) => t !== req.body.pushToken);
  if (req.user.role === 'astrologer' && req.user.online) {
    req.user.online = false;
    broadcastAstrologer(req.user);
  }
  save();
  return { ok: true };
}));

app.get('/me', auth(), h((req) => selfView(req.user)));

// The astrologer app registers its push token so requests can ring the phone while the app is closed.
app.post('/me/push-token', auth('astrologer'), h((req) => {
  const token = String(req.body.token || '');
  if (!isPushToken(token)) fail(400, 'Invalid push token');
  const u = req.user;
  u.pushTokens = [token, ...(u.pushTokens || []).filter((t) => t !== token)].slice(0, 5); // newest first, a few devices at most
  save();
  return { ok: true };
}));

app.patch('/me', auth(), h((req) => {
  const u = req.user;
  const b = req.body;
  const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
  const listedName = u.role === 'astrologer' ? approvedAstrologer(u.phone)?.name : '';
  if (b.name !== undefined) u.name = listedName || str(b.name, 60);
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
    // ratePerMin is set by the admin in Firebase (astrologers/{mobile}.ratePerMin), not from the app.
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
  let list = data.users.filter((u) => u.role === 'astrologer' && u.name && isAllowed(u));
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
  if (!a || a.role !== 'astrologer' || !isAllowed(a)) fail(404, 'Astrologer not found');
  const reviews = data.reviews
    .filter((r) => r.astrologerId === a.id)
    .slice(-20)
    .reverse()
    .map((r) => ({ ...r, customerName: findUser(r.customerId)?.name || 'Customer' }));
  return { ...publicAstrologer(a), reviews, callsEnabled };
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

app.get('/packages', auth('customer'), h((req) => ({
  packages: PACKAGES.map((p) => ({ ...p, perMinute: p.price / p.minutes })),
  packageMinutes: req.user.packageMinutes || 0,
})));

app.post('/packages/buy', auth('customer'), h((req) => {
  const p = PACKAGES.find((x) => x.id === req.body.packageId);
  if (!p) fail(404, 'Package not found');
  const c = req.user;
  if (c.wallet < p.price) fail(402, `You need ₹${p.price} in your wallet to buy this package`);
  c.wallet = round2(c.wallet - p.price);
  c.packageMinutes = (c.packageMinutes || 0) + p.minutes;
  addTransaction(c.id, 'package', -p.price, `${p.minutes}-minute package`, null, p.minutes);
  save();
  emitToUser(c.id, 'wallet:update', { balance: c.wallet, packageMinutes: c.packageMinutes });
  return { balance: c.wallet, packageMinutes: c.packageMinutes };
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

// LiveKit token for a live call; both participants fetch one once the astrologer accepts.
app.get('/sessions/:id/call-token', auth(), async (req, res) => {
  try {
    const s = sessionFor(req);
    if (s.kind !== 'call') fail(400, 'This consultation is a chat, not a call');
    if (s.status !== 'active') fail(409, 'The call is not live');
    res.json(await callToken(s.id, req.user));
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
  if (!a || a.role !== 'astrologer' || !isAllowed(a)) fail(404, 'Astrologer not found');
  const kind = req.body.kind === 'call' ? 'call' : 'chat';
  if (kind === 'call' && !callsEnabled) fail(503, 'Voice calls are not set up yet.');
  if (!c.name) fail(400, 'Please complete your profile first');
  const birthProblem = birthDetailsProblem(c);
  if (birthProblem) fail(428, `${birthProblem} Add it in your profile before starting a chat.`);
  if (!a.online) fail(400, `${a.name} is offline right now`);
  if (data.sessions.some((s) => s.astrologerId === a.id && s.status === 'active')) fail(409, `${a.name} is busy in another chat`);
  if (data.sessions.some((s) => s.customerId === c.id && ['active', 'requested'].includes(s.status))) {
    fail(409, 'You already have a chat in progress');
  }
  const affordable = (c.packageMinutes || 0) + Math.floor(c.wallet / a.ratePerMin);
  if (affordable < MIN_START_MINUTES) {
    fail(402, `You need at least ${MIN_START_MINUTES} minutes: ₹${a.ratePerMin * MIN_START_MINUTES} in your wallet or a minutes package`);
  }

  const s = {
    id: db.id(), kind, customerId: c.id, astrologerId: a.id, status: 'requested',
    ratePerMin: a.ratePerMin, requestedAt: db.now(), startedAt: null, endedAt: null,
    billedMinutes: 0, amount: 0, astrologerEarning: 0, endReason: null, reviewed: false,
    topic: String(req.body.topic || '').slice(0, 200),
  };
  data.sessions.push(s);
  save();
  timers.set(s.id, { request: setTimeout(() => endSession(s, 'timeout'), REQUEST_TIMEOUT_MS) });
  emitToUser(a.id, 'session:request', sessionView(s));
  notify(a, {
    title: kind === 'call' ? 'New call request' : 'New chat request',
    body: `${c.name} wants ${kind === 'call' ? 'a voice call' : 'to chat'} · ₹${a.ratePerMin}/min. Tap to answer within a minute.`,
    data: { type: 'request', sessionId: s.id },
    channelId: 'requests',
    ttlSeconds: Math.round(REQUEST_TIMEOUT_MS / 1000), // a late notification for an expired request is useless
  });
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
  if (!user || !isAllowed(user)) return next(new Error('unauthorized'));
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

// Load the data (Firestore or the JSON file) before accepting any request.
async function start() {
  console.log(`Data store: ${await db.init()}`);
  seedIfEmpty();

  // Sessions that were live when the server stopped can't be billed any more; close them out.
  for (const s of data.sessions) {
    if (s.status === 'active') Object.assign(s, { status: 'ended', endedAt: db.now(), endReason: 'server_restart' });
    if (s.status === 'requested') Object.assign(s, { status: 'missed', endedAt: db.now() });
  }
  save();

  // Admin sets astrologer rates in the Firebase console: astrologers/{mobile} → ratePerMin.
  // New rates apply to requests made from then on; a chat already running keeps its rate.
  db.watch('astrologers', (doc, docId) => {
    const a = data.users.find((u) => u.role === 'astrologer' && u.phone === doc.phone);
    if (!a || doc.ratePerMin === undefined) return;
    const rate = Number(doc.ratePerMin);
    if (rate === a.ratePerMin) return;
    if (!(rate >= 5 && rate <= 500)) {
      console.warn(`Ignored rate "${doc.ratePerMin}" for ${a.name}: use a number from 5 to 500. Restoring ₹${a.ratePerMin}.`);
      db.rewrite('astrologers', docId);
      save();
      return;
    }
    a.ratePerMin = Math.round(rate);
    console.log(`Rate for ${a.name} set to ₹${a.ratePerMin}/min from Firebase`);
    broadcastAstrologer(a);
    emitToUser(a.id, 'me:update', selfView(a));
    save();
  });

  // Admin password reset: in the Firebase console add resetPassword = true to customers/{mobile}.
  // The customer then sets a new password at their next sign-in.
  db.watch('customers', (doc) => {
    if (doc.resetPassword !== true) return;
    const c = data.users.find((u) => u.role === 'customer' && u.phone === doc.phone);
    if (!c) return;
    delete c.passwordHash;
    delete c.resetPassword;
    for (const [t, uid] of Object.entries(data.tokens)) if (uid === c.id) delete data.tokens[t]; // sign out everywhere
    console.log(`Password reset for customer ...${c.phone.slice(-4)} from Firebase`);
    save();
  });

  server.listen(PORT, () => {
    console.log(`JothidaConnect API listening on http://localhost:${PORT}`);
    console.log(`Dev OTP for every phone number: ${DEV_OTP}`);
  });
}

// pm2 restarts send SIGINT: write pending changes before exiting.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => db.flush().finally(() => process.exit(0)));
}

start().catch((e) => {
  console.error('Could not start:', e.message);
  process.exit(1);
});
