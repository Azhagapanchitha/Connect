import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Input } from '../components/ui';
import { APP_NAME, colors, ROLE } from '../theme';

const TAGLINE = ROLE === 'customer'
  ? 'Talk to trusted astrologers, anytime.'
  : 'Consult clients and grow your practice.';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('phone');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);

  async function sendOtp() {
    setBusy(true);
    try {
      const res = await api('/auth/request-otp', { method: 'POST', body: { phone } });
      setHint(res.devOtp ? `Development mode — use OTP ${res.devOtp}` : '');
      setStep('otp');
    } catch (e) {
      Alert.alert('Could not send OTP', e.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      await signIn(phone, otp);
    } catch (e) {
      Alert.alert('Sign in failed', e.message);
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.primaryDark }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.hero}>
          <Text style={s.logo}>✦</Text>
          <Text style={s.title}>{APP_NAME}</Text>
          <Text style={s.tagline}>{TAGLINE}</Text>
        </View>
        <View style={s.sheet}>
          {step === 'phone' ? (
            <>
              <Text style={s.heading}>Sign in with your phone</Text>
              <Input label="Mobile number" placeholder="10-digit mobile number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} maxLength={13} />
              <Button title="Send OTP" onPress={sendOtp} loading={busy} disabled={phone.replace(/\D/g, '').length < 10} />
            </>
          ) : (
            <>
              <Text style={s.heading}>Enter the OTP sent to {phone}</Text>
              <Input label="OTP" placeholder="4-digit code" keyboardType="number-pad" value={otp} onChangeText={setOtp} maxLength={6} autoFocus />
              {hint ? <Text style={s.hint}>{hint}</Text> : null}
              <Button title="Verify & continue" onPress={verify} loading={busy} disabled={otp.length < 4} />
              <Button title="Change number" variant="ghost" style={{ marginTop: 10, borderWidth: 0 }} onPress={() => { setStep('phone'); setOtp(''); }} />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { fontSize: 56, color: colors.accent },
  title: { fontSize: 32, fontWeight: '800', color: '#fff', marginTop: 8 },
  tagline: { fontSize: 16, color: '#E9E3FF', marginTop: 8, textAlign: 'center' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 40 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 16 },
  hint: { color: colors.primary, marginBottom: 12, fontWeight: '600' },
});
