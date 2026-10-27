// Push notifications through Expo's push service (which delivers via FCM on Android), so an astrologer
// hears new requests even when the app is closed. No secret is needed; the device tokens are the address.
const db = require('./db');

const isPushToken = (t) => /^Expo(nent)?PushToken\[[^\]]+\]$/.test(String(t || ''));

// Send one notification to all of a user's devices; drops tokens Expo reports as no longer registered.
async function notify(user, { title, body, data, channelId = 'default', ttlSeconds = 60 }) {
  const tokens = (user.pushTokens || []).filter(isPushToken);
  if (!tokens.length) return;
  const messages = tokens.map((to) => ({ to, title, body, data, channelId, priority: 'high', sound: 'ring.wav', ttl: ttlSeconds }));
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(8000),
    });
    const { data: tickets = [], errors } = await res.json();
    if (errors) console.warn('Push rejected:', JSON.stringify(errors).slice(0, 200));
    const dead = tickets.map((t, i) => (t.details?.error === 'DeviceNotRegistered' ? tokens[i] : null)).filter(Boolean);
    if (dead.length) {
      user.pushTokens = user.pushTokens.filter((t) => !dead.includes(t));
      db.save();
    }
  } catch (e) {
    console.warn('Push failed:', e.message);
  }
}

module.exports = { notify, isPushToken };
