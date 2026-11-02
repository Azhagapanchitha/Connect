const fs = require('fs');
const path = require('path');

// Auto-load .env and *.env files if present
for (const envPath of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env'), path.join(__dirname, '..', 'cashfree.env'), path.join(__dirname, '..', 'livekit.env')]) {
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
      }
    }
  }
}
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const db = require('./db');
const { daily, SIGNS } = require('./horoscope');
const { seedIfEmpty } = require('./seed');
const { chartFor, searchPlaces } = require('./jathagam');
const { approvedAstrologer, isAllowed, listApproved, setApproved, removeApproved } = require('./approved');
const { callsEnabled, callToken, closeRoom } = require('./calls');
const { notify, isPushToken } = require('./push');
const passwords = require('./passwords');
const cashfree = require('./cashfree');
const { contactFlags } = require('./contactcheck');

const PORT = process.env.PORT || 4000;
const DEV_OTP = '1234';                 // Astrologers sign in with this; customers use a password
// When CUSTOMER_PASSWORD_ONLY=1, customers can no longer use the 1234 code (only mobile number + password).
const CUSTOMER_PASSWORD_ONLY = process.env.CUSTOMER_PASSWORD_ONLY === '1';
const DEFAULT_SHARE_PERCENT = 70;       // Astrologer keeps this % of each minute billed, unless the admin sets their own
const MIN_START_MINUTES = 5;            // Customer needs balance for this many minutes to start a chat or call
const REQUEST_TIMEOUT_MS = 60 * 1000;   // Unanswered requests expire after a minute
const BILLING_INTERVAL_MS = Number(process.env.BILLING_INTERVAL_MS) || 60 * 1000;
// Prepaid minutes bought from the wallet; usable with any astrologer for chat or call, never expire.
const PACKAGES = [{ id: 'mins30', minutes: 30, price: 300 }];
const PACKAGE_MINUTE_VALUE = 10; // ₹ per package minute (₹300 / 30); the astrologer earns their share of this

const { data, save } = db;

const app = express();
app.use(cors());
// 1 MB leaves room for an astrologer photo upload from the admin page (resized to ~50 KB in the browser).
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- helpers ----------

const findUser = (id) => data.users.find((u) => u.id === id);
const findSession = (id) => data.sessions.find((s) => s.id === id);
const round2 = (n) => Math.round(n * 100) / 100;

function publicAstrologer(a) {
  const busy = data.sessions.some((s) => s.astrologerId === a.id && s.status === 'active');
  const { phone, earnings, pushTokens, sharePercent, ...rest } = a;
  return { ...rest, busy };
}

// The % of each billed minute an astrologer keeps: set per astrologer on the admin page, else the default.
const sharePercentOf = (a) => (typeof a?.sharePercent === 'number' ? a.sharePercent : DEFAULT_SHARE_PERCENT);

function publicCustomer(c) {
  const { phone, wallet, passwordHash, resetPassword, ...rest } = c;
  return rest;
}

// The owner sees their own record, minus secrets.
// An astrologer always sees their effective share, even when it's the default.
const selfView = ({ passwordHash, resetPassword, ...u }) => (u.role === 'astrologer' ? { ...u, sharePercent: sharePercentOf(u) } : u);

