// Tiny JSON-file datastore. Good enough for development; swap for Postgres/Mongo in production.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data.json');

const empty = () => ({
  users: [],        // { id, phone, role: 'customer'|'astrologer', name, createdAt, ...role fields }
  tokens: {},       // token -> userId
  sessions: [],     // chat consultations
  messages: [],     // { id, sessionId, senderId, text, createdAt }
  transactions: [], // wallet ledger
  reviews: [],      // { id, sessionId, astrologerId, customerId, rating, comment, createdAt }
  places: {},       // birth place text (lowercased) -> { lat, lon, label, timeZone } or null if not found
});

let data = empty();
if (fs.existsSync(DATA_FILE)) {
  try {
    data = { ...empty(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch (e) {
    console.warn('Could not read data file, starting fresh:', e.message);
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }, 100);
}

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

module.exports = { data, save, id, now, reset: () => Object.assign(data, empty()) };
