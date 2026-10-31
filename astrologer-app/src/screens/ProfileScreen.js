import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Alert } from '../alert';
import { useAuth } from '../AuthContext';
import { API_URL } from '../api';
import { Avatar, Badge, Button, Card, SectionTitle, Stars } from '../components/ui';
import { colors, money } from '../theme';

export default function ProfileScreen({ navigation }) {
  const { user, signOut } = useAuth();
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Card style={{ alignItems: 'center' }}>
        <Avatar name={user.name} color={user.avatarColor} size={84} online={user.online} />
        <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 10 }}>{user.name}</Text>
        <Text style={{ color: colors.muted }}>+91 {user.phone}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <Stars rating={user.rating} />
          <Text style={{ color: colors.muted, marginLeft: 6 }}>{user.rating ? user.rating.toFixed(1) : 'New'} ({user.ratingCount})</Text>
        </View>
        <Text style={{ color: colors.text, fontWeight: '700', marginTop: 8 }}>{money(user.ratePerMin)}/min · {user.experienceYears} yrs experience</Text>
      </Card>
      <SectionTitle>About</SectionTitle>
      <Card><Text style={{ color: colors.text, lineHeight: 21 }}>{user.bio || 'Add a bio so customers know your approach.'}</Text></Card>
      <SectionTitle>Expertise & languages</SectionTitle>
      <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {user.skills.map((sk) => <Badge key={sk} label={sk} />)}
        {user.languages.map((l) => <Badge key={l} label={l} color={colors.muted} />)}
      </Card>
      <Button title="Edit public profile" icon="create-outline" variant="ghost" onPress={() => navigation.navigate('EditProfile')} />
      <Button title="Settings" icon="settings-outline" variant="ghost" style={{ marginTop: 8 }} onPress={() => navigation.navigate('Settings')} />
      <Button
        title="Sign out"
        variant="danger"
        style={{ marginTop: 12 }}
        onPress={() => Alert.alert('Sign out?', 'You will be set offline.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign out', style: 'destructive', onPress: signOut },
        ])}
      />
      <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 24 }}>Server: {API_URL}</Text>
    </ScrollView>
  );
}