function sessionView(s) {
  const customer = findUser(s.customerId);
  const astrologer = findUser(s.astrologerId);
  const { sharePercent, ...rest } = s; // sessions go to the customer too; the share stays private
  return {
    ...rest,
    kind: s.kind || 'chat',
    customer: customer && { id: customer.id, name: customer.name, sign: customer.sign, birthDate: customer.birthDate, birthTime: customer.birthTime, birthPlace: customer.birthPlace, gender: customer.gender },
    astrologer: astrologer && { id: astrologer.id, name: astrologer.name, avatarColor: astrologer.avatarColor, photo: astrologer.photo, ratePerMin: astrologer.ratePerMin },
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
// payWith 'package' (the default): package minutes first, then the wallet at the astrologer's rate once
// they run out. payWith 'wallet': the wallet only, leaving package minutes for another consultation.
function billMinute(s) {
  const customer = findUser(s.customerId);
  const astrologer = findUser(s.astrologerId);
  const fromPackage = s.payWith !== 'wallet' && (customer.packageMinutes || 0) > 0;
  if (!fromPackage && customer.wallet < s.ratePerMin) return false;
  // The share is fixed when the consultation is requested; older sessions fall back to the astrologer's current share.
  const share = (s.sharePercent ?? sharePercentOf(astrologer)) / 100;
  const earning = round2((fromPackage ? PACKAGE_MINUTE_VALUE : s.ratePerMin) * share);
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
  // Note it in the server log too; the admin page's Flagged chats tab is where these are reviewed.
  const earlier = data.messages.filter((m) => m.sessionId === s.id && m.senderId === sender.id && m !== msg).slice(-4).map((m) => m.text);
  const flags = contactFlags(text, earlier);
  if (flags.length) console.log(`Possible contact sharing by ${sender.role} ...${sender.phone.slice(-4)} in ${s.id}: ${flags.map((f) => f.kind).join(', ')}`);
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
// A fresh astrologer account: made on first sign-in, or ahead of it from the admin page.
const newAstrologer = (phone) => ({
  id: db.id(), phone, role: 'astrologer', name: '', bio: '', skills: [], languages: [], experienceYears: 0,
  ratePerMin: 20, online: false, rating: 0, ratingCount: 0, earnings: 0,
  avatarColor: ['#7C3AED', '#DB2777', '#EA580C', '#0891B2', '#16A34A'][Math.floor(Math.random() * 5)],
  createdAt: db.now(),
});

function signInAs(phone, role) {
  const approved = role === 'astrologer' ? approvedAstrologer(phone) : null;
  if (role === 'astrologer' && !approved) fail(403, "This number isn't registered as an JothidaConnect astrologer. Ask the admin to add you.");

  let user = data.users.find((u) => u.phone === phone && u.role === role);
  let isNew = false;
  if (!user) {
    isNew = true;
    user = role === 'customer'
      ? { id: db.id(), phone, role, name: '', gender: '', birthDate: '', birthTime: '', birthPlace: '', sign: '', wallet: 0, createdAt: db.now() }
      : newAstrologer(phone);
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

// Birth place suggestions while the customer types.
app.get('/places', auth(), async (req, res) => {
  try {
    res.json(await searchPlaces(String(req.query.q || '').slice(0, 100)));
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'Place search is unavailable right now. You can still type the place.' });
  }
});

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
  // minStartMinutes lets the app stop a customer who can't afford it before the birth-details step.
  return { ...publicAstrologer(a), reviews, callsEnabled, minStartMinutes: MIN_START_MINUTES };
}));

// ---------- customer: wallet ----------

app.get('/wallet', auth(), h((req) => ({
  balance: req.user.role === 'customer' ? req.user.wallet : req.user.earnings,
  transactions: data.transactions.filter((t) => t.userId === req.user.id).reverse(),
})));

// Unpaid top-up for local development only. The apps use /wallet/cashfree/order; with Cashfree set up this
// route is refused, or any customer could credit their own wallet without paying.
app.post('/wallet/recharge', auth('customer'), h((req) => {
  if (cashfree.isConfigured()) fail(410, 'Please update the app to recharge through Cashfree.');
  const amount = Number(req.body.amount);
  if (!(amount >= 50 && amount <= 50000)) fail(400, 'Recharge between ₹50 and ₹50,000');
  req.user.wallet = round2(req.user.wallet + amount);
  addTransaction(req.user.id, 'recharge', amount, 'Wallet recharge (Demo)');
  save();
  emitToUser(req.user.id, 'wallet:update', { balance: req.user.wallet });
  return { balance: req.user.wallet };
}));

app.get('/wallet/cashfree/config', auth('customer'), h(() => ({
  configured: cashfree.isConfigured(),
  env: cashfree.ENV,
})));

