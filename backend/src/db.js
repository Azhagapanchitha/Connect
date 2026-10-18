// In-memory datastore, persisted to Firestore when FIREBASE_KEY_FILE points at a service-account key,
// and always to a JSON file (the only store without Firebase, a local backup with it).
// The server is a single instance, so memory stays the source of truth while it runs: Firestore is
// loaded once at start and every save() writes only the records that changed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data.json');
const KEY_FILE = process.env.FIREBASE_KEY_FILE;

const empty = () => ({
  users: [],        // { id, phone, role: 'customer'|'astrologer', name, createdAt, ...role fields }
  tokens: {},       // token -> userId
  sessions: [],     // chat and call consultations
  messages: [],     // { id, sessionId, senderId, text, createdAt }
  transactions: [], // wallet ledger
  reviews: [],      // { id, sessionId, astrologerId, customerId, rating, comment, createdAt }
  places: {},       // birth place text (lowercased) -> { lat, lon, label, timeZone } or null if not found
});
// Firestore layout: customers/{mobile} and astrologers/{mobile} hold the accounts (the mobile number is the
// document ID, so one record per number per role); the other lists use item.id; maps store { k, v } per key.
const ROLE_COLLECTIONS = { customers: 'customer', astrologers: 'astrologer' };
const LISTS = ['sessions', 'messages', 'transactions', 'reviews'];
const MAPS = ['tokens', 'places'];
const LEGACY = ['users']; // pre-split accounts collection, emptied on the first save
const COLLECTIONS = [...Object.keys(ROLE_COLLECTIONS), ...LISTS, ...MAPS, ...LEGACY];

const data = empty();

function readFile() {
  if (!fs.existsSync(DATA_FILE)) return null;
  try {
    return { ...empty(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch (e) {
    console.warn('Could not read data file, starting fresh:', e.message);
    return null;
  }
}

// ---------- Firestore sync ----------

let firestore = null;
const written = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])); // docId -> JSON last written
const mapDocId = (key) => crypto.createHash('sha1').update(key).digest('hex'); // map keys can hold '/' etc.
const order = (x) => x.createdAt || x.requestedAt || '';

function snapshotDocs(col) {
  const docs = new Map();
  if (ROLE_COLLECTIONS[col]) {
    for (const u of data.users) {
      if (u.role !== ROLE_COLLECTIONS[col]) continue;
      // Login keeps numbers unique per role; never let a duplicate silently overwrite another account.
      const docId = docs.has(u.phone) ? `${u.phone}-${u.id.slice(0, 8)}` : u.phone;
      if (docId !== u.phone) console.error(`Duplicate ${u.role} number ...${u.phone.slice(-4)}; stored as ${docId}`);
      docs.set(docId, JSON.stringify(u));
    }
  } else if (LISTS.includes(col)) for (const item of data[col]) docs.set(item.id, JSON.stringify(item));
  else if (MAPS.includes(col)) for (const [k, v] of Object.entries(data[col])) docs.set(mapDocId(k), JSON.stringify({ k, v }));
  return docs; // LEGACY collections map to nothing, so their documents get deleted
}

let syncing = null;
let again = false;
async function sync() {
  if (!firestore) return;
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    do {
      again = false;
      const ops = [];
      for (const col of COLLECTIONS) {
        const now = snapshotDocs(col);
        const prev = written[col];
        for (const [docId, json] of now) if (prev.get(docId) !== json) ops.push({ col, docId, json });
        for (const docId of prev.keys()) if (!now.has(docId)) ops.push({ col, docId, json: null });
      }
      for (let i = 0; i < ops.length; i += 450) { // Firestore batches hold at most 500 writes
        const chunk = ops.slice(i, i + 450);
        const batch = firestore.batch();
        for (const { col, docId, json } of chunk) {
          const ref = firestore.collection(col).doc(docId);
          if (json === null) batch.delete(ref); else batch.set(ref, JSON.parse(json));
        }
        try {
          await batch.commit();
          for (const { col, docId, json } of chunk) if (json === null) written[col].delete(docId); else written[col].set(docId, json);
        } catch (e) {
          console.error(`Firestore write failed (${e.message}); will retry on the next change.`);
          break;
        }
      }
    } while (again);
  })().finally(() => { syncing = null; });
  return syncing;
}

async function loadFirestore() {
  const { initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const key = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  firestore = getFirestore(initializeApp({ credential: cert(key) }));
  firestore.settings({ ignoreUndefinedProperties: true });

  const loaded = empty();
  let count = 0;
  let legacy = 0;
  const seen = new Set(); // role:mobile already loaded from the split collections
  for (const col of COLLECTIONS) {
    const snap = await firestore.collection(col).get();
    for (const doc of snap.docs) {
      const value = doc.data();
      written[col].set(doc.id, JSON.stringify(value));
      if (ROLE_COLLECTIONS[col]) { loaded.users.push(value); seen.add(`${value.role}:${value.phone}`); }
      else if (LEGACY.includes(col)) { if (!seen.has(`${value.role}:${value.phone}`)) { loaded.users.push(value); legacy++; } continue; }
      else if (LISTS.includes(col)) loaded[col].push(value);
      else loaded[col][value.k] = value.v;
      count++;
    }
  }
  for (const col of ['users', ...LISTS]) loaded[col].sort((a, b) => order(a).localeCompare(order(b)));
  return { loaded, count: count + legacy, legacy, project: key.project_id };
}

// ---------- public API ----------

// Load data before the server starts handling requests. Resolves to a short description of the store.
async function init() {
  const file = readFile();
  if (!KEY_FILE || !fs.existsSync(KEY_FILE)) {
    if (file) Object.assign(data, file);
    return `JSON file ${DATA_FILE}`;
  }
  const { loaded, count, legacy, project } = await loadFirestore();
  if (count === 0 && file && file.users.length) {
    // First start on Firebase: copy the existing JSON data across.
    Object.assign(data, file);
    await sync();
    return `Firestore (${project}), imported ${file.users.length} users from ${DATA_FILE}`;
  }
  Object.assign(data, loaded);
  if (legacy) {
    await sync(); // move accounts from the old users collection into customers/ and astrologers/
    return `Firestore (${project}), ${count} records; moved ${legacy} accounts into customers/astrologers`;
  }
  return `Firestore (${project}), ${count} records`;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    sync();
  }, 100);
}

// Write anything pending now, e.g. before the process exits.
async function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
  await sync();
  if (syncing) await syncing;
}

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

module.exports = { data, init, save, flush, id, now, reset: () => Object.assign(data, empty()) };
