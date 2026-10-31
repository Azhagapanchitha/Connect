import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api';
import { colors } from '../theme';
import { Input } from './ui';

// Place of birth field with search-as-you-type suggestions. Free text still works if nothing matches.
export default function PlaceInput({ value, onChangeText, ...props }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef('');

  useEffect(() => {
    if (!open) return undefined;
    const q = value.trim();
    latest.current = q;
    if (q.length < 3) { setResults([]); setLoading(false); return undefined; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const found = await api(`/places?q=${encodeURIComponent(q)}`);
        if (latest.current !== q) return; // the user kept typing; a newer search will answer
        setResults(found);
        setError('');
      } catch (e) {
        if (latest.current === q) { setResults([]); setError(e.message); }
      } finally {
        if (latest.current === q) setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [value, open]);

  function pick(place) {
    setOpen(false);
    setResults([]);
    onChangeText(place.label);
  }

  const showList = open && value.trim().length >= 3;
  return (
    <View>
      <Input
        value={value}
        onChangeText={(t) => { setOpen(true); onChangeText(t); }}
        onBlur={() => setTimeout(() => setOpen(false), 200)} // let a tap on a suggestion land first
        autoCorrect={false}
        {...props}
      />
      {showList ? (
        <View style={{ marginTop: -8, marginBottom: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' }}>
          {loading && !results.length ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={{ color: colors.muted, marginLeft: 8 }}>Searching…</Text>
            </View>
          ) : error ? (
            <Text style={{ color: colors.muted, padding: 12, fontSize: 13 }}>{error}</Text>
          ) : !results.length ? (
            <Text style={{ color: colors.muted, padding: 12, fontSize: 13 }}>No matching places. You can keep what you typed.</Text>
          ) : (
            results.map((p, i) => (
              <Pressable
                key={p.label}
                onPress={() => pick(p)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11, backgroundColor: pressed ? colors.primarySoft : '#fff', borderTopWidth: i ? 1 : 0, borderTopColor: colors.border })}
              >
                <Ionicons name="location-outline" size={16} color={colors.primary} />
                <Text style={{ color: colors.text, marginLeft: 8, flex: 1 }} numberOfLines={2}>{p.label}</Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}
