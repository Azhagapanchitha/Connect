import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Alert } from '../alert';
import { useAuth } from '../AuthContext';
import { Button, Chip, Input, SectionTitle } from '../components/ui';
import { colors, SIGNS } from '../theme';

// Used both for first-time onboarding and for "Edit profile".
export default function ProfileSetupScreen({ navigation }) {
  const { user, updateProfile } = useAuth();
  const [form, setForm] = useState({
    name: user.name || '',
    gender: user.gender || '',
    birthDate: user.birthDate || '',
    birthTime: user.birthTime || '',
    birthPlace: user.birthPlace || '',
    sign: user.sign || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.name.trim()) return Alert.alert('Please enter your name');
    if (form.birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.birthDate)) return Alert.alert('Birth date must look like 1995-04-12');
    if (form.birthTime && !/^\d{2}:\d{2}$/.test(form.birthTime)) return Alert.alert('Birth time must look like 06:30');
    setBusy(true);
    try {
      await updateProfile(form);
      if (navigation.canGoBack()) navigation.goBack();
    } catch (e) {
      Alert.alert('Could not save', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: colors.muted, marginBottom: 16 }}>
        Your birth details help astrologers prepare an accurate reading. They are only shared with the astrologer you chat with.
      </Text>
      <Input label="Full name" value={form.name} onChangeText={set('name')} placeholder="Your name" />
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6, fontWeight: '600' }}>Gender</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
        {['Female', 'Male', 'Other'].map((g) => <Chip key={g} label={g} selected={form.gender === g} onPress={() => set('gender')(g)} />)}
      </View>
      <Input label="Date of birth (YYYY-MM-DD)" value={form.birthDate} onChangeText={set('birthDate')} placeholder="1995-04-12" keyboardType="numbers-and-punctuation" maxLength={10} />
      <Input label="Time of birth (HH:MM, 24h)" value={form.birthTime} onChangeText={set('birthTime')} placeholder="06:30" keyboardType="numbers-and-punctuation" maxLength={5} />
      <Input label="Place of birth" value={form.birthPlace} onChangeText={set('birthPlace')} placeholder="City, Country" />
      <SectionTitle>Your zodiac sign</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20 }}>
        {SIGNS.map((sg) => <Chip key={sg.key} label={`${sg.symbol} ${sg.label}`} selected={form.sign === sg.key} onPress={() => set('sign')(sg.key)} />)}
      </View>
      <Button title="Save profile" onPress={save} loading={busy} />
    </ScrollView>
  );
}