app.post('/wallet/cashfree/order', auth('customer'), async (req, res) => {
  const amount = Number(req.body.amount);
  if (!(amount >= 50 && amount <= 50000)) {
    return res.status(400).json({ message: 'Recharge between ₹50 and ₹50,000' });
  }

  if (!cashfree.isConfigured()) {
    // Development demo flow when API credentials are not yet set in .env
    req.user.wallet = round2(req.user.wallet + amount);
    addTransaction(req.user.id, 'recharge', amount, 'Wallet recharge (Demo)');
    save();
    emitToUser(req.user.id, 'wallet:update', { balance: req.user.wallet });
    return res.json({ demo: true, balance: req.user.wallet, amount });
  }

  const orderId = `cf_${req.user.id.slice(0, 8)}_${Date.now()}`;
  const origin = req.headers.origin || 'https://jothidaconnect.in';
  const returnUrl = `${origin}/?order_id={order_id}`;
  const notifyUrl = 'https://api.jothidaconnect.in/wallet/cashfree/webhook';

  try {
    const cfOrder = await cashfree.createOrder({
      orderId,
      orderAmount: amount,
      customerId: req.user.id,
      customerPhone: req.user.phone,
      customerName: req.user.name,
      returnUrl,
      notifyUrl,
    });

    const paymentLink = cashfree.ENV === 'production'
      ? `https://payments.cashfree.com/forms/${cfOrder.payment_session_id}`
      : `https://payments-test.cashfree.com/forms/${cfOrder.payment_session_id}`;

    const orderRecord = {
      id: orderId,
      userId: req.user.id,
      amount,
      status: cfOrder.order_status || 'ACTIVE',
      paymentSessionId: cfOrder.payment_session_id,
      gateway: 'cashfree',
      createdAt: db.now(),
      processed: false,
    };
    if (!data.orders) data.orders = [];
    data.orders.push(orderRecord);
    save();

    res.json({
      orderId,
      paymentSessionId: cfOrder.payment_session_id,
      paymentLink,
      orderAmount: amount,
      amount,
      mode: cashfree.ENV,
    });
  } catch (err) {
    console.error('Failed to create Cashfree order:', err);
    res.status(err.statusCode || 500).json({ message: err.message || 'Payment initialization failed' });
  }
});

// Credit a paid order to the customer who created it, exactly once, with the amount we recorded
// when the order was made (never an amount taken from the request).
function creditOrder(orderRecord) {
  if (orderRecord.processed) return false;
  const user = findUser(orderRecord.userId);
  if (!user) return false;
  orderRecord.status = 'PAID';
  orderRecord.processed = true;
  orderRecord.processedAt = db.now();
  user.wallet = round2(user.wallet + orderRecord.amount);
  // A few orders were created while GST was charged, with a total above the credited amount.
  const note = orderRecord.total ? ` · paid ₹${orderRecord.total} incl. ₹${orderRecord.gst} GST` : '';
  addTransaction(user.id, 'recharge', orderRecord.amount, `Wallet recharge (Cashfree)${note}`);
  save();
  emitToUser(user.id, 'wallet:update', { balance: user.wallet });
  return true;
}

app.post('/wallet/cashfree/verify', auth('customer'), async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ message: 'Missing orderId' });

  if (!cashfree.isConfigured()) {
    return res.json({ paid: true, balance: req.user.wallet });
  }

  try {
    const mine = (data.orders || []).find((o) => o.id === orderId && o.userId === req.user.id);
    if (!mine) return res.status(404).json({ message: 'Payment not found' });
    const cfOrder = await cashfree.getOrder(orderId);
    const isPaid = cfOrder.order_status === 'PAID';

    if (!data.orders) data.orders = [];
    const orderRecord = data.orders.find((o) => o.id === orderId);
    // Only the customer who started this payment can confirm it.
    if (!orderRecord || orderRecord.userId !== req.user.id) return res.status(404).json({ message: 'Payment not found' });

    if (isPaid) {
      const expected = orderRecord.total ?? orderRecord.amount;
      if (Number(cfOrder.order_amount) < expected) {
        console.warn(`Cashfree order ${orderId} paid ${cfOrder.order_amount}, expected ${expected}; not credited`);
        return res.status(409).json({ message: 'Payment amount does not match. Please contact support.' });
      }
      creditOrder(orderRecord);
      return res.json({ paid: true, balance: req.user.wallet });
    }

    return res.json({ paid: false, status: cfOrder.order_status, balance: req.user.wallet });
  } catch (err) {
    console.error('Failed to verify Cashfree order:', err);
    res.status(err.statusCode || 500).json({ message: err.message || 'Verification failed' });
  }
});

