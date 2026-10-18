// Voice calls via LiveKit: the server only mints short-lived room tokens; audio flows through LiveKit.
// Set LIVEKIT_URL (wss://...), LIVEKIT_API_KEY and LIVEKIT_API_SECRET to enable calls.
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');

const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
const callsEnabled = Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
const roomName = (sessionId) => `session-${sessionId}`;

// Token for one participant of one session's room, valid long enough for a long consultation.
async function callToken(sessionId, user) {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: user.id, name: user.name || user.role, ttl: '3h' });
  at.addGrant({ roomJoin: true, room: roomName(sessionId), canPublish: true, canSubscribe: true, canPublishData: false });
  return { url: LIVEKIT_URL, token: await at.toJwt(), room: roomName(sessionId) };
}

// Close the room when the session ends so neither side keeps talking unbilled. Best effort.
function closeRoom(sessionId) {
  if (!callsEnabled) return;
  const http = LIVEKIT_URL.replace(/^ws/, 'http');
  new RoomServiceClient(http, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    .deleteRoom(roomName(sessionId))
    .catch((e) => { if (!/not found|404/i.test(e.message)) console.warn('Could not close call room:', e.message); });
}

module.exports = { callsEnabled, callToken, closeRoom };
