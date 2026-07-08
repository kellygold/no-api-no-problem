// verify-live.mjs — assertion-based check of every Marlowe scenario + negatives.
//   node verify-live.mjs                        (defaults to the live URL)
//   MARLOWE_URL=http://localhost:8080 node verify-live.mjs

import * as cheerio from 'cheerio';
import { MarloweClient } from './marlowe-client.mjs';

const BASE = (process.env.MARLOWE_URL || 'https://marlowe-demo-15002197811.us-central1.run.app').replace(/\/$/, '');
const CREDS = { email: 'frontdesk@themarlowe.test', password: 'reception24' };

let pass = 0, fail = 0;
function check(label, cond, detail = '') { (cond ? pass++ : fail++); console.log(`  ${cond ? '✓' : '✗ FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); }
function section(t) { console.log(`\n${t}`); }
function jar() {
  const c = new Map();
  const hdr = () => [...c.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const absorb = (r) => { for (const l of r.headers.getSetCookie?.() || []) { const [p] = l.split(';'); const i = p.indexOf('='); if (i > 0) c.set(p.slice(0, i).trim(), p.slice(i + 1).trim()); } };
  return { c, async fetch(path, opts = {}) { const h = { ...(opts.headers || {}) }; if (c.size) h.Cookie = hdr(); const r = await fetch(BASE + path, { ...opts, headers: h, redirect: 'manual' }); absorb(r); return r; } };
}
const csrfOf = (html) => (html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];

console.log(`Target: ${BASE}\n${'='.repeat(72)}`);

section('WALL 1 — public availability feed (no auth, copy-as-cURL)');
{
  const res = await fetch(`${BASE}/api/availability?checkin=2026-07-07&checkout=2026-07-09`, { headers: { Accept: 'application/json' } });
  check('feed responds 200 with no auth/cookies', res.status === 200, `HTTP ${res.status}`);
  check('content-type is JSON', /application\/json/.test(res.headers.get('content-type') || ''));
  const d = await res.json();
  check('returns 5 room types', d.rooms?.length === 5, `rooms=${d.rooms?.length}`);
  check('computes 2 nights', d.nights === 2, `nights=${d.nights}`);
  check('exposes ONLY rack rate publicly (no negotiated field)', d.rooms.every((r) => 'rackRate' in r && !('negotiated' in r) && !('trueAvailable' in r)));
  const loft = d.rooms.find((r) => r.slug === 'loft-king');
  check('Loft King is sold out on the public channel', loft && loft.soldOut === true && loft.available === 0);
}

section('WALL 2 — server-rendered room detail (no JSON exists)');
{
  const res = await fetch(`${BASE}/rooms/marlowe-suite`);
  check('room page responds 200 HTML', res.status === 200 && /text\/html/.test(res.headers.get('content-type') || ''));
  const html = await res.text();
  check('rack rate + amenities are in the server-rendered HTML', /\$389/.test(html) && /Marble bath/.test(html));
  const guess = await fetch(`${BASE}/api/rooms/marlowe-suite`);
  check('no JSON detail endpoint (guess 404s)', guess.status === 404, `HTTP ${guess.status}`);
  const nc = await fetch(`${BASE}/rooms/marlowe-suite`, { headers: { Accept: 'application/json' } });
  check('Accept: json still returns HTML (no negotiation)', (await nc.text()).trimStart().startsWith('<!DOCTYPE'));
  const parsed = await new MarloweClient(BASE).getRoom('marlowe-suite');
  check('cheerio parses name + rate + amenities', parsed.name === 'The Marlowe Suite' && parsed.rackRate === 389 && parsed.amenities.length >= 4,
    `${parsed.name} $${parsed.rackRate} (${parsed.amenities.length} amenities)`);
  const miss = await fetch(`${BASE}/rooms/nope`);
  check('unknown room → 404', miss.status === 404, `HTTP ${miss.status}`);
}

section('WALL 3 — front-desk login, session, CSRF');
{
  const j = jar();
  check('gated PMS page → 302 to login when logged out', (await j.fetch('/rezmaster/guests/G-1007')).status === 302);
  const anonCid = await (await fetch(`${BASE}/api/availability?contactId=G-1007`)).json();
  check('contactId is ignored without a session (availability stays public)', anonCid.contact === null && anonCid.rooms.every((r) => r.rate === r.rackRate));

  const preCsrf = csrfOf(await (await j.fetch('/rezmaster/login')).text());
  check('login sets rm_session cookie', j.c.has('rm_session'));
  check('login form carries a CSRF token', !!preCsrf);

  // wrong password (valid CSRF, same jar) → 401
  const wrong = await j.fetch('/rezmaster/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: preCsrf, email: CREDS.email, password: 'nope', next: '/rezmaster' }).toString() });
  check('wrong password → 401', wrong.status === 401, `HTTP ${wrong.status}`);

  // valid creds, bad CSRF → 403
  const bad = await j.fetch('/rezmaster/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: 'deadbeef', ...CREDS, next: '/rezmaster' }).toString() });
  check('valid creds + bad CSRF → 403', bad.status === 403, `HTTP ${bad.status}`);

  // valid login → 302
  const fresh = csrfOf(await (await j.fetch('/rezmaster/login')).text());
  const ok = await j.fetch('/rezmaster/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: fresh, ...CREDS, next: '/rezmaster/guests/G-1007' }).toString() });
  check('valid login → 302 to next', ok.status === 302 && /G-1007/.test(ok.headers.get('location') || ''));
}

section('HYDRATE — the negotiated rate + true availability the public never sees');
{
  const c = new MarloweClient(BASE);
  const q = await c.getRateQuote('G-1007', 'loft-king');
  check('Jordan Avery gets a corporate negotiated rate below rack', q.negotiatedRate < q.rackRate && /Acme/.test(q.ratePlan),
    `$${q.negotiatedRate} vs $${q.rackRate} (${q.ratePlan})`);
  check('true availability exceeds public (held rooms) for the "sold out" Loft King', q.publicAvailable === 0 && q.trueAvailable > 0,
    `public ${q.publicAvailable} / true ${q.trueAvailable}`);
  const g = await c.getGuest('G-1007');
  check('guest page hydrates profile (tier + account + notes)', /Gold/.test(g.loyaltyTier) && /Acme/.test(g.corporateAccount || '') && /feather/i.test(g.notes || ''));
  check('guest page rate table parses all 5 rooms with negotiated < rack', g.quotes.length === 5 && g.quotes.every((x) => x.negotiated < x.rack));
}

section('ACT — create a reservation (authenticated, CSRF-protected)');
{
  const j = jar();
  const preCsrf = csrfOf(await (await j.fetch('/rezmaster/login')).text());
  await j.fetch('/rezmaster/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: preCsrf, ...CREDS, next: '/rezmaster' }).toString() });

  // bad CSRF write → 403
  const badWrite = await j.fetch('/rezmaster/reservations', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: 'deadbeef', guestId: 'G-1007', roomSlug: 'loft-king' }).toString() });
  check('write with bad CSRF → 403', badWrite.status === 403, `HTTP ${badWrite.status}`);

  // proper write → 302, persists, at the negotiated rate
  const pageCsrf = csrfOf(await (await j.fetch('/rezmaster/guests/G-1007')).text());
  const w = await j.fetch('/rezmaster/reservations', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: pageCsrf, guestId: 'G-1007', roomSlug: 'loft-king', checkin: '2026-07-07', checkout: '2026-07-09' }).toString() });
  check('valid write → 302 to reservation', w.status === 302 && /\/rezmaster\/reservations\/R-/.test(w.headers.get('location') || ''), w.headers.get('location'));
  const detail = await (await j.fetch(w.headers.get('location'))).text();
  const $ = cheerio.load(detail);
  check('reservation confirms at the negotiated rate ($286), not rack ($349)', /\$286/.test(detail) && /rack \$349/.test(detail));

  // write with no session → bounced to login (auth before CSRF)
  const noSession = await jar().fetch('/rezmaster/reservations', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: 'x', guestId: 'G-1007', roomSlug: 'loft-king' }).toString() });
  check('write with no session → 302 to login', noSession.status === 302 && /\/rezmaster\/login/.test(noSession.headers.get('location') || ''));
}

section('LEVEL 4 — bot challenge (HARD_MODE) state');
{
  const res = await fetch(`${BASE}/api/availability`, { headers: { Accept: 'application/json' } });
  check('live service is HARD_MODE-OFF (non-browser feed not blocked)', res.status === 200);
  console.log('    note: enable HARD_MODE=1 to demo the block/bypass (verified separately).');
}

console.log(`\n${'='.repeat(72)}\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
