// Admin-managed list of astrologers allowed to sign in: [{ "phone": "9876543210", "name": "Meera Iyer" }, ...]
// Edit the file at any time; it is re-read when it changes. No file = every astrologer number may sign in.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const FILE = process.env.ASTROLOGERS_FILE || path.join(__dirname, '..', 'astrologers.json');
const key = (phone) => String(phone || '').replace(/\D/g, '').slice(-10); // ignore +91 / spaces

let cache = { mtimeMs: -1, list: null };

// Map of last-10-digit phone -> name, or null when no list file exists (open sign-in).
function approvedList() {
  let stat;
  try { stat = fs.statSync(FILE); } catch { return (cache = { mtimeMs: -1, list: null }).list; }
  if (stat.mtimeMs === cache.mtimeMs) return cache.list;
  let list;
  try {
    const rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!Array.isArray(rows)) throw new Error('expected a JSON array');
    list = new Map(rows.filter((r) => key(r.phone).length === 10).map((r) => [key(r.phone), String(r.name || '').trim()]));
    console.log(`Approved astrologers: ${list.size} loaded from ${FILE}`);
  } catch (e) {
    // A broken file must not open the door to everyone: allow nobody until it is fixed.
    console.error(`Could not read ${FILE} (${e.message}); no astrologer can sign in until it is fixed.`);
    list = new Map();
  }
  cache = { mtimeMs: stat.mtimeMs, list };
  syncNames(list);
  return list;
}

// The list owns astrologer names: apply them to existing accounts as soon as the file changes.
function syncNames(list) {
  let changed = false;
  for (const u of db.data.users) {
    const name = u.role === 'astrologer' && list.get(key(u.phone));
    if (name && u.name !== name) { u.name = name; changed = true; }
  }
  if (changed) db.save();
}

// { name } for an approved number, null if not approved, or { name: '' } when no list is in use.
function approvedAstrologer(phone) {
  const list = approvedList();
  if (!list) return { name: '' };
  return list.has(key(phone)) ? { name: list.get(key(phone)) } : null;
}

const isAllowed = (user) => user.role !== 'astrologer' || approvedAstrologer(user.phone) !== null;

// ---------- edits from the admin page ----------

// [{ phone, name }] as listed in the file (empty when there is no file).
function listApproved() {
  const list = approvedList();
  return list ? [...list].map(([phone, name]) => ({ phone, name })) : [];
}

// Write via a temp file and rename, so a crash never leaves a half-written list (which would lock everyone out).
function writeList(rows) {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(rows, null, 2)}\n`);
  fs.renameSync(tmp, FILE);
  cache.mtimeMs = -2; // two writes within one mtime tick must still reload
  approvedList(); // reload now and apply names to accounts
}

// Add a number to the list, or rename it if it's already there. Creating the file switches off open sign-in.
function setApproved(phone, name) {
  const rows = listApproved().filter((r) => r.phone !== key(phone));
  writeList([...rows, { phone: key(phone), name: String(name).trim() }]);
}

// Take a number off the list; its account stays but can no longer sign in or be booked.
function removeApproved(phone) {
  const rows = listApproved();
  const left = rows.filter((r) => r.phone !== key(phone));
  if (left.length === rows.length) return false;
  writeList(left);
  return true;
}

module.exports = { approvedAstrologer, isAllowed, listApproved, setApproved, removeApproved, ASTROLOGERS_FILE: FILE };
