import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Alert } from '../alert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth, useSocketEvent } from '../AuthContext';
import { Avatar, Badge, Button, Card, SectionTitle, Stars } from '../components/ui';
import { colors, money, timeAgo } from '../theme';

export default function AstrologerScreen({ route, navigation }) {
  const { id } = route.params;
  const { user } = useAuth();
  const [a, setA] = useState(null);

  useEffect(() => {
    api(`/astrologers/${id}`).then(setA).catch((e) => Alert.alert('Error', e.message));
  }, [id]);

  useSocketEvent('astrologer:update', useCallback((u) => {
    if (u.id === id) setA((prev) => (prev ? { ...prev, ...u } : prev));
  }, [id]));

  // Birth details are confirmed on the next screen, which then sends the chat or call request.
  function start(kind) {
    if (!user.name) return navigation.navigate('EditProfile');
    navigation.navigate('BirthDetails', { astrologerId: id, astrologerName: a.name, ratePerMin: a.ratePerMin, kind });
  }

  if (!a) return <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />;
  const available = a.online && !a.busy;

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        <Card style={{ alignItems: 'center' }}>
          <Avatar name={a.name} color={a.avatarColor} size={88} online={available} />
          <Text style={s.name}>{a.name}</Text>
          <Text style={s.meta}>{a.skills.join(' · ')}</Text>
          <View style={[s.row, { marginTop: 8 }]}>
            <Stars rating={a.rating} />
            <Text style={[s.meta, { marginLeft: 6 }]}>{a.rating ? a.rating.toFixed(1) : 'New'} · {a.ratingCount} reviews</Text>
          </View>
          <View style={[s.row, { marginTop: 16, justifyContent: 'space-around', alignSelf: 'stretch' }]}>
            <Stat label="Experience" value={`${a.experienceYears} yrs`} />
            <Stat label="Languages" value={a.languages.join(', ') || '—'} />
            <Stat label="Rate" value={`${money(a.ratePerMin)}/min`} />
          </View>
        </Card>

        <SectionTitle>About</SectionTitle>
        <Card><Text style={s.body}>{a.bio || 'No bio yet.'}</Text></Card>

        <SectionTitle>Reviews</SectionTitle>
        {a.reviews.length === 0 ? <Text style={s.meta}>No reviews yet.</Text> : null}
        {a.reviews.map((r) => (
          <Card key={r.id}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={{ fontWeight: '600', color: colors.text }}>{r.customerName}</Text>
              <Stars rating={r.rating} size={12} />
            </View>
            {r.comment ? <Text style={[s.body, { marginTop: 6 }]}>{r.comment}</Text> : null}
            <Text style={[s.meta, { marginTop: 6 }]}>{timeAgo(r.createdAt)}</Text>
          </Card>
        ))}
      </ScrollView>

      <View style={s.footer}>
        <View style={{ flex: 1 }}>
          <Text style={s.meta}>Wallet {money(user.wallet)}{user.packageMinutes ? ` · ${user.packageMinutes} package min` : ''} · {money(a.ratePerMin)}/min</Text>
          {available ? <Badge label="Available now" color={colors.success} /> : <Badge label={a.busy ? 'In a consultation' : 'Offline'} color={colors.muted} />}
        </View>
        <Button title="Chat" icon="chatbubbles" onPress={() => start('chat')} disabled={!available} />
        {a.callsEnabled ? <Button title="Call" icon="call" onPress={() => start('call')} disabled={!available} style={{ marginLeft: 8 }} /> : null}
      </View>
    </SafeAreaView>
  );
}

const Stat = ({ label, value }) => (
  <View style={{ alignItems: 'center', flex: 1 }}>
    <Text style={{ fontWeight: '700', color: colors.text, textAlign: 'center' }}>{value}</Text>
    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{label}</Text>
  </View>
);

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 12 },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  footer: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border },
});
