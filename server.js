// The Marlowe — a two-sided demo target for "No API? No Problem."
//
//   THE availability API — ONE endpoint, context decides the view:
//     GET /api/availability                 public: rack rate + public inventory (Wall 1)
//     GET /api/availability?contactId=G-1007 (logged in) that contact's rate + TRUE availability
//
//   PUBLIC booking site (no auth):
//     GET /                      home + rooms loaded via the availability feed
//     GET /rooms/:slug           server-rendered room detail (Wall 2 — parse DOM)
//     GET /search                date search (renders from the same feed)
//
//   REZMASTER 4.2 PMS (front-desk login):
//     GET/POST /rezmaster/login  session cookie + CSRF
//     GET /rezmaster             staff dashboard
//     GET /rezmaster/guests[/:id]  guest profile + negotiated rates (contact directory)
//     GET /rezmaster/api/guests  the contact directory JSON (phone → contactId)
//     POST /rezmaster/reservations   create a booking  (Wall 3 — act, CSRF-protected)
//
// In-memory, deterministic, resets on restart. Not for production.

import express from 'express';
import session from 'express-session';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runConcierge } from './concierge-agent.mjs';
import {
  TODAY,
  TOMORROW,
  STAFF,
  ROOMS,
  GUESTS,
  RESERVATIONS,
  roomBySlug,
  guestById,
  negotiatedRate,
  ratePlanLabel,
} from './data/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;
const SESSION_SECRET = process.env.SESSION_SECRET || 'marlowe-demo-not-a-real-secret';
const HARD_MODE = process.env.HARD_MODE === '1';

// Mutable reservation store (seeded), so bookings the agent makes show up in the PMS.
const reservations = RESERVATIONS.map((r) => ({ ...r }));
let resSeq = 84023;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Legacy-flavored server banner — the kind of detail that leaks a stack.
app.use((req, res, next) => {
  res.setHeader('X-Powered-By', 'RezMaster/4.2 (IIS)');
  next();
});

app.use(
  session({
    name: 'rm_session',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 },
  }),
);

app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.staff = req.session.staff || null;
  res.locals.TODAY = TODAY;
  res.locals.TOMORROW = TOMORROW;
  next();
});