app.post('/wallet/cashfree/webhook', async (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];

  // Every notification must carry a valid Cashfree signature; without keys there are no real payments.
  if (!cashfree.isConfigured()) return res.status(404).send('Not configured');
  if (!req.rawBody || !cashfree.verifyWebhook(req.rawBody, signature, timestamp)) {
    console.warn('Rejected Cashfree webhook: missing or invalid signature');
    return res.status(400).send('Invalid signature');
  }

  const event = req.body;
  const orderData = event?.data?.order || event?.data;
  const orderId = orderData?.order_id;
  const orderStatus = orderData?.order_status || event?.type;

  if (orderId && (orderStatus === 'PAID' || event?.type === 'PAYMENT_SUCCESS_WEBHOOK')) {
    if (!data.orders) data.orders = [];
    const orderRecord = data.orders.find((o) => o.id === orderId);
    if (orderRecord) creditOrder(orderRecord);
  }

  res.status(200).send('OK');
});

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
  // Apps from before the choice send no payWith: keep the old behaviour (package first).
  const payWith = req.body.payWith === 'wallet' ? 'wallet' : 'package';
  const walletMinutes = Math.floor(c.wallet / a.ratePerMin);
  const affordable = (payWith === 'package' ? c.packageMinutes || 0 : 0) + walletMinutes;
  if (affordable < MIN_START_MINUTES) {
    fail(402, payWith === 'wallet'
      ? `You need at least ₹${a.ratePerMin * MIN_START_MINUTES} in your wallet for ${MIN_START_MINUTES} minutes${c.packageMinutes ? ', or pay with your package minutes' : ''}`
      : `You need at least ${MIN_START_MINUTES} minutes: ₹${a.ratePerMin * MIN_START_MINUTES} in your wallet or a minutes package`);
  }

  const s = {
    id: db.id(), kind, customerId: c.id, astrologerId: a.id, status: 'requested',
    ratePerMin: a.ratePerMin, sharePercent: sharePercentOf(a), payWith, requestedAt: db.now(), startedAt: null, endedAt: null,
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

// ---------- admin: astrologer registration ----------
// One admin login, set on the server with ADMIN_USER and ADMIN_PASSWORD_HASH (made by `npm run admin-password`).
// Without both, the page and its API are switched off. Admin sessions live in memory, so a restart signs out.

const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const adminEnabled = Boolean(ADMIN_USER && ADMIN_PASSWORD_HASH);
const ADMIN_SESSION_MS = 12 * 3600 * 1000;
const ADMIN_LOCK_KEY = 'admin'; // one account, so failed logins lock the account (5 tries, then 15 minutes)
const adminTokens = new Map(); // token -> expiry time
const ADMIN_PAGE = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
const sameText = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

app.get('/admin', (_req, res) => {
  if (!adminEnabled) return res.status(404).type('text').send('Not found');
  res.set({
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'; form-action 'none'",
  }).type('html').send(ADMIN_PAGE);
});

app.post('/admin/login', h((req) => {
  if (!adminEnabled) fail(404, 'Not found');
  const locked = passwords.lockedFor(ADMIN_LOCK_KEY);
  if (locked) fail(429, `Too many wrong attempts. Try again in ${locked} minute${locked === 1 ? '' : 's'}.`);
  const userOk = sameText(req.body.username || '', ADMIN_USER);
  const passOk = passwords.checkPassword(String(req.body.password || ''), ADMIN_PASSWORD_HASH);
  if (!userOk || !passOk) {
    passwords.recordFailure(ADMIN_LOCK_KEY);
    fail(401, 'Wrong username or password.');
  }
  passwords.recordSuccess(ADMIN_LOCK_KEY);
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.set(token, Date.now() + ADMIN_SESSION_MS);
  console.log('Admin signed in');
  return { token };
}));

function adminAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const expires = adminEnabled && adminTokens.get(token);
  if (!expires || expires < Date.now()) {
    adminTokens.delete(token);
    return res.status(401).json({ error: 'Please sign in again.' });
  }
  req.adminToken = token;
  next();
}

app.post('/admin/logout', adminAuth, h((req) => {
  adminTokens.delete(req.adminToken);
  return { ok: true };
}));

const findAstrologer = (phone) => data.users.find((u) => u.role === 'astrologer' && u.phone === phone);

