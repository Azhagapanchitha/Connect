import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCall } from '../call/useCall';
import { Avatar } from './ui';
import { colors } from '../theme';

// Voice call in progress: who you're talking to, connection state, mute and hang up.
export default function CallPanel({ sessionId, other, live, elapsed, onEnd }) {
  const { state, otherJoined, muted, error, toggleMute, retry } = useCall(sessionId, live);

  let status = 'Connecting…';
  if (state === 'connected') status = otherJoined ? `On call · ${elapsed}` : `Waiting for ${other?.name || 'the other side'} to join…`;
  if (state === 'reconnecting') status = 'Reconnecting…';
  if (state === 'error') status = error;

  return (
    <View style={s.wrap}>
      <Avatar name={other?.name || '?'} color={other?.avatarColor || colors.primary} size={84} online={state === 'connected' && otherJoined} />
      <Text style={s.name}>{other?.name}</Text>
      <View style={s.statusRow}>
        {state === 'connecting' || state === 'reconnecting' ? <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 6 }} /> : null}
        <Text style={[s.status, state === 'error' && { color: colors.danger }]}>{status}</Text>
      </View>
      {state === 'error' ? (
        <Pressable onPress={retry} style={s.retry}><Text style={s.retryText}>Try again</Text></Pressable>
      ) : null}

      <View style={s.controls}>
        <Pressable onPress={toggleMute} disabled={state !== 'connected'} style={[s.round, muted && s.roundOn, state !== 'connected' && { opacity: 0.4 }]}>
          <Ionicons name={muted ? 'mic-off' : 'mic'} size={26} color={muted ? '#fff' : colors.text} />
        </Pressable>
        <Pressable onPress={onEnd} style={[s.round, s.hangup]}>
          <Ionicons name="call" size={26} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
        </Pressable>
      </View>
      <Text style={s.hint}>{muted ? 'You are muted' : 'Billing runs per minute while the call is live'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  name: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, minHeight: 22 },
  status: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  retry: { marginTop: 10, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.primarySoft },
  retryText: { color: colors.primaryDark, fontWeight: '700' },
  controls: { flexDirection: 'row', marginTop: 24 },
  round: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginHorizontal: 14 },
  roundOn: { backgroundColor: colors.text, borderColor: colors.text },
  hangup: { backgroundColor: colors.danger, borderColor: colors.danger },
  hint: { color: colors.muted, fontSize: 12, marginTop: 14 },
});
