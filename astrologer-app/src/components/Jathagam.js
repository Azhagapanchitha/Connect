import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api';
import { useSettings } from '../settings';
import { colors } from '../theme';

// South Indian chart: rasis sit in fixed cells, Meenam top-left, running clockwise from Mesham.
const CELL = [[0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [3, 0], [2, 0], [1, 0], [0, 0]]; // [row, col] by rasi index

// The server sends names in English/transliteration; these lists match its order (see backend jathagam.js).
const NAKSHATRAS_EN = [
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashirsha', 'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha',
  'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
  'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati',
];

// Chart text by the astrologer's chosen language (Settings → Horoscope language).
const TEXT = {
  en: {
    rasis: ['Mesham', 'Rishabam', 'Mithunam', 'Kadagam', 'Simmam', 'Kanni', 'Thulam', 'Viruchigam', 'Dhanusu', 'Magaram', 'Kumbam', 'Meenam'],
    rasiEn: ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'],
    nakshatras: NAKSHATRAS_EN,
    short: { Lagna: 'La', Sun: 'Su', Moon: 'Mo', Mars: 'Ma', Mercury: 'Me', Jupiter: 'Ju', Venus: 'Ve', Saturn: 'Sa', Rahu: 'Ra', Ketu: 'Ke' },
    lords: { Ketu: 'Ketu', Venus: 'Venus', Sun: 'Sun', Moon: 'Moon', Mars: 'Mars', Rahu: 'Rahu', Jupiter: 'Jupiter', Saturn: 'Saturn', Mercury: 'Mercury' },
    retro: 'ᴿ',
    basic: 'Basic details', name: 'Name', birthDate: 'Birth date', birthTime: 'Birth time', birthPlace: 'Birth place',
    rasi: 'Rasi', nakshatra: 'Nakshatra', lagna: 'Lagna', pada: (n) => `pada ${n}`,
    charts: { rasi: 'Rasi', navamsa: 'Navamsam' }, chart: (name) => `${name} chart`,
    legend: 'La Lagna · Su Sun · Mo Moon · Ma Mars · Me Mercury · Ju Jupiter · Ve Venus · Sa Saturn · Ra Rahu · Ke Ketu · ᴿ retrograde',
    dasaTitle: 'Dasa / Bhukti', dasa: (lord) => `${lord} dasa`,
    balance: (lord, yrs) => `Balance at birth: ${lord} dasa ${yrs} yrs`,
    running: (d, b, till) => `Now running: ${d} dasa · ${b} bhukti (till ${till})`,
    footnote: (ayan, zone) => `Lahiri ayanamsa ${ayan}° · mean nodes · ${zone}`,
  },
  ta: {
    rasis: ['மேஷம்', 'ரிஷபம்', 'மிதுனம்', 'கடகம்', 'சிம்மம்', 'கன்னி', 'துலாம்', 'விருச்சிகம்', 'தனுசு', 'மகரம்', 'கும்பம்', 'மீனம்'],
    rasiEn: null,
    nakshatras: [
      'அஸ்வினி', 'பரணி', 'கார்த்திகை', 'ரோகிணி', 'மிருகசீரிடம்', 'திருவாதிரை', 'புனர்பூசம்', 'பூசம்', 'ஆயில்யம்',
      'மகம்', 'பூரம்', 'உத்திரம்', 'அஸ்தம்', 'சித்திரை', 'சுவாதி', 'விசாகம்', 'அனுஷம்', 'கேட்டை',
      'மூலம்', 'பூராடம்', 'உத்திராடம்', 'திருவோணம்', 'அவிட்டம்', 'சதயம்', 'பூரட்டாதி', 'உத்திரட்டாதி', 'ரேவதி',
    ],
    short: { Lagna: 'ல', Sun: 'சூ', Moon: 'சந்', Mars: 'செ', Mercury: 'பு', Jupiter: 'கு', Venus: 'சு', Saturn: 'சனி', Rahu: 'ரா', Ketu: 'கே' },
    lords: { Ketu: 'கேது', Venus: 'சுக்கிரன்', Sun: 'சூரியன்', Moon: 'சந்திரன்', Mars: 'செவ்வாய்', Rahu: 'ராகு', Jupiter: 'குரு', Saturn: 'சனி', Mercury: 'புதன்' },
    retro: '(வ)',
    basic: 'அடிப்படை விவரங்கள்', name: 'பெயர்', birthDate: 'பிறந்த தேதி', birthTime: 'பிறந்த நேரம்', birthPlace: 'பிறந்த இடம்',
    rasi: 'ராசி', nakshatra: 'நட்சத்திரம்', lagna: 'லக்னம்', pada: (n) => `${n}ம் பாதம்`,
    charts: { rasi: 'ராசி', navamsa: 'நவாம்சம்' }, chart: (name) => `${name} கட்டம்`,
    legend: 'ல லக்னம் · சூ சூரியன் · சந் சந்திரன் · செ செவ்வாய் · பு புதன் · கு குரு · சு சுக்கிரன் · சனி சனி · ரா ராகு · கே கேது · (வ) வக்ரம்',
    dasaTitle: 'திசை / புக்தி', dasa: (lord) => `${lord} திசை`,
    balance: (lord, yrs) => `பிறப்பில் திசை இருப்பு: ${lord} திசை ${yrs} ஆண்டுகள்`,
    running: (d, b, till) => `தற்போது: ${d} திசை · ${b} புக்தி (${till} வரை)`,
    footnote: (ayan, zone) => `லாஹிரி அயனாம்சம் ${ayan}° · சராசரி ராகு/கேது · ${zone}`,
  },
};

const useText = () => TEXT[useSettings().settings.chartLanguage] || TEXT.en;

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};
const isNow = (p, now) => new Date(p.start) <= now && now < new Date(p.end);
const rasiText = (t, i) => (t.rasiEn ? `${t.rasis[i]} (${t.rasiEn[i]})` : t.rasis[i]);
const starText = (t, name) => t.nakshatras[NAKSHATRAS_EN.indexOf(name)] || name;

