import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import { api } from '../api';
import { playRemote, startAudio, stopAudio } from './setup';

// Joins the LiveKit room for a live call session (audio only) and leaves when `live` turns false.
export function useCall(sessionId, live) {
  const [state, setState] = useState('idle'); // idle | connecting | connected | reconnecting | error
  const [otherJoined, setOtherJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const roomRef = useRef(null);

  useEffect(() => {
    if (!live) return undefined;
    let cancelled = false;
    const cleanups = [];
    const room = new Room({ adaptiveStream: false, dynacast: false });
    roomRef.current = room;

    const syncOther = () => setOtherJoined(room.remoteParticipants.size > 0);
    room
      .on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Audio) cleanups.push(playRemote(track)); })
      .on(RoomEvent.ParticipantConnected, syncOther)
      .on(RoomEvent.ParticipantDisconnected, syncOther)
      .on(RoomEvent.ConnectionStateChanged, (s) => {
        if (s === ConnectionState.Connected) setState('connected');
        if (s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting) setState('reconnecting');
      });

    (async () => {
      setState('connecting');
      setError(null);
      try {
        await startAudio();
        const { url, token } = await api(`/sessions/${sessionId}/call-token`);
        if (cancelled) return;
        await room.connect(url, token);
        if (cancelled) return;
        await room.localParticipant.setMicrophoneEnabled(true);
        syncOther();
        setState('connected');
      } catch (e) {
        if (!cancelled) { setState('error'); setError(e.message || 'Could not connect the call'); }
      }
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
      room.disconnect();
      stopAudio();
      roomRef.current = null;
      setState('idle');
      setOtherJoined(false);
      setMuted(false);
    };
  }, [sessionId, live, attempt]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [muted]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, otherJoined, muted, error, toggleMute, retry };
}