function adminAstrologerView({ phone, name }) {
  const a = findAstrologer(phone);
  // Earned: credits from chats and calls. Withdrawn: payout requests made in the Partner app, which are only
  // recorded there, so the admin pays them by bank transfer.
  let earned = 0;
  let withdrawn = 0;
  if (a) {
    for (const t of data.transactions) {
      if (t.userId !== a.id) continue;
      if (t.type === 'credit') earned += t.amount;
      else if (t.type === 'payout') withdrawn -= t.amount;
    }
  }
  return {
    balance: round2(a?.earnings || 0), earned: round2(earned), withdrawn: round2(withdrawn),
    phone, name,
    signedUp: Boolean(a && Object.values(data.tokens).includes(a.id)), // has signed in to the Partner app
    online: Boolean(a?.online),
    ratePerMin: a?.ratePerMin ?? null,
    experienceYears: a?.experienceYears ?? 0,
    sharePercent: a ? sharePercentOf(a) : DEFAULT_SHARE_PERCENT,
    skills: a?.skills || [],
    languages: a?.languages || [],
    bio: a?.bio || '',
    photo: a?.photo || null,
  };
}

app.get('/admin/astrologers', adminAuth, h(() => ({
  astrologers: listApproved().map(adminAstrologerView).sort((x, y) => x.name.localeCompare(y.name)),
})));

// Register a new astrologer, or update one already on the list (same mobile number).
app.post('/admin/astrologers', adminAuth, h((req) => {
  const b = req.body;
  const phone = mobileNumber(b.phone);
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const list = (v, max) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => str(x, max)).filter(Boolean).slice(0, 10);
  const name = str(b.name, 60);
  if (name.length < 2) fail(400, 'Enter the astrologer\'s full name.');
  const ratePerMin = Number(b.ratePerMin);
  if (!(ratePerMin >= 1 && ratePerMin <= 1000)) fail(400, 'Rate must be between ₹1 and ₹1000 per minute.');
  const experienceYears = Math.round(Number(b.experienceYears) || 0);
  if (experienceYears < 0 || experienceYears > 80) fail(400, 'Experience must be between 0 and 80 years.');
  // Left out (older admin page): keep what the astrologer has.
  const sharePercent = b.sharePercent === undefined || b.sharePercent === '' ? undefined : Math.round(Number(b.sharePercent) * 10) / 10;
  if (sharePercent !== undefined && !(sharePercent >= 0 && sharePercent <= 100)) fail(400, 'Share must be between 0% and 100%.');

  const existing = findAstrologer(phone);
  const a = existing || newAstrologer(phone);
  Object.assign(a, {
    name, ratePerMin: round2(ratePerMin), experienceYears, ...(sharePercent !== undefined ? { sharePercent } : {}),
    skills: list(b.skills, 40), languages: list(b.languages, 30), bio: str(b.bio, 1000),
  });
  if (!existing) data.users.push(a);
  setApproved(phone, name);
  save();
  broadcastAstrologer(a);
  console.log(`Admin ${existing ? 'updated' : 'registered'} astrologer ...${phone.slice(-4)}`);
  return { astrologer: adminAstrologerView({ phone, name }), created: !existing };
}));

// ---------- admin: contact-sharing monitor ----------
// Messages are checked when the admin looks, not flagged at send time, so older chats are covered and
// better rules apply to the past too. Only the admin's "reviewed" mark is stored, on the message.

function flaggedMessages() {
  const earlierBy = new Map(); // `${sessionId}:${senderId}` -> that sender's last few texts in the chat
  const out = [];
  for (const m of data.messages) {
    const key = `${m.sessionId}:${m.senderId}`;
    const earlier = earlierBy.get(key) || [];
    const flags = contactFlags(m.text, earlier);
    earlierBy.set(key, [...earlier, m.text].slice(-4));
    if (flags.length) out.push({ m, flags });
  }
  return out;
}

function flagView({ m, flags }) {
  const s = findSession(m.sessionId);
  const astrologer = s && findUser(s.astrologerId);
  const customer = s && findUser(s.customerId);
  return {
    id: m.id, text: m.text, createdAt: m.createdAt, senderRole: m.senderRole, flags,
    reviewed: Boolean(m.flagReviewedAt),
    session: s && { id: s.id, kind: s.kind || 'chat', startedAt: s.startedAt },
    astrologer: astrologer && { name: astrologer.name, phone: astrologer.phone },
    customer: customer && { name: customer.name || 'Customer', phone: customer.phone },
  };
}

