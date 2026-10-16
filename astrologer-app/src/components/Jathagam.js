import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api';
import { colors } from '../theme';

// South Indian chart: rasis sit in fixed cells, Meenam top-left, running clockwise from Mesham.
const CELL = [[0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [3, 0], [2, 0], [1, 0], [0, 0]]; // [row, col] by rasi index
const RASI_SHORT = ['Mesham', 'Rishabam', 'Mithunam', 'Kadagam', 'Simmam', 'Kanni', 'Thulam', 'Viruchigam', 'Dhanusu', 'Magaram', 'Kumbam', 'Meenam'];

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};
const isNow = (p, now) => new Date(p.start) <= now && now < new Date(p.end);

function Row({ label, value }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value || '—'}</Text>
    </View>
  );
}

function BasicDetails({ c, chart }) {
  return (
    <View style={s.card}>
      <Text style={s.title}>Basic details</Text>
      <Row label="Name" value={[c.name, c.gender].filter(Boolean).join(' · ')} />
      <Row label="Birth date" value={c.birthDate} />
      <Row label="Birth time" value={c.birthTime} />
      <Row label="Birth place" value={c.birthPlace} />
      {chart && !chart.error ? (
        <>
          <Row label="Rasi" value={`${chart.rasi.name} (${chart.rasi.en})`} />
          <Row label="Nakshatra" value={`${chart.nakshatra.name}, pada ${chart.nakshatra.pada}`} />
          <Row label="Lagna" value={chart.lagna && `${chart.lagna.rasiName} (${chart.lagna.rasiEn}) ${chart.lagna.degInRasi.toFixed(1)}°`} />
        </>
      ) : null}
    </View>
  );
}

function RasiChart({ chart, birthDate }) {
  const byRasi = Array.from({ length: 12 }, () => []);
  if (chart.lagna) byRasi[chart.lagna.rasi].push({ ...chart.lagna, isLagna: true });
  for (const p of chart.planets) byRasi[p.rasi].push(p);
  return (
    <View style={s.card}>
      <Text style={s.title}>Rasi chart</Text>
      <View style={s.chart}>
        {byRasi.map((list, i) => {
          const [row, col] = CELL[i];
          return (
            <View key={i} style={[s.cell, { top: `${row * 25}%`, left: `${col * 25}%` }, chart.lagna?.rasi === i && s.lagnaCell]}>
              <Text style={s.cellSign} numberOfLines={1}>{RASI_SHORT[i]}</Text>
              <Text style={s.cellPlanets}>
                {list.map((p, k) => (
                  <Text key={p.name} style={p.isLagna ? s.lagnaText : null}>
                    {k ? ' ' : ''}{p.short}{p.retro && !['Ra', 'Ke'].includes(p.short) ? 'ᴿ' : ''}
                  </Text>
                ))}
              </Text>
            </View>
          );
        })}
        <View style={s.center}>
          <Text style={s.centerTitle}>Rasi</Text>
          <Text style={s.centerSub}>{birthDate}</Text>
        </View>
      </View>
      <Text style={s.legend}>La Lagna · Su Sun · Mo Moon · Ma Mars · Me Mercury · Ju Jupiter · Ve Venus · Sa Saturn · Ra Rahu · Ke Ketu · ᴿ retrograde</Text>
    </View>
  );
}

function DasaBhukti({ dasa }) {
  const now = new Date();
  const current = dasa.dasas.find((d) => isNow(d, now));
  const currentBhukti = current?.bhuktis.find((b) => isNow(b, now));
  const [open, setOpen] = useState(current?.lord);
  return (
    <View style={s.card}>
      <Text style={s.title}>Dasa / Bhukti</Text>
      <Text style={s.note}>
        Balance at birth: {dasa.balance.lord} dasa {dasa.balance.years.toFixed(1)} yrs
        {current ? `\nNow running: ${current.lord} dasa · ${currentBhukti?.lord} bhukti (till ${fmtDate(currentBhukti?.end)})` : ''}
      </Text>
      {dasa.dasas.map((d) => {
        const expanded = open === d.lord;
        const running = current?.lord === d.lord;
        return (
          <View key={d.lord}>
            <Pressable onPress={() => setOpen(expanded ? null : d.lord)} style={[s.dasaRow, running && s.runningRow]}>
              <Text style={[s.dasaLord, running && s.runningText]}>{d.lord} dasa</Text>
              <Text style={s.dasaDates}>{fmtDate(d.start)} – {fmtDate(d.end)}</Text>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.muted} />
            </Pressable>
            {expanded ? d.bhuktis.map((b) => (
              <View key={b.lord} style={[s.bhuktiRow, isNow(b, now) && s.runningRow]}>
                <Text style={[s.bhuktiLord, isNow(b, now) && s.runningText]}>{d.lord} / {b.lord}</Text>
                <Text style={s.dasaDates}>{fmtDate(b.start)} – {fmtDate(b.end)}</Text>
              </View>
            )) : null}
          </View>
        );
      })}
    </View>
  );
}

// Top half of the astrologer's chat: basic details, then rasi chart, then dasa/bhukti.
export default function ClientPanel({ sessionId, customer }) {
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
          <RasiChart chart={chart} birthDate={customer.birthDate} />
          <DasaBhukti dasa={chart.dasa} />
          <Text style={s.footnote}>Lahiri ayanamsa {chart.ayanamsa.toFixed(2)}° · mean nodes · {chart.timeZone}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 10 },
  title: { fontWeight: '700', color: colors.primaryDark, marginBottom: 8, fontSize: 15 },
  row: { flexDirection: 'row', paddingVertical: 3 },
  rowLabel: { width: 92, color: colors.muted, fontSize: 13 },
  rowValue: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
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
