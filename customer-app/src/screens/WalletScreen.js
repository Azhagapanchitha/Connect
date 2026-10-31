import React, { useCallback, useState } from 'react';
import { FlatList, Linking, Platform, Text, View } from 'react-native';
import { Alert } from '../alert';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, Chip, SectionTitle } from '../components/ui';
import { colors, money, timeAgo } from '../theme';

const AMOUNTS = [100, 200, 500, 1000, 2000];

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
  const [busy, setBusy] = useState(false);
  const [packages, setPackages] = useState([]);
  const [buying, setBuying] = useState(null);
  // GST is added on top of the recharge; the rate comes from the server (0 until it says otherwise).
  const [gstRate, setGstRate] = useState(0);
  const gst = Math.round(amount * gstRate * 100) / 100;
  const payable = Math.round((amount + gst) * 100) / 100;

  const load = useCallback(() => Promise.all([api('/wallet'), api('/packages')]).then(([w, p]) => {
    setTxs(w.transactions);
    setGstRate(w.gstRate || 0);
    setPackages(p.packages);
    setUser((u) => ({ ...u, wallet: w.balance, packageMinutes: p.packageMinutes }));
  }).catch(() => {}), [setUser]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function recharge() {
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
          Alert.alert('Payment successful', `${money(order.amount ?? amount)} added to your wallet${order.gst ? ` (paid ${money(order.total)} incl. ${money(order.gst)} GST)` : ''}`);
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
            {AMOUNTS.map((a) => <Chip key={a} label={money(a)} selected={amount === a} onPress={() => setAmount(a)} />)}
          </View>
          {gstRate ? (
            <Card style={{ marginTop: 8, marginBottom: 0, paddingVertical: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.muted }}>Recharge amount</Text>
                <Text style={{ color: colors.text }}>{money(amount)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ color: colors.muted }}>GST ({Math.round(gstRate * 100)}%)</Text>
                <Text style={{ color: colors.text }}>{money(gst)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>You pay</Text>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{money(payable)}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>{money(amount)} is added to your wallet.</Text>
            </Card>
          ) : null}
          <Button title={gstRate ? `Pay ${money(payable)}` : `Recharge ${money(amount)}`} icon="wallet" onPress={recharge} loading={busy} style={{ marginTop: 8 }} />
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
