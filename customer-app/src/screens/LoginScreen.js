import React, { useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  const scrollView = useRef(null);
  const sheetY = useRef(0);
  const contactSectionY = useRef(0);
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

  async function contactUs() {
    try {
      await Linking.openURL('mailto:slakitservices@gmail.com');
    } catch (e) {
      Alert.alert('Unable to open email', e.message);
    }
  }

  async function callUs() {
    try {
      await Linking.openURL('tel:8248952902');
    } catch (e) {
      Alert.alert('Unable to make a call', e.message);
    }
  }

  function showContactSection() {
    scrollView.current?.scrollTo({ y: sheetY.current + contactSectionY.current, animated: true });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={s.topBar}>
          <Pressable onPress={showContactSection} style={s.contactButton} accessibilityRole="button">
            <Ionicons name="mail-outline" size={16} color={colors.primary} />
            <Text style={s.contactText}>Contact Us</Text>
          </Pressable>
        </View>
        <ScrollView ref={scrollView} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={s.hero}>
            <Image
              source={require('../../assets/jothidaconnect-logo.png')}
              style={s.logo}
              resizeMode="contain"
              accessibilityLabel="JothidaConnect logo"
            />
          </View>
          <View
            style={s.sheet}
            onLayout={(event) => {
              sheetY.current = event.nativeEvent.layout.y;
            }}
          >
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
            <View
              style={s.contactSection}
              onLayout={(event) => {
                contactSectionY.current = event.nativeEvent.layout.y;
              }}
            >
              <Text style={s.contactHeading}>Contact Us</Text>
              <Pressable onPress={contactUs} style={s.contactDetail} accessibilityRole="button">
                <Ionicons name="mail-outline" size={18} color={colors.primary} />
                <Text style={s.contactDetailText}>slakitservices@gmail.com</Text>
              </Pressable>
              <Pressable onPress={callUs} style={s.contactDetail} accessibilityRole="button">
                <Ionicons name="call-outline" size={18} color={colors.primary} />
                <Text style={s.contactDetailText}>8248952902</Text>
              </Pressable>
            </View>
            <View style={s.aboutSection}>
              <Text style={s.contactHeading}>About Us</Text>
              <Text style={s.aboutLead}>Welcome to {APP_NAME} – Your Companion on the Journey of Life.</Text>
              <Text style={s.aboutText}>
                We believe that astrology can be a meaningful guide in understanding life&apos;s questions, exploring possibilities, and finding clarity when making important decisions.
              </Text>
              <Text style={s.aboutText}>
                Our platform connects you with independent and experienced astrologers who are available to offer personalized consultations through voice calls and chat.
              </Text>
              <Text style={s.aboutText}>
                Whether you have questions about love, relationships, marriage, career, finance, family, or personal growth, our goal is to make astrology consultations accessible, convenient, and comfortable.
              </Text>
              <Text style={s.aboutSubheading}>What We Offer</Text>
              <Text style={s.aboutText}>• Personalized Consultations: Connect with astrologers for guidance based on your questions.</Text>
              <Text style={s.aboutText}>• Voice Call Consultations: Speak directly with astrologers from anywhere.</Text>
              <Text style={s.aboutText}>• Chat Consultations: Get guidance through convenient text conversations.</Text>
              <Text style={s.aboutText}>• Multiple Astrologers: Explore different astrologers and choose the one that suits your preferences.</Text>
              <Text style={s.aboutText}>• Convenience: Access astrology consultations anytime, wherever you are.</Text>
              <Text style={s.aboutSubheading}>Our Mission</Text>
              <Text style={s.aboutText}>
                Our mission is to make astrology accessible to everyone by connecting people with astrologers through a simple, transparent, and user-friendly platform.
              </Text>
              <Text style={s.aboutSubheading}>Our Commitment</Text>
              <Text style={s.aboutText}>
                We strive to provide a secure, respectful, and transparent consultation experience. We aim to help users explore their questions and perspectives with greater clarity.
              </Text>
              <Text style={s.aboutClosing}>Your journey, your questions, your guidance.</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  topBar: { alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 8 },
  contactButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  contactText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  hero: { flex: 1, minHeight: 240, alignItems: 'center', justifyContent: 'center', padding: 16 },
  logo: { width: 240, height: 240, maxWidth: '100%' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 40 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 12 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  eye: { position: 'absolute', right: 12, top: 34, padding: 4 },
  link: { marginTop: 16, alignItems: 'center' },
  linkText: { color: colors.muted, fontSize: 14 },
  linkStrong: { color: colors.primary, fontWeight: '700' },
  small: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 12 },
  contactSection: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 24, paddingTop: 16 },
  aboutSection: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 24, paddingTop: 16 },
  contactHeading: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  contactDetail: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  contactDetailText: { color: colors.primary, fontSize: 14 },
  aboutLead: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 21, marginBottom: 10 },
  aboutText: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 10 },
  aboutSubheading: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  aboutClosing: { color: colors.primary, fontSize: 14, fontWeight: '700', marginTop: 4 },
  credit: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 24, letterSpacing: 0.3 },
});
