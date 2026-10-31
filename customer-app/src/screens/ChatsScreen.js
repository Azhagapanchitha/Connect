import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { useSocketEvent } from '../AuthContext';
import { Avatar, Badge, Card, Empty } from '../components/ui';
import { colors, money, ROLE, STATUS_LABEL, timeAgo } from '../theme';

const STATUS_COLOR = { active: colors.success, requested: colors.accent, ended: colors.primary };

// Consultation history — the same list in both apps, showing the other party.
export default function ChatsScreen({ navigation }) {
  const [list, setList] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(() => api('/sessions').then(setList).catch(() => {}), []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useSocketEvent('session:update', useCallback((sess) => {
    setList((prev) => (prev.some((x) => x.id === sess.id) ? prev.map((x) => (x.id === sess.id ? sess : x)) : [sess, ...prev]));
  }, []));

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, flexGrow: 1 }}
      data={list}
      keyExtractor={(x) => x.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListEmptyComponent={
        <Empty
          icon="chatbubbles-outline"
          title="No consultations yet"
          subtitle={ROLE === 'customer' ? 'Pick an astrologer from Home to start your first chat.' : 'Go online from the dashboard to receive chat requests.'}
        />
      }
      renderItem={({ item }) => {
        const other = ROLE === 'customer' ? item.astrologer : item.customer;
        const amount = ROLE === 'customer' ? item.amount : item.astrologerEarning;
        return (
          <Card onPress={() => navigation.navigate('Chat', { sessionId: item.id })} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar name={other?.name} color={other?.avatarColor || colors.primary} photo={other?.photo} size={46} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ fontWeight: '700', fontSize: 15, color: colors.text }}>{other?.name || 'Unknown'}</Text>
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>
                {timeAgo(item.startedAt || item.requestedAt)}{item.billedMinutes ? ` · ${item.billedMinutes} min · ${money(amount)}` : ''}
              </Text>
            </View>
            <Badge label={STATUS_LABEL[item.status]} color={STATUS_COLOR[item.status] || colors.muted} />
          </Card>
        );
      }}
    />
  );
}
