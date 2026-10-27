// Customer passwords: stored only as a salted scrypt hash, compared in constant time,
// and guarded by a per-number lockout to slow down guessing.
const crypto = require('crypto');

const MIN_LENGTH = 8;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function checkPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Problem with a new password, or null if it's acceptable.
function passwordProblem(password) {
  const p = String(password || '');
  if (p.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters for your password.`;
  if (p.length > 128) return 'That password is too long.';
  return null;
}

// In-memory lockout per mobile number: resets on success or after the lock period.
const failures = new Map(); // phone -> { count, lockedUntil }
function lockedFor(phone) {
  const f = failures.get(phone);
  if (!f?.lockedUntil) return 0;
  if (Date.now() >= f.lockedUntil) { failures.delete(phone); return 0; }
  return Math.ceil((f.lockedUntil - Date.now()) / 60000);
}
function recordFailure(phone) {
  const f = failures.get(phone) || { count: 0, lockedUntil: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILURES) { f.lockedUntil = Date.now() + LOCK_MS; f.count = 0; }
  failures.set(phone, f);
}
const recordSuccess = (phone) => failures.delete(phone);

module.exports = { hashPassword, checkPassword, passwordProblem, lockedFor, recordFailure, recordSuccess };
