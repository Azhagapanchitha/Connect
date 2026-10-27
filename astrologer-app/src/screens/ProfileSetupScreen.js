import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Alert } from '../alert';
import { useAuth } from '../AuthContext';
import { Button, Chip, Input, SectionTitle } from '../components/ui';
import { colors } from '../theme';

const SKILLS = ['Vedic', 'Kundli', 'Tarot', 'Numerology', 'Vastu', 'Palmistry', 'KP System', 'Psychic', 'Love', 'Career', 'Finance', 'Health', 'Remedies', 'Relationships'];
const LANGUAGES = ['English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati', 'Punjabi'];

const toggle = (list, item) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

// Used for onboarding and for editing the public profile customers see.
export default function ProfileSetupScreen({ navigation }) {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user.name || '');
  const [bio, setBio] = useState(user.bio || '');
  const [skills, setSkills] = useState(user.skills || []);
  const [languages, setLanguages] = useState(user.languages || []);
  const [experienceYears, setExp] = useState(String(user.experienceYears || ''));
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return Alert.alert('Please enter your display name');
    if (!skills.length) return Alert.alert('Pick at least one expertise');
    if (!languages.length) return Alert.alert('Pick at least one language');
    setBusy(true);
    try {
      await updateProfile({ name, bio, skills, languages, experienceYears: Number(experienceYears) || 0 });
      if (navigation.canGoBack()) navigation.goBack();
    } catch (e) {
      Alert.alert('Could not save', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: colors.muted, marginBottom: 16 }}>This is your public profile. Customers see it before starting a chat.</Text>
      <Input label="Display name" value={name} onChangeText={setName} placeholder="e.g. Acharya Vikram Sharma" />
      <Input label="About you" value={bio} onChangeText={setBio} placeholder="Your approach, specialities, background…" multiline />
      <SectionTitle>Expertise</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {SKILLS.map((sk) => <Chip key={sk} label={sk} selected={skills.includes(sk)} onPress={() => setSkills(toggle(skills, sk))} />)}
      </View>
      <SectionTitle>Languages</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
        {LANGUAGES.map((l) => <Chip key={l} label={l} selected={languages.includes(l)} onPress={() => setLanguages(toggle(languages, l))} />)}
      </View>
      <Input label="Experience (years)" value={experienceYears} onChangeText={setExp} keyboardType="number-pad" maxLength={2} />
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 20 }}>Your rate is set by the JothidaConnect admin. You keep 70% of every minute billed. Payouts can be withdrawn from the Earnings tab.</Text>
      <Button title="Save profile" onPress={save} loading={busy} />
    </ScrollView>
  );
}
