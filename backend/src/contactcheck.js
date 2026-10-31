// Spots chat messages that look like an attempt to share contact details or move the consultation
// (and payment) off JothidaConnect: phone numbers, emails, UPI IDs, links, messaging apps.
// For the admin's review only; messages are never altered or blocked because of it.

// Number words (English, Tamil transliteration, Tamil script), for numbers spelled out to dodge digit checks.
const NUMBER_WORDS = [
  'zero', 'oh', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'double', 'triple',
  'poojyam', 'pujyam', 'saiber', 'onnu', 'ondru', 'rendu', 'irandu', 'moonu', 'munu', 'naalu', 'nalu', 'anju', 'aindhu',
  'aaru', 'aru', 'ezhu', 'elu', 'ettu', 'onbadhu', 'ombodhu',
  'பூஜ்யம்', 'ஒன்று', 'ஒண்ணு', 'இரண்டு', 'ரெண்டு', 'மூன்று', 'மூணு', 'நான்கு', 'நாலு', 'ஐந்து', 'அஞ்சு', 'ஆறு', 'ஏழு', 'எட்டு', 'ஒன்பது',
];
// Six or more number words (or single digits) in a row; each must stand alone, not be part of a longer word.
const NUMBER_WORD_RUN = new RegExp(`(?<![\\p{L}\\p{M}\\d])(?:(?:${NUMBER_WORDS.join('|')}|\\d)(?:[\\s,.-]+|$)){6,}`, 'iu');

const RULES = [
  // A 10-digit Indian mobile (optionally +91/0), digits possibly broken up with spaces, dots or dashes.
  { kind: 'Phone number', test: (t) => findMobile(t) },
  { kind: 'Phone number in words', test: (t) => match(t, NUMBER_WORD_RUN) },
  { kind: 'Email', test: (t) => match(t, /[\w.+-]+\s*(?:@|\(at\)|\[at\])\s*[\w-]+\s*(?:\.|\(dot\)|\[dot\])\s*[a-z]{2,}/i) || match(t, /\b(?:g\s?mail|yahoo|hotmail|outlook|rediffmail)\b/i) },
  { kind: 'UPI / payment', test: (t) => match(t, /\b[\w.-]{2,}@(?:ok[a-z]+|ybl|ibl|axl|upi|paytm|apl|yapl|sbi|icici|hdfcbank|axisbank|kotak|freecharge|airtel|jio)\b/i) || match(t, /\b(?:g\s?pay|google\s?pay|phone\s?pe|paytm|bhim|upi|bank\s?(?:details|account|a\/c)|account\s?(?:number|no)|ifsc)\b/i) },
  { kind: 'Link', test: (t) => match(t, /\b(?:https?:\/\/|www\.)\S+/i) || match(t, /\b(?:wa\.me|t\.me|bit\.ly|tinyurl\.com|linktr\.ee)\/?\S*/i) || match(t, /\b[\w-]{2,}\.(?:com|in|net|org|me|io|co|info|online|site)\b/i) },
  { kind: 'Messaging / social app', test: (t) => match(t, /\b(?:whats\s?app|wats\s?app|watsapp|whatsap|wtsp|wa\s?no|telegram|tele\s?gram|insta(?:gram)?|facebook|fb\s?(?:id|page)|messenger|snap\s?chat|signal\s?app|imo|botim|skype|zoom|google\s?meet|youtube\s?channel)\b/i) || match(t, /(?:வாட்ஸ்\s?அப்|வாட்சப்|டெலிகிராம்|இன்ஸ்டா)/u) },
  { kind: 'Asking to contact outside the app', test: (t) => match(t, /\b(?:my\s+(?:personal\s+)?(?:number|no\.?|mobile|cell|contact)|personal\s+(?:number|contact|no\.?)|call\s+me\s+(?:on|at|directly|direct)|contact\s+me\s+(?:on|at|directly|direct|outside)|outside\s+(?:the\s+|this\s+)?app|without\s+(?:the\s+|this\s+)?app|direct(?:ly)?\s+(?:call|contact|pay|payment)|pay\s+me\s+direct(?:ly)?|send\s+(?:me\s+)?(?:your\s+)?(?:number|no\.?)|give\s+(?:me\s+)?your\s+(?:number|no\.?))\b/i) || match(t, /(?:என்\s?நம்பர்|உங்க\s?நம்பர்|நம்பர்\s?(?:கொடுங்க|அனுப்பு)|போன்\s?நம்பர்)/u) },
];

function match(text, re) {
  const m = re.exec(text);
  return m ? m[0].trim() : null;
}

// Digits with up to 3 separator characters between them, so "98 765-43 210" and "+91 98765 43210" count.
function findMobile(text) {
  const runs = text.match(/\+?\d(?:[\s.\-()]{0,3}\d)+/g) || [];
  for (const run of runs) {
    const digits = run.replace(/\D/g, '');
    if (digits.length < 10) continue;
    // Any 10-digit stretch starting 6-9 is how every Indian mobile number looks.
    if (/[6-9]\d{9}/.test(digits)) return run.trim();
  }
  return null;
}

// Reasons this message looks like contact sharing: [{ kind, match }], empty when it looks fine.
// `earlier` are the same sender's previous messages in this chat (oldest first), to catch a number sent
// a few digits at a time.
function contactFlags(text, earlier = []) {
  const flags = [];
  for (const rule of RULES) {
    const found = rule.test(text);
    if (found) flags.push({ kind: rule.kind, match: found });
  }
  // "name@gmail.com" also looks like a link to gmail.com; report it once, as the email.
  const email = flags.find((f) => f.kind === 'Email');
  if (email) {
    const i = flags.findIndex((f) => f.kind === 'Link' && email.match.includes(f.match));
    if (i >= 0) flags.splice(i, 1);
  }
  if (!flags.some((f) => f.kind === 'Phone number') && /\d/.test(text) && text.length <= 20) {
    // Short, mostly-digit messages in a row: join them and look again.
    const recent = [];
    for (let i = earlier.length - 1; i >= 0 && recent.length < 4; i--) {
      if (!/\d/.test(earlier[i]) || earlier[i].length > 20) break;
      recent.unshift(earlier[i]);
    }
    if (recent.length) {
      const joined = findMobile([...recent, text].join(' '));
      if (joined) flags.push({ kind: 'Phone number split across messages', match: [...recent, text].join(' | ') });
    }
  }
  return flags;
}

module.exports = { contactFlags };
