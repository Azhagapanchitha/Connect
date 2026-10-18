// Browsers have WebRTC built in; the mic prompt comes from the browser when the call connects.
export function setupCalls() {}
export async function startAudio() {}
export function stopAudio() {}

// Browsers need an <audio> element per remote track; returns a cleanup function.
export function playRemote(track) {
  const el = track.attach();
  el.autoplay = true;
  document.body.appendChild(el);
  return () => track.detach().forEach((e) => e.remove());
}
