import React, { useCallback, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { Alert } from '../alert';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { useAuth, useSocketEvent } from '../AuthContext';
import { Button, Card, Input, SectionTitle } from '../components/ui';
import { colors, money, timeAgo } from '../theme';

export default function EarningsScreen() {
  const { user, setUser } = useAuth();
  const [txs, setTxs] = useState([]);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api('/wallet').then((w) => {
    setTxs(w.transactions);
    setUser((u) => ({ ...u, earnings: w.balance }));
  }).catch(() => {}), [setUser]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useSocketEvent('session:update', load);

  async function withdraw() {
    setBusy(true);
    try {
      // Demo flow: marks the payout as done. Connect a payouts provider (RazorpayX, Stripe Connect) for real transfers.
      await api('/astrologer/payouts', { method: 'POST', body: { amount: Number(amount) } });
      setAmount('');
      await load();
      Alert.alert('Withdrawal requested', 'The amount will reach your bank account in 1–2 working days.');
    } catch (e) {
      Alert.alert('Withdrawal failed', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16 }}
      data={txs}
      keyExtractor={(t) => t.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <>
          <Card style={{ backgroundColor: colors.primaryDark }}>
            <Text style={{ color: '#FDE6C8' }}>Available to withdraw</Text>
            <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 4 }}>{money(user.earnings)}</Text>
            <Text style={{ color: '#FDE6C8', fontSize: 12, marginTop: 6 }}>Your share is {user.sharePercent ?? 70}% of each billed minute.</Text>
          </Card>
          <SectionTitle>Withdraw</SectionTitle>
          <Input placeholder="Amount (min ₹100)" keyboardType="number-pad" value={amount} onChangeText={setAmount} />
          <Button title="Withdraw to bank" icon="cash-outline" onPress={withdraw} loading={busy} disabled={!(Number(amount) >= 100)} />
          <SectionTitle style={{ marginTop: 24 }}>History</SectionTitle>
          {txs.length === 0 ? <Text style={{ color: colors.muted }}>Earnings from completed chats will appear here.</Text> : null}
        </>
      }
      renderItem={({ item }) => (
        <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>{item.note}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{timeAgo(item.createdAt)}</Text>
          </View>
          <Text style={{ fontWeight: '700', color: item.amount >= 0 ? colors.success : colors.danger }}>
            {item.amount >= 0 ? '+' : '−'}{money(Math.abs(item.amount))}
          </Text>
        </Card>
      )}
    />
  );
}
