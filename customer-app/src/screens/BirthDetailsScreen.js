import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Alert } from '../alert';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import PlaceInput from '../components/PlaceInput';
import { Button, Chip, Input } from '../components/ui';
import { colors, dmyToIso, isoToDmy, maskDmy, money } from '../theme';

// Same rules as the server's birthDetailsProblem(), so mistakes show here before the request.
function problems(f) {
  const out = {};
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f.birthDate);
  const d = m && new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  if (!f.name.trim()) out.name = 'Enter the name for the reading.';
  if (!m) out.birthDate = 'Use the format DD/MM/YYYY, e.g. 12/04/1995.';
  else if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[1] || +m[3] < 1900) out.birthDate = 'That date does not exist.';
  else if (d > new Date()) out.birthDate = 'Date of birth cannot be in the future.';
  if (!/^\d{2}:\d{2}$/.test(f.birthTime)) out.birthTime = 'Use 24-hour HH:MM, e.g. 06:30 or 18:45.';
  else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.birthTime)) out.birthTime = 'Hours go 00–23 and minutes 00–59.';
  if (!f.birthPlace.trim()) out.birthPlace = 'Enter the town or city, e.g. Madurai, Tamil Nadu.';
  return out;
}

const Hint = ({ text }) => (text ? <Text style={{ color: colors.danger, fontSize: 12, marginTop: -6, marginBottom: 10 }}>{text}</Text> : null);

// Shown every time a customer taps Chat: confirm the birth details the astrologer's chart will use.
export default function BirthDetailsScreen({ route, navigation }) {
  const { astrologerId, astrologerName, ratePerMin, kind = 'chat' } = route.params;
  const { user, updateProfile } = useAuth();
  const [form, setForm] = useState({
    name: user.name || '',
    gender: user.gender || '',
    birthDate: isoToDmy(user.birthDate),
    birthTime: user.birthTime || '',
    birthPlace: user.birthPlace || '',
  });
  // With package minutes left the customer picks how to pay; the package is the default, as it's prepaid.
  const packageMinutes = user.packageMinutes || 0;
  const [payWith, setPayWith] = useState(packageMinutes > 0 ? 'package' : 'wallet');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const errors = problems(form);
  const show = (k) => (tried ? errors[k] : null);

  async function submit() {
    setTried(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      await updateProfile({ ...form, name: form.name.trim(), birthDate: dmyToIso(form.birthDate), birthPlace: form.birthPlace.trim() });
      const session = await api('/sessions', { method: 'POST', body: { astrologerId, kind, payWith } });
      navigation.replace('Chat', { sessionId: session.id });
    } catch (e) {
      if (e.status === 402) {
        Alert.alert('Low balance', e.message, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Recharge', onPress: () => navigation.navigate('Tabs', { screen: 'Wallet' }) },
        ]);
      } else {
        Alert.alert(kind === 'call' ? 'Could not start call' : 'Could not start chat', e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22, marginBottom: 6 }}>
        {astrologerName} will cast your birth chart from these details. Check them before the {kind === 'call' ? 'call' : 'chat'} starts.
      </Text>
      <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 18 }}>
        An exact time and place give an accurate lagna and dasa. They are saved to your profile and shared only with the astrologer you chat with.
      </Text>

      <Input label="Name" value={form.name} onChangeText={set('name')} placeholder="Full name" />
      <Hint text={show('name')} />
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6, fontWeight: '600' }}>Gender</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
        {['Female', 'Male', 'Other'].map((g) => <Chip key={g} label={g} selected={form.gender === g} onPress={() => set('gender')(g)} />)}
      </View>
      <Input label="Date of birth (DD/MM/YYYY)" value={form.birthDate} onChangeText={(t) => set('birthDate')(maskDmy(t))} placeholder="12/04/1995" keyboardType="number-pad" maxLength={10} />
      <Hint text={show('birthDate')} />
      <Input label="Time of birth (HH:MM, 24-hour)" value={form.birthTime} onChangeText={set('birthTime')} placeholder="06:30" keyboardType="numbers-and-punctuation" maxLength={5} />
      <Hint text={show('birthTime')} />
      <PlaceInput label="Place of birth" value={form.birthPlace} onChangeText={set('birthPlace')} placeholder="Town or city, state, country" />
      <Hint text={show('birthPlace')} />

      {packageMinutes > 0 ? (
        <>
          <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 4, fontWeight: '600' }}>Pay with</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label={`Package · ${packageMinutes} min left`} selected={payWith === 'package'} onPress={() => setPayWith('package')} />
            <Chip label={`Wallet · ${money(user.wallet)}`} selected={payWith === 'wallet'} onPress={() => setPayWith('wallet')} />
          </View>
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17, marginBottom: 12 }}>
            {payWith === 'package'
              ? `Each minute uses 1 package minute. If they run out, the rest is charged from your wallet at ${money(ratePerMin)}/min.`
              : `Charged from your wallet at ${money(ratePerMin)}/min. Your package minutes are kept for later.`}
          </Text>
        </>
      ) : null}

      <Button
        title={`Confirm & request ${kind === 'call' ? 'call' : 'chat'} · ${payWith === 'package' ? 'package minutes' : `${money(ratePerMin)}/min`}`}
        icon={kind === 'call' ? 'call' : 'chatbubbles'}
        onPress={submit}
        loading={busy}
        style={{ marginTop: 8 }}
      />
    </ScrollView>
  );
}
