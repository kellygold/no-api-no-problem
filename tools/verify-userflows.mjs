// verify-userflows.mjs — validates the ACTUAL on-stage journeys the way a real
// browser/user walks them (browser headers, real form submits, render contract).
//   node verify-userflows.mjs        (defaults to live URL)

import * as cheerio from 'cheerio';

const BASE = (process.env.MARLOWE_URL || 'https://marlowe-demo-15002197811.us-central1.run.app').replace(/\/$/, '');
const CREDS = { email: 'frontdesk@themarlowe.test', password: 'reception24' };
const BROWSER = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

let pass = 0, fail = 0;
function check(label, cond, detail = '') { (cond ? pass++ : fail++); console.log(`  ${cond ? '✓' : '✗ FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); }
function section(t) { console.log(`\n${t}`); }
function jar() {
  const c = new Map();
  const hdr = () => [...c.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const absorb = (r) => { for (const l of r.headers.getSetCookie?.() || []) { const [p] = l.split(';'); const i = p.indexOf('='); if (i > 0) c.set(p.slice(0, i).trim(), p.slice(i + 1).trim()); } };
  return { c, async fetch(path, opts = {}) { const h = { ...BROWSER, ...(opts.headers || {}) }; if (c.size) h.Cookie = hdr(); const r = await fetch(BASE + path, { ...opts, headers: h, redirect: 'manual' }); absorb(r); return r; } };
}
const csrfOf = (html) => (html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];

console.log(`Target: ${BASE}  (as a real browser)\n${'='.repeat(72)}`);

section('FLOW 1 — guest opens the booking site, room cards populate from the hidden XHR');
{
  const j = jar();
  const home = await (await j.fetch('/')).text();
  check('home page loads', /The Marlowe/.test(home));
  const m = home.match(/fetch\('([^']*\/api\/availability[^']*)'/);
  check('home fires the availability XHR (the DevTools moment)', !!m, m ? m[1] + '…' : 'not found');
  const feed = await (await j.fetch('/api/availability?checkin=2026-07-07&checkout=2026-07-09', { headers: { Accept: 'application/json' } })).json();
  const reads = ['slug', 'name', 'sleeps', 'rackRate', 'available', 'soldOut', 'photo'];
  check('every room has the fields the card renderer reads → cards render', feed.rooms.length === 5 && feed.rooms.every((r) => reads.every((k) => r[k] !== undefined)));
  check('a "View room" link resolves to a real detail page', (await j.fetch(`/rooms/${feed.rooms[0].slug}`)).status === 200);
}

section('FLOW 2 — guest clicks a room and reads its detail (SSR)');
{
  const html = await (await jar().fetch('/rooms/loft-king')).text();
  const $ = cheerio.load(html);
  check('room name + rate visible', /Loft King/.test($('.detail h1').text()) && /\$349/.test(html));
  check('amenities render as tags', $('.detail .pill-tag').length >= 4, `${$('.detail .pill-tag').length} tags`);
}

section('FLOW 3 — front desk signs into RezMaster and reads a guest');
{
  const j = jar();
  check('staff link bounces logged-out user to login', (await j.fetch('/rezmaster')).status === 302);
  const loginHtml = await (await j.fetch('/rezmaster/login')).text();
  check('login form presented with username + password', /name="email"/.test(loginHtml) && /name="password"/.test(loginHtml));
  const token = csrfOf(loginHtml);
  const submit = await j.fetch('/rezmaster/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: token, ...CREDS, next: '/rezmaster/guests/G-1007' }).toString() });
  check('valid sign-in lands on the requested guest', submit.status === 302 && /G-1007/.test(submit.headers.get('location') || ''));
  const guest = await (await j.fetch(submit.headers.get('location'))).text();
  check('guest page shows the negotiated rate + held inventory the public never sees', /\$286/.test(guest) && /held/.test(guest) && /Acme Corp/.test(guest));
  check('masthead shows the signed-in front-desk session', /Dana Reyes/.test(guest) && /Sign out/.test(guest));
}

section('FLOW 4 — front desk books the arrival at the negotiated rate (the finale)');
{
  const j = jar();
  const token = csrfOf(await (await j.fetch('/rezmaster/login')).text());
  await j.fetch('/rezmaster/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: token, ...CREDS, next: '/rezmaster' }).toString() });
  const guestHtml = await (await j.fetch('/rezmaster/guests/G-1007')).text();
  const formCsrf = csrfOf(guestHtml);
  check('booking form present with room select + dates', /name="roomSlug"/.test(guestHtml) && /name="checkin"/.test(guestHtml) && !!formCsrf);
  const submit = await j.fetch('/rezmaster/reservations', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: formCsrf, guestId: 'G-1007', roomSlug: 'loft-king', checkin: '2026-07-07', checkout: '2026-07-09' }).toString() });
  check('submitting the booking redirects to a confirmation', submit.status === 302 && /reservations\/R-/.test(submit.headers.get('location') || ''));
  const conf = await (await j.fetch(submit.headers.get('location') || '')).text();
  check('confirmation shows the booked reference at the negotiated rate', /Confirmed/.test(conf) && /\$286/.test(conf));
  const list = await (await j.fetch('/rezmaster/reservations')).text();
  check('the new booking appears in the reservations list', /Jordan Avery/.test(list) && /Loft King/.test(list));
}

console.log(`\n${'='.repeat(72)}\nUSER-FLOW RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