function requireStaff(req, res, next) {
  if (!req.session.staff) return res.redirect('/rezmaster/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}
function checkCsrf(req, res, next) {
  if (!req.body || req.body._csrf !== req.session.csrf) {
    return res.status(403).render('error', {
      layoutSide: 'public',
      title: 'Forbidden',
      message: 'Invalid or missing security token (CSRF). Reload the form and try again.',
    });
  }
  next();
}
function looksLikeBrowser(req) {
  const ua = req.headers['user-agent'] || '';
  const accept = req.headers['accept'] || '';
  return /Mozilla|Chrome|Safari|Firefox/.test(ua) && /text\/html|application\/json|\*\/\*/.test(accept);
}

// ===========================================================================
// PUBLIC booking site
// ===========================================================================

app.get('/', (req, res) => {
  res.render('public/home', { title: 'The Marlowe', checkin: TOMORROW, checkout: addDays(TOMORROW, 2) });
});

app.get('/search', (req, res) => {
  const checkin = req.query.checkin || TOMORROW;
  const checkout = req.query.checkout || addDays(checkin, 2);
  res.render('public/results', { title: 'Availability — The Marlowe', checkin, checkout });
});

// THE availability API — ONE endpoint for everyone (public site, front desk, and agent).
// No contactId → public: rack rate + the public channel's inventory. With a contactId, while
// logged in as the business → THAT contact's negotiated rate + true availability (the rooms held
// off the public channel). The contactId is the only switch; whoever calls this — a browser, a
// curl, or the agent — asks the same way and the endpoint decides what to return.
// (Same shape as TeeFox's single /api/teetimes + customer_hash, minus the multi-integration machinery.)
app.get('/api/availability', (req, res) => {
  if (HARD_MODE && !looksLikeBrowser(req)) {
    return res.status(403).json({ error: 'Request blocked. Automated access is not permitted.' });
  }
  const checkin = req.query.checkin || TOMORROW;
  const checkout = req.query.checkout || addDays(checkin, 2);
  // A contact's private rate + held inventory are only revealed to the logged-in business.
  const contact = req.session.staff && req.query.contactId ? guestById(req.query.contactId) : null;
  const rooms = ROOMS.map((r) => {
    const available = contact ? r.trueAvailable : r.publicAvailable;
    const rate = contact ? negotiatedRate(contact, r) : r.rackRate;
    return {
      slug: r.slug,
      name: r.name,
      sleeps: r.sleeps,
      rate, // the price for THIS caller: rack, or the contact's negotiated rate
      rackRate: r.rackRate, // always present, so member savings are legible
      available, // public channel count, or true inventory for a known contact
      soldOut: available === 0,
      held: contact ? r.trueAvailable - r.publicAvailable : 0,
      photo: `/static/img/${r.photo}`,
    };
  });
  const staff = !!req.session.staff;
  res.json({
    hotel: 'The Marlowe',
    checkin,
    checkout,
    nights: nightsBetween(checkin, checkout),
    authenticated: staff, // false → you're not signed in as the business (contactId is ignored)
    // Loud signal so a demo never silently falls back to public:
    ...(req.query.contactId && !contact
      ? { note: staff ? `no contact ${req.query.contactId}` : 'not signed in as the business — showing public rates; contactId ignored' }
      : {}),
    contact: contact ? { id: contact.id, name: contact.name, ratePlan: ratePlanLabel(contact) } : null,
    rooms,
  });
});

// Wall 2 (public) — server-rendered room detail. No JSON equivalent.
app.get('/rooms/:slug', (req, res) => {
  const room = roomBySlug(req.params.slug);
  if (!room) return res.status(404).render('error', { layoutSide: 'public', title: 'Room not found', message: 'No such room.' });
  res.render('public/room', { title: `${room.name} — The Marlowe`, room });
});

// ===========================================================================
// REZMASTER 4.2 — front-desk PMS (authenticated)
// ===========================================================================

app.get('/rezmaster/login', (req, res) => {
  res.render('rezmaster/login', { title: 'RezMaster 4.2 — Sign In', next: req.query.next || '/rezmaster', error: null });
});

app.post('/rezmaster/login', checkCsrf, (req, res) => {
  const { email, password } = req.body;
  const user = STAFF.find((u) => u.email === email && u.password === password);
  if (!user) {
    return res.status(401).render('rezmaster/login', {
      title: 'RezMaster 4.2 — Sign In',
      next: req.body.next || '/rezmaster',
      error: 'Invalid username or password.',
    });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).render('error', { layoutSide: 'public', title: 'Error', message: 'Session error.' });
    req.session.staff = { email: user.email, name: user.name, role: user.role };
    req.session.csrf = crypto.randomBytes(16).toString('hex');
    res.redirect(req.body.next || '/rezmaster');
  });
});

app.post('/rezmaster/logout', checkCsrf, (req, res) => {
  req.session.destroy(() => res.redirect('/rezmaster/login'));
});

app.get('/rezmaster', requireStaff, (req, res) => {
  const arrivalsToday = GUESTS.filter((g) => g.arriving === TODAY);
  const arrivalsTomorrow = GUESTS.filter((g) => g.arriving === TOMORROW);
  res.render('rezmaster/dashboard', {
    title: 'RezMaster 4.2 — Dashboard',
    guests: GUESTS,
    rooms: ROOMS,
    reservations,
    arrivalsToday,
    arrivalsTomorrow,
  });
});

app.get('/rezmaster/guests', requireStaff, (req, res) => {
  res.render('rezmaster/guests', { title: 'RezMaster — Guest Book', guests: GUESTS });
});

// Wall 2 — hydrate. Negotiated rate, profile, and TRUE availability (held rooms).
app.get('/rezmaster/guests/:id', requireStaff, (req, res) => {
  const guest = guestById(req.params.id);
  if (!guest) return res.status(404).render('error', { layoutSide: 'rezmaster', title: 'Guest not found', message: 'No such guest.' });
  const quotes = ROOMS.map((r) => ({
    slug: r.slug,
    name: r.name,
    rackRate: r.rackRate,
    negotiated: negotiatedRate(guest, r),
    publicAvailable: r.publicAvailable,
    trueAvailable: r.trueAvailable, // includes rooms held off the public channel
    held: r.trueAvailable - r.publicAvailable,
  }));
  res.render('rezmaster/guest-detail', {
    title: `RezMaster — ${guest.name}`,
    guest,
    quotes,
    ratePlan: ratePlanLabel(guest),
    reservations: reservations.filter((r) => r.guestId === guest.id),
    booked: req.session.lastBooking && req.session.lastBooking.guestId === guest.id ? req.session.lastBooking : null,
  });
});

