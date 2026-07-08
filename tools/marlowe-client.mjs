// marlowe-client — one clean interface over the two-sided Marlowe target.
//
//   searchAvailability -> Wall 1  (public hidden JSON)
//   getRoom            -> Wall 2  (parse public SSR room page)
//   login              -> Wall 3  (session cookie + CSRF)
//   getRateQuote       -> auth JSON (replay the internal XHR WITH your session)
//   getGuest           -> auth hydrate (parse the guest page)
//   createReservation  -> auth write (CSRF-protected)  (the "act")
//   bookArrival        -> the finale orchestration, end to end
//
// Callers get clean objects and never know which technique ran underneath.

import * as cheerio from 'cheerio';

// Default to the live demo so `node get-room.mjs` just works with no setup.
// Override with MARLOWE_URL=http://localhost:8080 for local dev.
const DEFAULT_BASE = process.env.MARLOWE_URL || 'https://marlowe-demo-15002197811.us-central1.run.app';
const CREDS = {
  email: process.env.MARLOWE_USER || 'frontdesk@themarlowe.test',
  password: process.env.MARLOWE_PASS || 'reception24',
};

export class MarloweClient {
  constructor(base = DEFAULT_BASE) {
    this.base = base.replace(/\/$/, '');
    this.cookies = new Map();
    this.loggedIn = false;
  }
  _cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  _absorb(res) {
    for (const line of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  async _fetch(pathname, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.cookies.size) headers.Cookie = this._cookieHeader();
    const res = await fetch(this.base + pathname, { ...opts, headers, redirect: 'manual' });
    this._absorb(res);
    return res;
  }

  // --- Wall 1: public availability feed ---
  async searchAvailability(checkin, checkout) {
    const qs = `?checkin=${encodeURIComponent(checkin || '')}&checkout=${encodeURIComponent(checkout || '')}`;
    const res = await this._fetch(`/api/availability${qs}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`searchAvailability HTTP ${res.status}`);
    return (await res.json()).rooms;
  }

  // --- Wall 2: parse the server-rendered room detail (no JSON exists) ---
  // The page carries the marketing detail the availability feed doesn't:
  // the description and the amenities list.
  async getRoom(slug) {
    const res = await this._fetch(`/rooms/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`getRoom HTTP ${res.status}`);
    const $ = cheerio.load(await res.text());
    return {
      slug,
      name: $('.detail h1').text().trim(),
      description: $('.detail h1').next('p').text().trim(),
      rackRate: Number(($('.detail .price').text().match(/\$(\d+)/) || [])[1]),
      sleeps: Number(($('.detail .price').text().match(/sleeps (\d+)/) || [])[1]) || undefined,
      amenities: $('.detail .pill-tag').map((_, el) => $(el).text().trim()).get(),
    };
  }

  // --- Wall 3: log in as the business, hold the session ---
  async login() {
    const pre = extractCsrf(await (await this._fetch('/rezmaster/login')).text());
    const res = await this._fetch('/rezmaster/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: pre, ...CREDS, next: '/rezmaster' }).toString(),
    });
    if (res.status !== 302) throw new Error(`login HTTP ${res.status}`);
    this.loggedIn = true;
    return true;
  }
  async _ensure() { if (!this.loggedIn) await this.login(); }

  // --- a single room's quote for a contact, via the ONE availability endpoint ---
  async getRateQuote(guestId, roomSlug) {
    const { contact, rooms } = await this.getAvailability(undefined, undefined, { contactId: guestId });
    const r = rooms.find((x) => x.slug === roomSlug);
    if (!r) throw new Error(`unknown room ${roomSlug}`);
    return {
      guestId,
      guestName: contact?.name,
      ratePlan: contact?.ratePlan,
      roomSlug: r.slug,
      roomName: r.name,
      rackRate: r.rackRate,
      negotiatedRate: r.rate,
      publicAvailable: r.available - (r.held || 0),
      trueAvailable: r.available,
    };
  }

  // --- CLIENT LOOKUP: the PMS has no "find by phone", so replay the internal
  //     directory (with our session) and match the caller's number ourselves. ---
  async identifyByPhone(phone) {
    await this._ensure();
    const res = await this._fetch('/api/contacts', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`contacts HTTP ${res.status}`);
    const { contacts } = await res.json();
    const want = String(phone || '').replace(/\D/g, '').slice(-10);
    const g = want.length >= 7 ? contacts.find((x) => String(x.phone || '').replace(/\D/g, '').slice(-10) === want) : null;
    return g ? { matched: true, guest: g } : { matched: false };
  }

