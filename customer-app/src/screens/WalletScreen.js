import React, { useCallback, useState } from 'react';
import { FlatList, Linking, Platform, Text, View } from 'react-native';
import { Alert } from '../alert';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, Chip, Input, SectionTitle } from '../components/ui';
import { colors, money, timeAgo } from '../theme';

const AMOUNTS = [100, 200, 500, 1000, 2000];
const MIN_RECHARGE = 50; // same limits as the server's /wallet/cashfree/order
const MAX_RECHARGE = 50000;

let cashfreeSdkPromise = null;
function loadCashfreeSdk() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Browser window not available'));
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (cashfreeSdkPromise) return cashfreeSdkPromise;

  cashfreeSdkPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('cashfree-js-sdk');
    if (existing) {
      if (window.Cashfree) return resolve(window.Cashfree);
      existing.addEventListener('load', () => resolve(window.Cashfree));
      existing.addEventListener('error', () => reject(new Error('Failed to load Cashfree checkout SDK')));
      return;
    }
    const script = document.createElement('script');
    script.id = 'cashfree-js-sdk';
    script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
    script.async = true;
    script.onload = () => resolve(window.Cashfree);
    script.onerror = () => reject(new Error('Failed to load Cashfree checkout SDK'));
    document.body.appendChild(script);
  });
  return cashfreeSdkPromise;
}


export default function WalletScreen({ navigation }) {
  const { user, setUser } = useAuth();
  const [txs, setTxs] = useState([]);
  const [amount, setAmount] = useState(500);
  // Text in the "enter an amount" box; empty while a preset chip is chosen.
  const [typed, setTyped] = useState('');
  const amountProblem = amount < MIN_RECHARGE ? `Enter at least ${money(MIN_RECHARGE)}`
    : amount > MAX_RECHARGE ? `You can add up to ${money(MAX_RECHARGE)} at a time` : null;
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
    if (amountProblem) return Alert.alert('Check the amount', amountProblem);
    setBusy(true);
    try {
      const order = await api('/wallet/cashfree/order', { method: 'POST', body: { amount } });

      // Demo flow when server credentials are not configured yet
      if (order.demo) {
        await load();
        return Alert.alert('Recharge successful', `${money(order.amount ?? amount)} added to your wallet`);
      }

      if (Platform.OS === 'web') {
        const Cashfree = await loadCashfreeSdk();
        const cashfree = Cashfree({ mode: order.mode || 'sandbox' });

        await cashfree.checkout({
          paymentSessionId: order.paymentSessionId,
          redirectTarget: '_modal',
        });

        // Verify with backend
        const res = await api('/wallet/cashfree/verify', { method: 'POST', body: { orderId: order.orderId } });
        await load();

        if (res.paid) {
          Alert.alert('Payment successful', `${money(order.amount ?? amount)} added to your wallet`);
        } else {
          Alert.alert('Payment pending', 'If money was deducted, your wallet will be credited automatically once confirmed.');
        }
      } else {
        // Mobile (React Native / Expo) - open Cashfree checkout link in browser
        if (order.paymentLink) {
          await Linking.openURL(order.paymentLink);
          Alert.alert('Payment in progress', 'Complete your payment in the browser, then tap OK to refresh your balance.', [
            { text: 'OK', onPress: () => load() },
          ]);
        }
      }
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
            Alert.alert('Package added', `${p.minutes} minutes are ready to use for a chat or call with any astrologer.`, [
              { text: 'Later', style: 'cancel' },
              { text: 'Use now', onPress: () => navigation.navigate('Home') },
            ]);
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
            {user.packageMinutes ? (
              <Button
                small
                title="Use package: choose an astrologer"
                icon="call"
                onPress={() => navigation.navigate('Home')}
                style={{ marginTop: 12, alignSelf: 'flex-start', backgroundColor: colors.accent, borderColor: colors.accent }}
              />
            ) : null}
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
            {AMOUNTS.map((a) => <Chip key={a} label={money(a)} selected={!typed && amount === a} onPress={() => { setTyped(''); setAmount(a); }} />)}
          </View>
          <Input
            label="Or enter an amount (₹)"
            value={typed}
            onChangeText={(t) => {
              const digits = t.replace(/\D/g, '').replace(/^0+/, '').slice(0, 5);
              setTyped(digits);
              setAmount(Number(digits) || 0);
            }}
            placeholder={`${MIN_RECHARGE} – ${MAX_RECHARGE.toLocaleString('en-IN')}`}
            keyboardType="number-pad"
            maxLength={5}
          />
          {typed && amountProblem ? <Text style={{ color: colors.danger, fontSize: 12, marginTop: -8, marginBottom: 8 }}>{amountProblem}</Text> : null}
          <Button
            title={amountProblem ? 'Choose or enter an amount' : `Recharge ${money(amount)}`}
            icon="wallet"
            onPress={recharge}
            loading={busy}
            disabled={Boolean(amountProblem)}
            style={{ marginTop: 8 }}
          />
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
