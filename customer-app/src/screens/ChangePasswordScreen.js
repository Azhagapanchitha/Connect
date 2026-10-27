import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Alert } from '../alert';
import { api } from '../api';
import { Button, Input } from '../components/ui';
import { colors } from '../theme';

const MIN_PASSWORD = 8;

export default function ChangePasswordScreen({ navigation }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (next.length < MIN_PASSWORD) return Alert.alert('Too short', `Use at least ${MIN_PASSWORD} characters for your new password.`);
    if (next !== confirm) return Alert.alert('Passwords don’t match', 'Type the same new password in both boxes.');
    setBusy(true);
    try {
      await api('/me/password', { method: 'POST', body: { current, next } });
      Alert.alert('Password changed', 'Use your new password the next time you sign in.');
      navigation.goBack();
    } catch (e) {
      Alert.alert('Could not change password', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <Input label="Current password" secureTextEntry value={current} onChangeText={setCurrent} autoCapitalize="none" autoComplete="current-password" />
      <Input label={`New password (at least ${MIN_PASSWORD} characters)`} secureTextEntry value={next} onChangeText={setNext} autoCapitalize="none" autoComplete="new-password" />
      <Input label="Confirm new password" secureTextEntry value={confirm} onChangeText={setConfirm} autoCapitalize="none" autoComplete="new-password" />
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 16 }}>You stay signed in on this phone after changing it.</Text>
      <Button title="Change password" onPress={save} loading={busy} disabled={!current || !next || !confirm} />
    </ScrollView>
  );
}
