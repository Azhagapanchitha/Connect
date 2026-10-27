import React, { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Alert } from '../alert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../AuthContext';
import { Button, Input } from '../components/ui';
import { APP_NAME, colors } from '../theme';

const MIN_PASSWORD = 8;

// Accepts 98765 43210, +91 98765 43210 or 098765 43210; returns the 10 digits or null.
function mobile10(raw) {
  let p = raw.replace(/\D/g, '');
  if (p.length === 12 && p.startsWith('91')) p = p.slice(2);
  else if (p.length === 11 && p.startsWith('0')) p = p.slice(1);
  return /^\d{10}$/.test(p) ? p : null;
}

const COPY = {
  login: { heading: 'Sign in', button: 'Sign in' },
  register: { heading: 'Create your account', button: 'Create account' },
  set: { heading: 'Set a password', button: 'Save password & continue' },
};

export default function LoginScreen() {
  const { signInWithPassword } = useAuth();
  const [mode, setMode] = useState('login'); // login | register | set (older account without a password)
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const creating = mode !== 'login';
  const number = mobile10(phone);
  const ready = number && password.length >= (creating ? MIN_PASSWORD : 1) && (!creating || confirm.length > 0);

  function switchTo(next) {
    setMode(next);
    setPassword('');
    setConfirm('');
  }

  async function submit() {
    if (!number) return Alert.alert('Check your number', 'Enter your 10-digit mobile number.');
    if (creating && password !== confirm) return Alert.alert('Passwords don’t match', 'Type the same password in both boxes.');
    setBusy(true);
    try {
      await signInWithPassword(number, password, creating ? 'register' : 'login');
    } catch (e) {
      setBusy(false);
      if (e.data?.needsPassword) {
        switchTo('set');
        return Alert.alert('Set a password', 'Your account doesn’t have a password yet. Choose one to continue.');
      }
      if (e.status === 404) {
        switchTo('register');
        return Alert.alert('New here?', 'There is no account for this number yet. Create one with a password.');
      }
      Alert.alert(creating ? 'Could not create account' : 'Sign in failed', e.message);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.primaryDark }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={s.hero}>
            <Text style={s.logo}>✦</Text>
            <Text style={s.title}>{APP_NAME}</Text>
            <Text style={s.tagline}>Talk to trusted astrologers, anytime.</Text>
          </View>
          <View style={s.sheet}>
            <Text style={s.heading}>{COPY[mode].heading}</Text>
            {mode === 'set' ? <Text style={s.note}>Your account was created before passwords. Choose one to keep using it.</Text> : null}
            <Input label="Mobile number" placeholder="10-digit mobile number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} maxLength={16} autoComplete="tel" />
            <View>
              <Input
                label={creating ? `Password (at least ${MIN_PASSWORD} characters)` : 'Password'}
                placeholder="Password"
                secureTextEntry={!show}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoComplete={creating ? 'new-password' : 'current-password'}
                textContentType={creating ? 'newPassword' : 'password'}
                style={{ paddingRight: 44 }}
              />
              <Pressable onPress={() => setShow((v) => !v)} hitSlop={8} style={s.eye} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
                <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
              </Pressable>
            </View>
            {creating ? (
              <Input label="Confirm password" placeholder="Type it again" secureTextEntry={!show} value={confirm} onChangeText={setConfirm} autoCapitalize="none" autoComplete="new-password" />
            ) : null}
            <Button title={COPY[mode].button} onPress={submit} loading={busy} disabled={!ready} />

            {mode === 'login' ? (
              <>
                <Pressable onPress={() => switchTo('register')} style={s.link}>
                  <Text style={s.linkText}>New to {APP_NAME}? <Text style={s.linkStrong}>Create account</Text></Text>
                </Pressable>
                <Text style={s.small}>Forgot your password? Contact JothidaConnect support to reset it.</Text>
              </>
            ) : (
              <Pressable onPress={() => switchTo('login')} style={s.link}>
                <Text style={s.linkText}>Already have a password? <Text style={s.linkStrong}>Sign in</Text></Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  hero: { flex: 1, minHeight: 200, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { fontSize: 56, color: colors.accent },
  title: { fontSize: 32, fontWeight: '800', color: '#fff', marginTop: 8 },
  tagline: { fontSize: 16, color: '#E9E3FF', marginTop: 8, textAlign: 'center' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 40 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 12 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  eye: { position: 'absolute', right: 12, top: 34, padding: 4 },
  link: { marginTop: 16, alignItems: 'center' },
  linkText: { color: colors.muted, fontSize: 14 },
  linkStrong: { color: colors.primary, fontWeight: '700' },
  small: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 12 },
});
