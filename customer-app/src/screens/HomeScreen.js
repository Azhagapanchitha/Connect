import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api';
import { useAuth, useSocketEvent } from '../AuthContext';
import { Avatar, Badge, Card, Chip, Empty, Input, Stars } from '../components/ui';
import { colors, money, signLabel } from '../theme';

const SKILLS = ['All', 'Vedic', 'Tarot', 'Numerology', 'Vastu', 'Palmistry', 'Love', 'Career'];

const HORO_COLLAPSED_KEY = 'horoscope:collapsed';

// Tap to fold the reading down to one line, so the astrologer list sits higher; the choice is remembered.
function HoroscopeCard({ sign, onPress }) {
  const [h, setH] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (sign) api(`/horoscope/${sign}`).then(setH).catch(() => {});
  }, [sign]);
  useEffect(() => {
    AsyncStorage.getItem(HORO_COLLAPSED_KEY).then((v) => setCollapsed(v === '1')).catch(() => {});
  }, []);
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    AsyncStorage.setItem(HORO_COLLAPSED_KEY, next ? '1' : '0').catch(() => {});
  }
  if (!sign) {
    return (
      <Card style={s.horo} onPress={onPress}>
        <Text style={s.horoTitle}>Get your daily horoscope</Text>
        <Text style={s.horoText}>Add your zodiac sign in your profile →</Text>
      </Card>
    );
  }
  const sg = signLabel(sign);
  return (
    <Card style={[s.horo, collapsed && s.horoCollapsed]} onPress={toggle}>
      <View style={s.row}>
        <Text style={[s.horoTitle, { flex: 1 }, collapsed && { marginBottom: 2 }]}>{sg.symbol} {sg.label} · Today</Text>
        <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={18} color="#D8CCFF" accessibilityLabel={collapsed ? 'Show full horoscope' : 'Hide horoscope'} />
      </View>
      <Text style={s.horoText} numberOfLines={collapsed ? 1 : undefined}>{h ? h.text : 'Reading the stars…'}</Text>
      {h && !collapsed ? (
        <View style={[s.row, { marginTop: 12 }]}>
          <Text style={s.horoMeta}>Lucky number {h.luckyNumber}</Text>
          <Text style={s.horoMeta}>  ·  {h.luckyColor}</Text>
          <Text style={s.horoMeta}>  ·  {h.mood}</Text>
        </View>
      ) : null}
    </Card>
  );
}

export function AstrologerRow({ a, onPress }) {
  const status = a.busy ? { label: 'Busy', color: colors.accent } : a.online ? { label: 'Online', color: colors.success } : { label: 'Offline', color: colors.muted };
  return (
    <Card onPress={onPress} style={s.row}>
      <Avatar name={a.name} color={a.avatarColor} size={56} online={a.online && !a.busy} />
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={s.name} numberOfLines={1}>{a.name}</Text>
        <Text style={s.meta} numberOfLines={1}>{a.skills.join(', ')}</Text>
        <Text style={s.meta} numberOfLines={1}>{a.languages.join(', ')} · {a.experienceYears} yrs</Text>
        <View style={[s.row, { marginTop: 4 }]}>
          <Stars rating={a.rating} size={12} />
          <Text style={[s.meta, { marginLeft: 4 }]}>{a.rating ? a.rating.toFixed(1) : 'New'} ({a.ratingCount})</Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.rate}>{money(a.ratePerMin)}<Text style={s.meta}>/min</Text></Text>
        <View style={{ marginTop: 8 }}><Badge label={status.label} color={status.color} /></View>
      </View>
    </Card>
  );
}

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [skill, setSkill] = useState('All');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (skill !== 'All') params.set('skill', skill);
    try { setList(await api(`/astrologers?${params}`)); } catch {}
  }, [q, skill]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Keep online/busy badges live without polling.
  useSocketEvent('astrologer:update', useCallback((a) => {
    setList((prev) => prev.map((x) => (x.id === a.id ? { ...x, ...a } : x)));
  }, []));

  const header = (
    <View>
      <Text style={s.greeting}>Namaste{user.name ? `, ${user.name.split(' ')[0]}` : ''} 🙏</Text>
      <HoroscopeCard sign={user.sign} onPress={() => navigation.navigate('EditProfile')} />
      <Input placeholder="Search astrologers, skills…" value={q} onChangeText={setQ} returnKeyType="search" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        {SKILLS.map((sk) => <Chip key={sk} label={sk} selected={skill === sk} onPress={() => setSkill(sk)} />)}
      </ScrollView>
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16 }}
      data={list}
      keyExtractor={(a) => a.id}
      ListHeaderComponent={header}
      ListEmptyComponent={<Empty icon="search-outline" title="No astrologers found" subtitle="Try a different search or filter." />}
      renderItem={({ item }) => <AstrologerRow a={item} onPress={() => navigation.navigate('Astrologer', { id: item.id })} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    />
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  greeting: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 12 },
  horo: { backgroundColor: colors.primaryDark },
  horoCollapsed: { paddingVertical: 10 },
  horoTitle: { color: colors.accent, fontWeight: '700', fontSize: 16, marginBottom: 6 },
  horoText: { color: '#fff', fontSize: 15, lineHeight: 22 },
  horoMeta: { color: '#D8CCFF', fontSize: 12 },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  rate: { fontSize: 16, fontWeight: '700', color: colors.text },
});
