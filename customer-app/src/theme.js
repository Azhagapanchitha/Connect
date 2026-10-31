export const ROLE = 'customer';
export const APP_NAME = 'JothidaConnect';

export const colors = {
  primary: '#6D28D9',
  primaryDark: '#4C1D95',
  primarySoft: '#EDE9FE',
  accent: '#F59E0B',
  bg: '#FEFAEF',
  card: '#FFFFFF',
  text: '#1F1A2E',
  muted: '#6B6680',
  border: '#E6E1F0',
  success: '#16A34A',
  danger: '#DC2626',
  bubbleMine: '#6D28D9',
  bubbleTheirs: '#FFFFFF',
};

export const SIGNS = [
  { key: 'aries', label: 'Aries', symbol: '♈' },
  { key: 'taurus', label: 'Taurus', symbol: '♉' },
  { key: 'gemini', label: 'Gemini', symbol: '♊' },
  { key: 'cancer', label: 'Cancer', symbol: '♋' },
  { key: 'leo', label: 'Leo', symbol: '♌' },
  { key: 'virgo', label: 'Virgo', symbol: '♍' },
  { key: 'libra', label: 'Libra', symbol: '♎' },
  { key: 'scorpio', label: 'Scorpio', symbol: '♏' },
  { key: 'sagittarius', label: 'Sagittarius', symbol: '♐' },
  { key: 'capricorn', label: 'Capricorn', symbol: '♑' },
  { key: 'aquarius', label: 'Aquarius', symbol: '♒' },
  { key: 'pisces', label: 'Pisces', symbol: '♓' },
];

export const signLabel = (key) => SIGNS.find((s) => s.key === key);

export const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Birth dates are stored as YYYY-MM-DD but shown and typed as DD/MM/YYYY.
export function isoToDmy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || '';
}
export function dmyToIso(dmy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : dmy || '';
}
// Keeps only digits and inserts the slashes as the user types: "12041995" -> "12/04/1995".
export function maskDmy(text) {
  const d = text.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
}

export function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

export const STATUS_LABEL = {
  requested: 'Waiting',
  active: 'Live',
  ended: 'Completed',
  rejected: 'Declined',
  cancelled: 'Cancelled',
  missed: 'Missed',
};