  // --- THE availability call — ONE endpoint. No contact → public (rack + public
  //     inventory). With a contact (pass a phone or a contactId; we log in as the
  //     business) → that contact's negotiated rate + true availability. The contact is
  //     the only switch — same call, the endpoint decides what to return. ---
  async getAvailability(checkin, checkout, { contactId, phone } = {}) {
    let cid = contactId;
    if (!cid && phone) {
      const who = await this.identifyByPhone(phone); // phone → contactId (directory lookup)
      if (who.matched) cid = who.guest.id;
    }
    if (cid) await this._ensure(); // member data requires the business session
    const qs = new URLSearchParams({ checkin: checkin || '', checkout: checkout || '' });
    if (cid) qs.set('contactId', cid);
    const res = await this._fetch(`/api/availability?${qs.toString()}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`getAvailability HTTP ${res.status}`);
    return res.json(); // { hotel, checkin, checkout, nights, contact, rooms:[{slug,name,rate,rackRate,available,soldOut,held}] }
  }

  // --- authenticated hydrate: parse the guest profile + rate/availability table ---
  async getGuest(id) {
    await this._ensure();
    const html = await (await this._fetch(`/rezmaster/guests/${encodeURIComponent(id)}`)).text();
    const $ = cheerio.load(html);
    const dl = {};
    $('.dl dt').each((_, dt) => { dl[$(dt).text().trim().toLowerCase()] = $(dt).next('dd').text().trim(); });
    const quotes = [];
    $('.panel').each((_, p) => {
      if ($(p).find('.head').text().includes('Rate Quote')) {
        $(p).find('tbody tr').each((__, tr) => {
          const td = $(tr).find('td');
          quotes.push({
            room: $(td[0]).text().trim(),
            rack: num($(td[1]).text()),
            negotiated: num($(td[2]).text()),
            publicAvailable: num($(td[3]).text()),
            trueAvailable: num($(td[4]).text()),
          });
        });
      }
    });
    return {
      id,
      name: $('.panel .head').first().text().split('—')[0].trim(),
      loyaltyTier: dl['loyalty tier'] || null,
      corporateAccount: dl['corporate account'] || null,
      ratePlan: dl['rate plan'] || null,
      email: dl['email'] || null,
      arriving: dl['arriving'] || null,
      notes: dl['guest notes'] || null,
      quotes,
    };
  }
  async _freshCsrf(pathname) {
    const html = await (await this._fetch(pathname)).text();
    return { html, csrf: extractCsrf(html) };
  }

  // --- the "act": create a reservation (authenticated, CSRF-protected) ---
  async createReservation({ guestId, roomSlug, checkin, checkout }) {
    await this._ensure();
    const { csrf } = await this._freshCsrf(`/rezmaster/guests/${encodeURIComponent(guestId)}`);
    const res = await this._fetch('/rezmaster/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, guestId, roomSlug, checkin: checkin || '', checkout: checkout || '' }).toString(),
    });
    if (res.status !== 302) throw new Error(`createReservation HTTP ${res.status}`);
    const ref = (res.headers.get('location') || '').split('/').pop();
    return { reservationId: ref, guestId, roomSlug };
  }

  // --- finale: find -> hydrate -> act, for one arriving guest ---
  async bookArrival(guestId, roomSlug, checkin, checkout) {
    const guest = await this.getGuest(guestId);
    const quote = await this.getRateQuote(guestId, roomSlug);
    const booking = await this.createReservation({
      guestId,
      roomSlug,
      checkin: checkin || guest.arriving,
      checkout: checkout || guest.arriving,
    });
    return { guest: guest.name, ratePlan: guest.ratePlan, room: quote.roomName, rack: quote.rackRate, booked: quote.negotiatedRate, ...booking };
  }
}

function num(s) { return Number(String(s).replace(/[^0-9.]/g, '')) || 0; }
function extractCsrf(html) {
  const m = html.match(/name="_csrf" value="([a-f0-9]+)"/);
  if (!m) throw new Error('CSRF token not found');
  return m[1];
}
