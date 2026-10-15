import React, { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { useAuth, useSocketEvent } from '../AuthContext';
import { Avatar, Button, Card, Empty, SectionTitle, Stars } from '../components/ui';
import { colors, money, signLabel, timeAgo } from '../theme';

export default function DashboardScreen({ navigation }) {
  const { user, setUser } = useAuth();
  const [d, setD] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(() => api('/astrologer/dashboard').then(setD).catch(() => {}), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useSocketEvent('session:update', load);
  useSocketEvent('session:request', load);
  useSocketEvent('earnings:update', load);

  async function toggleOnline(online) {
    setToggling(true);
    try {
      const u = await api('/astrologer/status', { method: 'POST', body: { online } });
      setUser(u);
      setD((prev) => (prev ? { ...prev, online: u.online } : prev));
    } catch (e) {
      Alert.alert('Could not change status', e.message);
    } finally {
      setToggling(false);
    }
  }

  async function respond(sessionId, action) {
    try {
      await api(`/sessions/${sessionId}/${action}`, { method: 'POST' });
      if (action === 'accept') navigation.navigate('Chat', { sessionId });
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
      load();
    }
  }

  const online = d ? d.online : user.online;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Card style={[s.row, { backgroundColor: online ? '#DCFCE7' : '#fff' }]}>
        <Avatar name={user.name} color={user.avatarColor} size={52} online={online} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.name}>{user.name}</Text>
          <Text style={{ color: online ? colors.success : colors.muted, fontWeight: '600' }}>
            {online ? 'Online — accepting chats' : 'Offline'}
          </Text>
        </View>
        <Switch value={!!online} onValueChange={toggleOnline} disabled={toggling} trackColor={{ true: colors.success }} />
      </Card>

      {d?.active?.map((sess) => (
        <Card key={sess.id} onPress={() => navigation.navigate('Chat', { sessionId: sess.id })} style={{ backgroundColor: colors.primary }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Live chat with {sess.customer?.name}</Text>
          <Text style={{ color: '#FFEFD5', marginTop: 4 }}>{sess.billedMinutes} min · {money(sess.astrologerEarning)} earned · Tap to open</Text>
        </Card>
      ))}

      <SectionTitle>Today</SectionTitle>
      <View style={s.statsRow}>
        <Stat label="Earned" value={money(d?.todayEarnings)} />
        <Stat label="Minutes" value={d?.todayMinutes ?? 0} />
        <Stat label="Chats" value={d?.todaySessions ?? 0} />
      </View>
      <View style={s.statsRow}>
        <Stat label="Available balance" value={money(d?.earnings)} />
        <Stat label="Rating" value={d?.rating ? d.rating.toFixed(1) : 'New'} extra={<Stars rating={d?.rating || 0} size={11} />} />
        <Stat label="Total chats" value={d?.totalSessions ?? 0} />
      </View>

      <SectionTitle>Chat requests</SectionTitle>
      {!d?.pending?.length ? (
        <Empty icon="notifications-outline" title="No pending requests" subtitle={online ? 'New requests will pop up here instantly.' : 'Go online to start receiving requests.'} />
      ) : (
        d.pending.map((sess) => {
          const sg = signLabel(sess.customer?.sign);
          return (
            <Card key={sess.id}>
              <Text style={s.name}>{sess.customer?.name}</Text>
              <Text style={s.meta}>
                {sg ? `${sg.symbol} ${sg.label} · ` : ''}{sess.customer?.gender || ''} · requested {timeAgo(sess.requestedAt)}
              </Text>
              <Text style={s.meta}>Born {sess.customer?.birthDate || '—'} {sess.customer?.birthTime || ''} · {sess.customer?.birthPlace || '—'}</Text>
              <View style={[s.row, { marginTop: 12 }]}>
                <Button small title="Decline" variant="danger" onPress={() => respond(sess.id, 'reject')} style={{ flex: 1, marginRight: 8 }} />
                <Button small title={`Accept · ${money(sess.ratePerMin)}/min`} icon="checkmark" onPress={() => respond(sess.id, 'accept')} style={{ flex: 2 }} />
              </View>
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

const Stat = ({ label, value, extra }) => (
  <Card style={{ flex: 1, marginHorizontal: 4, alignItems: 'center', paddingVertical: 14 }}>
    <Text style={{ fontWeight: '800', fontSize: 17, color: colors.text }}>{value}</Text>
    {extra}
    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4, textAlign: 'center' }}>{label}</Text>
  </Card>
);

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  statsRow: { flexDirection: 'row', marginHorizontal: -4 },
  name: { fontSize: 17, fontWeight: '700', color: colors.text },
  meta: { color: colors.muted, fontSize: 13, marginTop: 3 },
});
