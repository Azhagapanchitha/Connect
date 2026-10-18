// Demo data so both apps have something to show on first launch.
const db = require('./db');

const ASTROLOGERS = [
  { name: 'Acharya Vikram Sharma', skills: ['Vedic', 'Kundli', 'Career'], languages: ['Hindi', 'English'], experienceYears: 15, ratePerMin: 30, avatarColor: '#7C3AED', bio: 'Vedic astrologer specialising in career and marriage timing using Parashari and KP systems.' },
  { name: 'Meera Iyer', skills: ['Tarot', 'Love', 'Relationships'], languages: ['English', 'Tamil'], experienceYears: 8, ratePerMin: 25, avatarColor: '#DB2777', bio: 'Certified tarot reader helping clients find clarity in love and relationships.' },
  { name: 'Pandit Raghav Joshi', skills: ['Vastu', 'Vedic', 'Remedies'], languages: ['Hindi', 'Marathi'], experienceYears: 22, ratePerMin: 40, avatarColor: '#EA580C', bio: 'Third-generation astrologer and Vastu consultant. Practical remedies, no fear-mongering.' },
  { name: 'Ananya Rao', skills: ['Numerology', 'Career', 'Finance'], languages: ['English', 'Telugu', 'Kannada'], experienceYears: 6, ratePerMin: 18, avatarColor: '#0891B2', bio: 'Numerologist focused on business names, finance and career direction.' },
  { name: 'Guru Harpreet Singh', skills: ['Palmistry', 'Health', 'Vedic'], languages: ['Punjabi', 'Hindi', 'English'], experienceYears: 12, ratePerMin: 22, avatarColor: '#16A34A', bio: 'Palmistry and Vedic astrology with a focus on health and wellbeing.' },
  { name: 'Sister Grace', skills: ['Tarot', 'Psychic', 'Love'], languages: ['English'], experienceYears: 10, ratePerMin: 35, avatarColor: '#9333EA', bio: 'Intuitive tarot and angel-card readings.' },
];

function seedIfEmpty() {
  if (db.data.users.length) return false;
  ASTROLOGERS.forEach((a, i) => {
    db.data.users.push({
      id: db.id(), role: 'astrologer', phone: `900000000${i + 1}`,
      online: i < 3, rating: [4.8, 4.6, 4.9, 4.4, 4.5, 4.7][i], ratingCount: [312, 128, 540, 64, 97, 210][i],
      earnings: 0, createdAt: db.now(), ...a,
    });
  });
  db.data.users.push({
    id: db.id(), role: 'customer', phone: '9999999999', name: 'Demo Customer', gender: 'Female',
    birthDate: '1995-04-12', birthTime: '06:30', birthPlace: 'Chennai', sign: 'aries', wallet: 500, createdAt: db.now(),
  });
  db.save();
  console.log('Seeded demo data: astrologers 9000000001–9000000006, customer 9999999999');
  return true;
}

module.exports = { seedIfEmpty };

if (require.main === module) {
  (async () => {
    console.log(`Data store: ${await db.init()}`);
    db.reset();
    seedIfEmpty();
    await db.flush();
    process.exit(0);
  })();
}
