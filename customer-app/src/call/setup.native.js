import { PermissionsAndroid, Platform } from 'react-native';
import { AudioSession, registerGlobals } from '@livekit/react-native';

// Native WebRTC for livekit-client; must run before any Room is created.
export function setupCalls() {
  registerGlobals();
}

export async function startAudio() {
  if (Platform.OS === 'android') {
    const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (res !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Allow microphone access to take calls.');
  }
  await AudioSession.startAudioSession();
}

export function stopAudio() {
  AudioSession.stopAudioSession();
}

// Remote audio plays through the native audio session on its own.
export function playRemote() {
  return () => {};
}
