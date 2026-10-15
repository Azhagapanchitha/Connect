import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, Chip, SectionTitle } from '../components/ui';
import { colors, money, timeAgo } from '../theme';

const AMOUNTS = [100, 200, 500, 1000, 2000];

export default function WalletScreen() {
  const { user, setUser } = useAuth();
  const [txs, setTxs] = useState([]);
  const [amount, setAmount] = useState(500);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api('/wallet').then((w) => {
    setTxs(w.transactions);
    setUser((u) => ({ ...u, wallet: w.balance }));
  }).catch(() => {}), [setUser]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function recharge() {
    setBusy(true);
    try {
      // Demo flow: the server credits instantly. Hook up Razorpay/Stripe here for real payments.
      await api('/wallet/recharge', { method: 'POST', body: { amount } });
      await load();
      Alert.alert('Recharge successful', `${money(amount)} added to your wallet`);
    } catch (e) {
      Alert.alert('Recharge failed', e.message);
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
      ListHeaderComponent={
        <>
          <Card style={{ backgroundColor: colors.primaryDark }}>
            <Text style={{ color: '#D8CCFF' }}>Wallet balance</Text>
            <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 4 }}>{money(user.wallet)}</Text>
          </Card>
          <SectionTitle>Add money</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {AMOUNTS.map((a) => <Chip key={a} label={money(a)} selected={amount === a} onPress={() => setAmount(a)} />)}
          </View>
          <Button title={`Recharge ${money(amount)}`} icon="wallet" onPress={recharge} loading={busy} style={{ marginTop: 8 }} />
          <SectionTitle style={{ marginTop: 24 }}>Transactions</SectionTitle>
          {txs.length === 0 ? <Text style={{ color: colors.muted }}>No transactions yet.</Text> : null}
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