function Row({ label, value }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value || '—'}</Text>
    </View>
  );
}

function BasicDetails({ c, chart }) {
  const t = useText();
  return (
    <View style={s.card}>
      <Text style={s.title}>{t.basic}</Text>
      <Row label={t.name} value={[c.name, c.gender].filter(Boolean).join(' · ')} />
      <Row label={t.birthDate} value={c.birthDate} />
      <Row label={t.birthTime} value={c.birthTime} />
      <Row label={t.birthPlace} value={c.birthPlace} />
      {chart && !chart.error ? (
        <>
          <Row label={t.rasi} value={rasiText(t, chart.rasi.index)} />
          <Row label={t.nakshatra} value={`${starText(t, chart.nakshatra.name)}, ${t.pada(chart.nakshatra.pada)}`} />
          <Row label={t.lagna} value={chart.lagna && `${rasiText(t, chart.lagna.rasi)} ${chart.lagna.degInRasi.toFixed(1)}°`} />
        </>
      ) : null}
    </View>
  );
}

// Rasi (D1) places each body by its rasi; Navamsam (D9) by its navamsa. Same South Indian grid for both.
const CHARTS = ['rasi', 'navamsa'];

function BirthChart({ chart, birthDate }) {
  const t = useText();
  const [tab, setTab] = useState('rasi');
  // A server from before navamsa was added sends no navamsa field: show the rasi chart alone.
  const tabs = chart.planets[0]?.navamsa === undefined ? CHARTS.slice(0, 1) : CHARTS;
  const field = tabs.includes(tab) ? tab : 'rasi';
  const label = t.charts[field];
  const byRasi = Array.from({ length: 12 }, () => []);
  if (chart.lagna) byRasi[chart.lagna[field]].push({ ...chart.lagna, isLagna: true });
  for (const p of chart.planets) byRasi[p[field]].push(p);
  return (
    <View style={s.card}>
      <View style={s.chartHead}>
        <Text style={[s.title, { marginBottom: 0, flex: 1 }]}>{t.chart(label)}</Text>
        {tabs.length > 1 ? (
          <View style={s.tabs}>
            {tabs.map((k) => (
              <Pressable key={k} onPress={() => setTab(k)} style={[s.tab, field === k && s.tabOn]}>
                <Text style={[s.tabText, field === k && s.tabTextOn]}>{t.charts[k]}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <View style={s.chart}>
        {byRasi.map((list, i) => {
          const [row, col] = CELL[i];
          return (
            <View key={i} style={[s.cell, { top: `${row * 25}%`, left: `${col * 25}%` }, chart.lagna?.[field] === i && s.lagnaCell]}>
              <Text style={s.cellSign} numberOfLines={1} adjustsFontSizeToFit>{t.rasis[i]}</Text>
              <Text style={s.cellPlanets}>
                {list.map((p, k) => (
                  <Text key={p.name} style={p.isLagna ? s.lagnaText : null}>
                    {k ? ' ' : ''}{t.short[p.name] || p.short}{p.retro && !['Rahu', 'Ketu'].includes(p.name) ? t.retro : ''}
                  </Text>
                ))}
              </Text>
            </View>
          );
        })}
        <View style={s.center}>
          <Text style={s.centerTitle}>{label}</Text>
          <Text style={s.centerSub}>{birthDate}</Text>
        </View>
      </View>
      <Text style={s.legend}>{t.legend}</Text>
    </View>
  );
}

function DasaBhukti({ dasa }) {
  const t = useText();
  const lord = (name) => t.lords[name] || name;
  const now = new Date();
  const current = dasa.dasas.find((d) => isNow(d, now));
  const currentBhukti = current?.bhuktis.find((b) => isNow(b, now));
  const [open, setOpen] = useState(current?.lord);
  return (
    <View style={s.card}>
      <Text style={s.title}>{t.dasaTitle}</Text>
      <Text style={s.note}>
        {t.balance(lord(dasa.balance.lord), dasa.balance.years.toFixed(1))}
        {current ? `\n${t.running(lord(current.lord), lord(currentBhukti?.lord), fmtDate(currentBhukti?.end))}` : ''}
      </Text>
      {dasa.dasas.map((d) => {
        const expanded = open === d.lord;
        const running = current?.lord === d.lord;
        return (
          <View key={d.lord}>
            <Pressable onPress={() => setOpen(expanded ? null : d.lord)} style={[s.dasaRow, running && s.runningRow]}>
              <Text style={[s.dasaLord, running && s.runningText]}>{t.dasa(lord(d.lord))}</Text>
              <Text style={s.dasaDates}>{fmtDate(d.start)} – {fmtDate(d.end)}</Text>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.muted} />
            </Pressable>
            {expanded ? d.bhuktis.map((b) => (
              <View key={b.lord} style={[s.bhuktiRow, isNow(b, now) && s.runningRow]}>
                <Text style={[s.bhuktiLord, isNow(b, now) && s.runningText]}>{lord(d.lord)} / {lord(b.lord)}</Text>
                <Text style={s.dasaDates}>{fmtDate(b.start)} – {fmtDate(b.end)}</Text>
              </View>
            )) : null}
          </View>
        );
      })}
    </View>
  );
}

// Top half of the astrologer's chat: basic details, then rasi/navamsam chart, then dasa/bhukti.
export default function ClientPanel({ sessionId, customer }) {
  const t = useText();
  const [chart, setChart] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api(`/sessions/${sessionId}/chart`).then(setChart).catch((e) => setError(e.message));
  }, [sessionId]);

  if (!customer) return null;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 4 }}>
      <BasicDetails c={customer} chart={chart} />
      {!chart && !error ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} /> : null}
      {error || chart?.error ? <Text style={s.warn}>{error || chart.error}</Text> : null}
      {chart?.warnings?.map((w) => <Text key={w} style={s.warn}>{w}</Text>)}
      {chart && !chart.error ? (
        <>
          <BirthChart chart={chart} birthDate={customer.birthDate} />
          <DasaBhukti dasa={chart.dasa} />
          <Text style={s.footnote}>{t.footnote(chart.ayanamsa.toFixed(2), chart.timeZone)}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 10 },
  title: { fontWeight: '700', color: colors.primaryDark, marginBottom: 8, fontSize: 15 },
  row: { flexDirection: 'row', paddingVertical: 3 },
  rowLabel: { width: 104, color: colors.muted, fontSize: 13 },
  rowValue: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
  chartHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  tabs: { flexDirection: 'row', backgroundColor: colors.primarySoft, borderRadius: 8, padding: 2 },
  tab: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  tabOn: { backgroundColor: colors.primaryDark },
  tabText: { fontSize: 12, fontWeight: '600', color: colors.primaryDark },
  tabTextOn: { color: '#fff' },
  chart: { width: '100%', maxWidth: 360, aspectRatio: 1, alignSelf: 'center', borderWidth: 1, borderColor: colors.primaryDark },
  cell: { position: 'absolute', width: '25%', height: '25%', borderWidth: 0.5, borderColor: colors.primaryDark, padding: 3 },
  lagnaCell: { backgroundColor: colors.primarySoft },
  cellSign: { fontSize: 9, color: colors.muted },
  cellPlanets: { fontSize: 13, color: colors.text, fontWeight: '700', marginTop: 2 },
  lagnaText: { color: colors.danger },
  center: { position: 'absolute', top: '25%', left: '25%', width: '50%', height: '50%', alignItems: 'center', justifyContent: 'center' },
  centerTitle: { fontSize: 18, fontWeight: '700', color: colors.primaryDark },
  centerSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  legend: { fontSize: 10, color: colors.muted, marginTop: 8, lineHeight: 14 },
  note: { fontSize: 12, color: colors.text, marginBottom: 8, lineHeight: 18 },
  dasaRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: colors.border },
  bhuktiRow: { flexDirection: 'row', paddingVertical: 5, paddingLeft: 22, paddingRight: 6 },
  runningRow: { backgroundColor: colors.primarySoft, borderRadius: 6 },
  dasaLord: { flex: 1, fontSize: 13, color: colors.text, fontWeight: '600' },
  bhuktiLord: { flex: 1, fontSize: 12, color: colors.text },
  runningText: { color: colors.primaryDark, fontWeight: '700' },
  dasaDates: { fontSize: 12, color: colors.muted, marginRight: 6 },
  warn: { fontSize: 12, color: '#92400E', backgroundColor: '#FFFBEB', padding: 8, borderRadius: 8, marginBottom: 8 },
  footnote: { fontSize: 10, color: colors.muted, textAlign: 'center', marginBottom: 6 },
});
