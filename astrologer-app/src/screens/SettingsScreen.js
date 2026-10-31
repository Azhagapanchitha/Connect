import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Card, Chip, SectionTitle } from '../components/ui';
import { useSettings } from '../settings';
import { colors } from '../theme';

const CHART_LANGUAGES = [
  { key: 'ta', label: 'தமிழ்' },
  { key: 'en', label: 'English' },
];

export default function SettingsScreen() {
  const { settings, setSetting } = useSettings();
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <SectionTitle style={{ marginTop: 0 }}>Horoscope language</SectionTitle>
      <Card>
        <Text style={{ color: colors.text, lineHeight: 20, marginBottom: 10 }}>
          Language of the client's jathagam in chats: rasi and navamsam charts, birth star and dasa/bhukti.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {CHART_LANGUAGES.map((l) => (
            <Chip key={l.key} label={l.label} selected={settings.chartLanguage === l.key} onPress={() => setSetting('chartLanguage', l.key)} />
          ))}
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Saved on this phone.</Text>
      </Card>
    </ScrollView>
  );
}