// ?show=all includes messages already marked reviewed.
app.get('/admin/flags', adminAuth, h((req) => {
  const all = flaggedMessages().map(flagView);
  const byAstrologer = new Map();
  for (const f of all) {
    if (!f.astrologer) continue;
    const row = byAstrologer.get(f.astrologer.phone) || { ...f.astrologer, open: 0, total: 0 };
    row.total += 1;
    if (!f.reviewed) row.open += 1;
    byAstrologer.set(f.astrologer.phone, row);
  }
  return {
    flags: all.filter((f) => req.query.show === 'all' || !f.reviewed).reverse(), // newest first
    open: all.filter((f) => !f.reviewed).length,
    byAstrologer: [...byAstrologer.values()].sort((a, b) => b.open - a.open || b.total - a.total),
  };
}));

app.post('/admin/flags/:id/review', adminAuth, h((req) => {
  const m = data.messages.find((x) => x.id === req.params.id);
  if (!m) fail(404, 'Message not found');
  if (req.body.reviewed === false) delete m.flagReviewedAt;
  else m.flagReviewedAt = db.now();
  save();
  return { reviewed: Boolean(m.flagReviewedAt) };
}));

// ---------- astrologer photos ----------
// Kept as files next to the data file (the database only stores the path), so the astrologer list stays
// small and Firestore's 1 MB document limit never matters. Each upload gets a new file name, so the app
// can cache photos forever.

const PHOTOS_DIR = process.env.PHOTOS_DIR || path.join(path.dirname(db.DATA_FILE), 'photos');
fs.mkdirSync(PHOTOS_DIR, { recursive: true });
const PHOTO_TYPES = { jpg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46] };
const PHOTO_MAX_BYTES = 600 * 1024;
const PHOTO_FILE = /^[\w-]+\.(jpg|png|webp)$/;

app.get('/photos/:file', (req, res) => {
  if (!PHOTO_FILE.test(req.params.file)) return res.status(404).end();
  res.sendFile(path.join(PHOTOS_DIR, req.params.file), { maxAge: '365d', immutable: true }, (e) => e && !res.headersSent && res.status(404).end());
});

function deletePhoto(a) {
  const file = a.photo && path.basename(a.photo);
  if (file && PHOTO_FILE.test(file)) fs.rm(path.join(PHOTOS_DIR, file), { force: true }, () => {});
  delete a.photo;
}

// Body: { image: 'data:image/jpeg;base64,...' }. The type is checked from the file's own bytes, not the label.
app.put('/admin/astrologers/:phone/photo', adminAuth, h((req) => {
  const a = findAstrologer(mobileNumber(req.params.phone));
  if (!a) fail(404, 'Register the astrologer before adding a photo.');
  const m = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.image || ''));
  if (!m) fail(400, 'Choose a JPG, PNG or WebP image.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > PHOTO_MAX_BYTES) fail(413, 'That photo is too large. Use one under 600 KB.');
  const ext = Object.keys(PHOTO_TYPES).find((k) => PHOTO_TYPES[k].every((byte, i) => buf[i] === byte));
  if (!ext || (ext === 'webp' && buf.toString('latin1', 8, 12) !== 'WEBP')) fail(400, 'Choose a JPG, PNG or WebP image.');
  const file = `${a.id}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(PHOTOS_DIR, file), buf);
  deletePhoto(a);
  a.photo = `/photos/${file}`;
  save();
  broadcastAstrologer(a);
  console.log(`Admin set the photo of astrologer ...${a.phone.slice(-4)}`);
  return { photo: a.photo };
}));

app.delete('/admin/astrologers/:phone/photo', adminAuth, h((req) => {
  const a = findAstrologer(mobileNumber(req.params.phone));
  if (!a) fail(404, 'That number is not registered.');
  deletePhoto(a);
  save();
  broadcastAstrologer(a);
  return { photo: null };
}));

// Remove sign-in access. The account and its history stay; it disappears from the customer app.
app.delete('/admin/astrologers/:phone', adminAuth, h((req) => {
  const phone = mobileNumber(req.params.phone);
  if (!removeApproved(phone)) fail(404, 'That number is not on the astrologer list.');
  const a = findAstrologer(phone);
  if (a?.online) { a.online = false; save(); }
  console.log(`Admin removed astrologer ...${phone.slice(-4)}`);
  return { ok: true };
}));

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
