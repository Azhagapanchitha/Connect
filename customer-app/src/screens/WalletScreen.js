import React, { useCallback, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { Alert } from '../alert';
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
  const [packages, setPackages] = useState([]);
  const [buying, setBuying] = useState(null);

  const load = useCallback(() => Promise.all([api('/wallet'), api('/packages')]).then(([w, p]) => {
    setTxs(w.transactions);
    setPackages(p.packages);
    setUser((u) => ({ ...u, wallet: w.balance, packageMinutes: p.packageMinutes }));
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

  function buy(p) {
    Alert.alert(`Buy ${p.minutes} minutes for ${money(p.price)}?`, `${money(p.price)} is taken from your wallet balance.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Buy',
        onPress: async () => {
          setBuying(p.id);
          try {
            await api('/packages/buy', { method: 'POST', body: { packageId: p.id } });
            await load();
            Alert.alert('Package added', `${p.minutes} minutes are ready to use with any astrologer.`);
          } catch (e) {
            Alert.alert(e.status === 402 ? 'Not enough balance' : 'Could not buy package', e.status === 402 ? `${e.message}. Recharge below first.` : e.message);
          } finally {
            setBuying(null);
          }
        },
      },
    ]);
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
            <Text style={{ color: '#D8CCFF', marginTop: 6 }}>
              Package minutes: <Text style={{ color: '#fff', fontWeight: '700' }}>{user.packageMinutes || 0}</Text>
            </Text>
          </Card>
          {packages.length ? <SectionTitle>Minute packages</SectionTitle> : null}
          {packages.map((p) => (
            <Card key={p.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{p.minutes} minutes · {money(p.price)}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{money(p.perMinute)}/min · chat or call with any astrologer · never expires</Text>
              </View>
              <Button small title="Buy" onPress={() => buy(p)} loading={buying === p.id} />
            </Card>
          ))}
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
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
              {timeAgo(item.createdAt)}{item.minutes ? ` · ${item.type === 'package' ? '+' : '−'}${item.minutes} package min` : ''}
            </Text>
          </View>
          <Text style={{ fontWeight: '700', color: item.amount >= 0 ? colors.success : colors.danger }}>
            {item.amount >= 0 ? '+' : '−'}{money(Math.abs(item.amount))}
          </Text>
        </Card>
      )}
    />
  );
}
