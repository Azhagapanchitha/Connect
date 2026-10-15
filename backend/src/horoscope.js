// Deterministic "daily horoscope" generator so the apps have content without a 3rd-party API.
const SIGNS = [
  'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
  'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces',
];

const OPENERS = [
  'The Moon highlights your sense of purpose today.',
  'Venus brings warmth to your closest relationships.',
  'Mercury sharpens your communication — speak your mind.',
  'Mars fuels your ambition; take the first step.',
  'Jupiter opens a door you thought was closed.',
  'Saturn asks for patience and steady effort.',
];
const MIDDLES = [
  'A conversation at work could turn into an opportunity.',
  'Pay attention to your finances before making a big purchase.',
  'Someone from your past may reach out unexpectedly.',
  'Your intuition is especially strong — trust it.',
  'Small acts of kindness will come back to you.',
  'Take time to rest; your energy needs recharging.',
];
const CLOSERS = [
  'Evening favours quiet reflection.',
  'Wear something bright to lift your mood.',
  'Avoid rushing important decisions.',
  'A short walk will clear your thoughts.',
  'Gratitude unlocks unexpected joy.',
  'Lean on a friend you trust.',
];
const COLORS = ['Red', 'Green', 'Yellow', 'White', 'Gold', 'Blue', 'Orange', 'Purple'];

function hash(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function daily(sign, date = new Date()) {
  sign = String(sign).toLowerCase();
  if (!SIGNS.includes(sign)) return null;
  const day = date.toISOString().slice(0, 10);
  const h = hash(sign + day);
  return {
    sign,
    date: day,
    text: [OPENERS[h % 6], MIDDLES[(h >> 3) % 6], CLOSERS[(h >> 6) % 6]].join(' '),
    luckyNumber: (h % 9) + 1,
    luckyColor: COLORS[(h >> 9) % COLORS.length],
    mood: ['Calm', 'Energetic', 'Romantic', 'Focused', 'Playful'][(h >> 12) % 5],
  };
}

module.exports = { SIGNS, daily };