// Authenticated internal guest directory (JSON). The PMS exposes the whole list to
// the front desk — but there's NO "find by phone" operation (that's the gap). The
// concierge replays this XHR with its session and matches the caller's number in
// its own layer. Classic "replay the internal XHR, normalize in our code" move.
app.get('/rezmaster/api/guests', requireStaff, (req, res) => {
  res.json({
    guests: GUESTS.map((g) => ({
      id: g.id,
      name: g.name,
      email: g.email,
      phone: g.phone,
      loyaltyTier: g.loyaltyTier,
      corporateAccount: g.corporateAccount,
      ratePlan: ratePlanLabel(g),
      arriving: g.arriving,
    })),
  });
});

app.get('/rezmaster/reservations', requireStaff, (req, res) => {
  res.render('rezmaster/reservations', {
    title: 'RezMaster — Reservations',
    reservations,
    guestById,
    roomBySlug,
  });
});

app.get('/rezmaster/reservations/:id', requireStaff, (req, res) => {
  const r = reservations.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).render('error', { layoutSide: 'rezmaster', title: 'Reservation not found', message: 'No such reservation.' });
  res.render('rezmaster/reservation-detail', { title: `RezMaster — ${r.id}`, r, guest: guestById(r.guestId), room: roomBySlug(r.roomSlug) });
});

// Wall 3 — act. Create a reservation at the negotiated rate. CSRF-protected write.
app.post('/rezmaster/reservations', requireStaff, checkCsrf, (req, res) => {
  const guest = guestById(req.body.guestId);
  const room = roomBySlug(req.body.roomSlug);
  if (!guest || !room) {
    return res.status(400).render('error', { layoutSide: 'rezmaster', title: 'Bad request', message: 'Unknown guest or room.' });
  }
  const checkin = req.body.checkin || TOMORROW;
  const checkout = req.body.checkout || addDays(checkin, 2);
  const rec = {
    id: 'R-' + resSeq++,
    guestId: guest.id,
    roomSlug: room.slug,
    checkin,
    checkout,
    ratePlan: ratePlanLabel(guest),
    nightlyRate: negotiatedRate(guest, room),
    createdBy: req.session.staff.name,
    createdAt: TODAY,
  };
  reservations.push(rec);
  req.session.lastBooking = rec;
  res.redirect('/rezmaster/reservations/' + rec.id);
});

// ===========================================================================
// CONCIERGE — the guest-facing agent (holds the front-desk login; find→hydrate→act)
// ===========================================================================

app.get('/concierge', (req, res) => {
  res.render('concierge', { title: 'The Marlowe — Concierge', agentReady: !!process.env.ANTHROPIC_API_KEY });
});

app.post('/concierge/agent', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ reply: 'The concierge is offline (no model key configured).', steps: [] });
  }
  const raw = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  const messages = raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length < 4000)
    .slice(-20);
  if (!messages.length) return res.status(400).json({ reply: 'Say something to the concierge.', steps: [] });
  try {
    const out = await runConcierge(messages, { base: `http://localhost:${PORT}` });
    res.json(out);
  } catch (e) {
    console.error('concierge error:', e);
    res.status(500).json({ reply: 'Sorry — the concierge hit a snag. Try again in a moment.', steps: [] });
  }
});

app.get('/healthz/', (req, res) => res.json({ ok: true }));

app.use((req, res) => {
  res.status(404).render('error', { layoutSide: 'public', title: 'Not found', message: 'The page ' + req.path + ' does not exist.' });
});

function addDays(dateStr, n) {
  // Deterministic date math without Date.now(); parse YYYY-MM-DD.
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function nightsBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.max(1, Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000));
}

app.listen(PORT, () => console.log(`The Marlowe + RezMaster on :${PORT} (HARD_MODE=${HARD_MODE ? 'on' : 'off'})`));
