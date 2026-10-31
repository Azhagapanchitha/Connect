import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_URL } from '../api';
import { colors } from '../theme';

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style, small }) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const bg = isPrimary ? colors.primary : isDanger ? colors.danger : 'transparent';
  const fg = isPrimary || isDanger ? '#fff' : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, borderColor: isDanger ? colors.danger : colors.primary, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={small ? 16 : 18} color={fg} style={{ marginRight: 6 }} /> : null}
          <Text style={[styles.buttonText, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Input({ label, style, ...props }) {
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.muted} style={[styles.input, props.multiline && { minHeight: 90, textAlignVertical: 'top' }, style]} {...props} />
    </View>
  );
}

export function Card({ children, style, onPress }) {
  const Wrapper = onPress ? Pressable : View;
  return <Wrapper onPress={onPress} style={[styles.card, style]}>{children}</Wrapper>;
}

// photo is the server path of an astrologer's picture (e.g. /photos/abc.jpg); the initials show when
// there is none or it fails to load.
export function Avatar({ name = '?', color = colors.primary, size = 48, online, photo }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  const [failed, setFailed] = useState(null);
  const uri = photo ? (/^https?:/.test(photo) ? photo : `${API_URL}${photo}`) : null;
  const circle = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={{ width: size, height: size }}>
      {uri && failed !== uri ? (
        <Image source={{ uri }} style={[circle, { backgroundColor: colors.primarySoft }]} onError={() => setFailed(uri)} />
      ) : (
        <View style={[styles.avatar, circle, { backgroundColor: color }]}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.38 }}>{initials}</Text>
        </View>
      )}
      {online !== undefined ? (
        <View style={[styles.dot, { backgroundColor: online ? colors.success : '#9CA3AF', width: size * 0.28, height: size * 0.28, borderRadius: size * 0.14 }]} />
      ) : null}
    </View>
  );
}

export function Chip({ label, selected, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
      <Text style={[styles.chipText, selected && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function Stars({ rating = 0, size = 14 }) {
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons key={i} name={rating >= i ? 'star' : rating >= i - 0.5 ? 'star-half' : 'star-outline'} size={size} color={colors.accent} />
      ))}
    </View>
  );
}

export function Badge({ label, color = colors.primary }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1A` }]}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export function Empty({ icon = 'sparkles-outline', title, subtitle }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={48} color={colors.border} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
    </View>
  );
}

export const SectionTitle = ({ children, style }) => <Text style={[styles.section, style]}>{children}</Text>;

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  button: { height: 50, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  buttonSmall: { height: 38, paddingHorizontal: 14, borderRadius: 10 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, fontWeight: '600' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: 0, bottom: 0, borderWidth: 2, borderColor: '#fff' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', marginRight: 8, marginBottom: 8 },
  chipText: { color: colors.text, fontSize: 14 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, alignSelf: 'flex-start' },
  empty: { alignItems: 'center', padding: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: 12 },
  emptySub: { fontSize: 14, color: colors.muted, marginTop: 4, textAlign: 'center' },
  section: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 12, marginTop: 8 },
});
