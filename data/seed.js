// The Marlowe — seed data for the two-sided hotel demo.
//
// PUBLIC side (the booking site) shows rack rates + the availability the public
// channel is allowed to see. The RezMaster PMS (behind the front-desk login)
// shows the negotiated/corporate rates and the TRUE availability — rooms held
// back from the public channel. That gap is the whole "hydrate" story.
//
// All data is fictional. This app exists only to be taken apart on stage.

export const TODAY = '2026-07-06';
export const TOMORROW = '2026-07-07';

// Front-desk staff login (RezMaster). Deliberately weak demo credentials.
export const STAFF = [
  { email: 'frontdesk@themarlowe.test', password: 'reception24', name: 'Dana Reyes', role: 'Front Desk' },
];

// Room types shown on the public booking site.
// publicAvailable = what the booking widget will sell.
// trueAvailable   = what RezMaster actually has (>= public; the difference is
//                   held back for corporate/group/loyalty).
export const ROOMS = [
  {
    slug: 'classic-queen',
    name: 'Classic Queen',
    blurb: 'A calm, light-filled room with a plush queen bed and city-garden views.',
    amenities: ['Queen bed', 'Rain shower', 'Nespresso', 'Smart TV', 'Work desk'],
    sleeps: 2,
    rackRate: 219,
    photo: 'marlowe-room.png',
    publicAvailable: 3,
    trueAvailable: 5,
  },
  {
    slug: 'garden-queen',
    name: 'Garden Queen',
    blurb: 'Our signature queen, opening onto the planted courtyard terrace.',
    amenities: ['Queen bed', 'Courtyard terrace', 'Soaking tub', 'Nespresso', 'Smart TV'],
    sleeps: 2,
    rackRate: 259,
    photo: 'marlowe-room.png',
    publicAvailable: 2,
    trueAvailable: 4,
  },
  {
    slug: 'marlowe-suite',
    name: 'The Marlowe Suite',
    blurb: 'A gracious suite with a separate sitting room and marble writing desk.',
    amenities: ['King bed', 'Separate sitting room', 'Marble bath', 'Bar cart', 'Courtyard view'],
    sleeps: 3,
    rackRate: 389,
    photo: 'marlowe-suite.png',
    publicAvailable: 1,
    trueAvailable: 3,
  },
  {
    slug: 'loft-king',
    name: 'Loft King',
    blurb: 'Top-floor loft with beamed ceilings and a king bed under the eaves.',
    amenities: ['King bed', 'Top floor', 'Beamed ceilings', 'Soaking tub', 'Skyline view'],
    sleeps: 2,
    rackRate: 349,
    photo: 'marlowe-suite.png',
    publicAvailable: 0, // public shows SOLD OUT — but RezMaster has 2 held rooms
    trueAvailable: 2,
  },
  {
    slug: 'courtyard-double',
    name: 'Courtyard Double',
    blurb: 'Two double beds off the quiet courtyard — our most flexible room.',
    amenities: ['Two doubles', 'Courtyard view', 'Rain shower', 'Nespresso', 'Smart TV'],
    sleeps: 4,
    rackRate: 199,
    photo: 'marlowe-room.png',
    publicAvailable: 4,
    trueAvailable: 6,
  },
];

// Guests — the login-gated gold. Loyalty tier + corporate account drive the
// negotiated rate that never appears on the public site.
export const GUESTS = [
  {
    id: 'G-1007',
    name: 'Jordan Avery',
    email: 'jordan.avery@acme-corp.test',
    phone: '+1 415 555 1111', // memorable member number for the demo (ends 1111)
    loyaltyTier: 'Gold',
    corporateAccount: 'Acme Corp',
    negotiatedPct: 0.18,
    cardOnFile: 'Amex ending 1005', // revealed only after identity is verified
    notes: 'High floor, quiet room away from elevator. Allergic to feather bedding.',
    arriving: TOMORROW, // the demo protagonist
  },
  {
    id: 'G-1012',
    name: 'Priya Raman',
    email: 'priya.raman@gmail.test',
    phone: '+1 206 555 0199',
    loyaltyTier: 'Platinum',
    corporateAccount: null,
    negotiatedPct: 0.15, // platinum loyalty rate
    notes: 'Anniversary stay — sparkling wine on arrival if available.',
    arriving: '2026-07-08',
  },
  {
    id: 'G-1021',
    name: 'Marcus Feld',
    email: 'm.feld@globex.test',
    phone: '+44 20 7946 0321',
    loyaltyTier: 'Silver',
    corporateAccount: 'Globex',
    negotiatedPct: 0.12,
    notes: 'Early check-in usually requested. Prefers ground floor.',
    arriving: '2026-07-09',
  },
  {
    id: 'G-1033',
    name: 'Elena Sokolova',
    email: 'elena.s@outlook.test',
    phone: '+1 312 555 0173',
    loyaltyTier: 'None',
    corporateAccount: null,
    negotiatedPct: 0.10, // AAA
    notes: 'AAA member. Traveling with a small dog (pet room required).',
    arriving: '2026-07-07',
  },
  {
    id: 'G-1044',
    name: 'Tom Becker',
    email: 'tom.becker@initech.test',
    phone: '+1 512 555 0188',
    loyaltyTier: 'Gold',
    corporateAccount: 'Initech',
    negotiatedPct: 0.20,
    notes: 'VIP. Complimentary upgrade authorized when inventory allows.',
    arriving: '2026-07-10',
  },
  {
    // Standard guest — in the system, but NO corporate/loyalty/AAA rate. The demo's
    // "no preferred rate" foil to Jordan: same true inventory, but pays rack.
    id: 'G-1050',
    name: 'Chris Bell',
    email: 'chris.bell@gmail.test',
    phone: '+1 415 555 2222',
    loyaltyTier: 'None',
    corporateAccount: null,
    negotiatedPct: 0,
    notes: 'Standard guest — no negotiated rate on file.',
    arriving: '2026-07-08',
  },
];

// A couple of existing reservations so the PMS list isn't empty. The agent adds more.
export const RESERVATIONS = [
  {
    id: 'R-84021',
    guestId: 'G-1012',
    roomSlug: 'garden-queen',
    checkin: '2026-07-08',
    checkout: '2026-07-10',
    ratePlan: 'Loyalty (Platinum)',
    nightlyRate: 220,
    createdBy: 'Dana Reyes',
    createdAt: '2026-07-05',
  },
  {
    id: 'R-84022',
    guestId: 'G-1021',
    roomSlug: 'courtyard-double',
    checkin: '2026-07-09',
    checkout: '2026-07-11',
    ratePlan: 'Corporate (Globex)',
    nightlyRate: 175,
    createdBy: 'Dana Reyes',
    createdAt: '2026-07-05',
  },
];

// ---- helpers ----
export function roomBySlug(slug) {
  return ROOMS.find((r) => r.slug === slug) || null;
}
export function guestById(id) {
  return GUESTS.find((g) => g.id === id) || null;
}
export function money(n) {
  return Math.round(n);
}
// The negotiated nightly rate for a guest in a given room (the number the public
// site never shows). Corporate/loyalty/AAA percentage off the rack rate.
export function negotiatedRate(guest, room) {
  return money(room.rackRate * (1 - (guest?.negotiatedPct || 0)));
}
export function ratePlanLabel(guest) {
  if (guest.corporateAccount) return `Corporate (${guest.corporateAccount})`;
  if (guest.loyaltyTier && guest.loyaltyTier !== 'None') return `Loyalty (${guest.loyaltyTier})`;
  if (guest.negotiatedPct > 0) return 'AAA';
  return 'Standard';
}
