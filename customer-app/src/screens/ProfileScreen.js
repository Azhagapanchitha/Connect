import React from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../AuthContext';
import { API_URL } from '../api';
import { Avatar, Button, Card } from '../components/ui';
import { colors, money, signLabel } from '../theme';

const Row = ({ label, value }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
    <Text style={{ color: colors.muted }}>{label}</Text>
    <Text style={{ color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: 12 }}>{value || '—'}</Text>
  </View>
);

export default function ProfileScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const sg = signLabel(user.sign);
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Card style={{ alignItems: 'center' }}>
        <Avatar name={user.name} size={80} />
        <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 10 }}>{user.name}</Text>
        <Text style={{ color: colors.muted }}>+91 {user.phone}</Text>
      </Card>
      <Card>
        <Row label="Gender" value={user.gender} />
        <Row label="Date of birth" value={user.birthDate} />
        <Row label="Time of birth" value={user.birthTime} />
        <Row label="Place of birth" value={user.birthPlace} />
        <Row label="Zodiac sign" value={sg && `${sg.symbol} ${sg.label}`} />
        <Row label="Wallet" value={money(user.wallet)} />
      </Card>
      <Button title="Edit profile" icon="create-outline" variant="ghost" onPress={() => navigation.navigate('EditProfile')} />
      <Button
        title="Sign out"
        variant="danger"
        style={{ marginTop: 12 }}
        onPress={() => Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: signOut }])}
      />
      <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 24 }}>Server: {API_URL}</Text>
    </ScrollView>
  );
}
