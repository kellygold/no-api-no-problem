// concierge-agent — the capstone. A guest chats; this agent, holding the
// hotel's front-desk login, runs the whole find → hydrate → act chain through
// the tools we reverse-engineered, and never lets on there's no API underneath.
//
// The agent acts AS THE BUSINESS (it holds the operator session), which is what
// lets it see negotiated rates and book rooms the public channel calls sold out.
//
// Same agent core the golf concierge runs on phone / SMS / WhatsApp — here it's
// wired to a chat channel for the demo.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-4-8';
const STAFF = {
  email: process.env.MARLOWE_USER || 'frontdesk@themarlowe.test',
  password: process.env.MARLOWE_PASS || 'reception24',
};
// A returning guest confirms their identity with a one-time code before we open their
// account — member rates, held rooms, and the card on file (so they never re-enter payment).
// Static for the demo; in production this is caller ID / a real OTP.
const VERIFY_CODE = (process.env.MARLOWE_VERIFY_CODE || '12345').replace(/\D/g, '');
// Guest identity. Over the phone the concierge already knows the caller's number
// (caller ID from Twilio) and looks up the account from it. A chat has no caller
// ID, so we simply ask for the number and look it up the same way: the phone
// number IS the key that turns rack rates into the member's negotiated rates and
// unlocks inventory held off the public channel. Unknown number → public guest.

// --- ops client: the tools, over the hotel's own HTTP surfaces (JSON + CSRF) ---
class ConciergeOps {
  constructor(base) {
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
  async _fetch(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.cookies.size) headers.Cookie = this._cookieHeader();
    const res = await fetch(this.base + path, { ...opts, headers, redirect: 'manual' });
    this._absorb(res);
    return res;
  }
  async _login() {
    if (this.loggedIn) return;
    const csrf = extractCsrf(await (await this._fetch('/rezmaster/login')).text());
    const res = await this._fetch('/rezmaster/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...STAFF, next: '/rezmaster' }).toString(),
    });
    if (res.status !== 302) throw new Error(`front-desk login failed (HTTP ${res.status})`);
    this.loggedIn = true;
  }

  // ONE availability call. No contactId → public (rack + public inventory). With a
  // contactId (we log in as the business first) → that contact's negotiated rate +
  // true availability. The contactId is the only switch the agent ever touches.
  async getAvailability(checkin, checkout, contactId) {
    if (contactId) await this._login();
    const qs = new URLSearchParams({ checkin: checkin || '', checkout: checkout || '' });
    if (contactId) qs.set('contactId', contactId);
    const r = await this._fetch(`/api/availability?${qs.toString()}`, { headers: { Accept: 'application/json' } });
    return r.json();
  }
  // The PMS has no "find by phone" — so we replay the internal guest directory
  // (with our session) and match the caller's number in our own layer.
  async identifyByPhone(phone) {
    await this._login();
    const r = await this._fetch('/api/contacts', { headers: { Accept: 'application/json' } });
    const { contacts } = await r.json();
    const want = String(phone || '').replace(/\D/g, '').slice(-10);
    const g = want.length >= 7 ? contacts.find((x) => String(x.phone || '').replace(/\D/g, '').slice(-10) === want) : null;
    if (!g) return { matched: false };
    return {
      matched: true,
      guest: {
        id: g.id,
        name: g.name,
        ratePlan: g.ratePlan,
        corporateAccount: g.corporateAccount,
        loyaltyTier: g.loyaltyTier,
        phoneLast4: String(g.phone).replace(/\D/g, '').slice(-4),
      },
    };
  }
  // Confirm the caller controls the number: they read back the code we "sent". Only a
  // pass unlocks the account — and reveals the card on file, so no payment re-entry.
  async verifyIdentity(contactId, code) {
    if (String(code || '').replace(/\D/g, '') !== VERIFY_CODE) return { verified: false };
    await this._login();
    const r = await this._fetch('/api/contacts', { headers: { Accept: 'application/json' } });
    const c = (await r.json()).contacts.find((x) => x.id === contactId);
    return { verified: true, cardOnFile: c?.cardOnFile || null };
  }
  async createReservation({ guestId, roomSlug, checkin, checkout }) {
    await this._login();
    const csrf = extractCsrf(await (await this._fetch(`/rezmaster/guests/${encodeURIComponent(guestId)}`)).text());
    const res = await this._fetch('/rezmaster/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, guestId, roomSlug, checkin: checkin || '', checkout: checkout || '' }).toString(),
    });
    if (res.status !== 302) throw new Error(`booking failed (HTTP ${res.status})`);
    return { reservationId: (res.headers.get('location') || '').split('/').pop() };
  }
}

const TOOLS = [
  {
    name: 'get_availability',
    description: "Get room availability and pricing for a date range. With NO contactId → public rack rates + public availability (use for anyone just browsing). With a contactId (only after identify_caller has matched the caller) → THAT contact's negotiated rate AND their true availability, including rooms held off the public channel that the public site shows as sold out. It's one call — the contactId is the only difference. Each room returns { rate, rackRate, available, soldOut, held }.",
    input_schema: {
      type: 'object',
      properties: {
        checkin: { type: 'string', description: 'Check-in date, YYYY-MM-DD' },
        checkout: { type: 'string', description: 'Check-out date, YYYY-MM-DD' },
        contactId: { type: 'string', description: "Optional. The matched guest id (e.g. G-1007) to get THAT contact's member rate + true availability. Omit for public rack rates." },
      },
      required: ['checkin', 'checkout'],
    },
  },
  {
    name: 'identify_caller',
    description: "Look up a guest account by phone number. Call this once the guest gives you a number. Returns { matched, guest } with the guest's id (use it as the contactId), name, tier and corporate account if the number is on file, or { matched: false } if it isn't (treat as a public/new guest). NOTE: matching only tells you who they CLAIM to be — you must verify_identity before revealing their rate, availability, or booking.",
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'The phone number the guest provided, any format' },
      },
      required: ['phone'],
    },
  },
  {
    name: 'verify_identity',
    description: "Confirm the caller controls the number on file, before you reveal any member rate, availability, or book for them. After identify_caller matches, tell the guest a code was sent to their number and ask them to read it back, then pass it here. Returns { verified, cardOnFile }. On verified:true you may proceed and may reference their card on file so they don't re-enter payment. (In production this is caller ID / a one-time passcode; here it's a fixed demo code.)",
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'the matched guest id from identify_caller' },
        code: { type: 'string', description: 'the code the guest read back' },
      },
      required: ['contactId', 'code'],
    },
  },
  {
    name: 'create_reservation',
    description: 'Book a room for a guest at the rate they qualify for. Only call once the guest has agreed to a specific room and dates. Pass the matched contactId as guestId.',
    input_schema: {
      type: 'object',
      properties: {
        guestId: { type: 'string', description: 'the contact/guest id (from identify_caller)' },
        roomSlug: { type: 'string' },
        checkin: { type: 'string', description: 'YYYY-MM-DD' },
        checkout: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['guestId', 'roomSlug', 'checkin', 'checkout'],
    },
  },
];

const SYSTEM = `You are the concierge for The Marlowe, a boutique hotel. You are messaging a guest and acting on behalf of the front desk — you hold the hotel's booking system access.

Your job: help the guest find and book a room at the best rate they're entitled to.
- Be warm, brief, and natural. This is a chat — keep replies to a few sentences.

Follow this sequence for a returning/member guest. Do the steps IN ORDER — never skip the verification.

1. FIND THEM. We don't identify members by name — ask for the phone number naturally ("To look up your account, can I grab the number on file?") and call identify_caller. If it does NOT match, they're a public/new guest: use get_availability with NO contactId, quote rack rates, and skip verification entirely.

2. VERIFY THEM (required before ANY member data). If identify_caller matches, do NOT quote their rate or availability yet. First say a one-time code was just sent to the number on file and ask them to read it back — e.g. "To confirm it's you, please enter the code we just sent to your number." Then call verify_identity(contactId, code). Only if it returns verified:true may you continue. If it fails, apologize and offer public rack rates only.

3. QUOTE (only once verified). Call get_availability with their contactId. Show the member rate next to the public rack rate so the savings are clear (e.g. "$286 vs $349 public") and note any publicly sold-out room that's available to them. Mention their card on file (from verify_identity) so they know payment is already set — nothing to enter.

4. BOOK. Confirm the room and dates, then create_reservation (pass the contactId as guestId). Give the confirmation number and nightly rate; since the card is on file, no payment step is needed.

Style: warm, brief, natural — a few sentences per reply. Use short markdown lists when showing multiple rooms.
Today is 2026-07-06. "Tomorrow" is 2026-07-07. Default a stay to 2 nights unless told otherwise.`;

// Friendly label for a tool call, for the UI's step chips.
function stepLabel(name, input, result) {
  if (name === 'get_availability') {
    const r = result || {};
    return r.contact ? `Priced availability for ${r.contact.name} (${r.contact.ratePlan})` : 'Checked public availability';
  }
  if (name === 'identify_caller') {
    const r = result || {};
    return r.matched ? `Matched account: ${r.guest?.name} (${r.guest?.ratePlan})` : 'No account on that number';
  }
  if (name === 'verify_identity') {
    const r = result || {};
    return r.verified ? `Identity verified ✓${r.cardOnFile ? ' · ' + r.cardOnFile : ''}` : 'Verification failed';
  }
  if (name === 'create_reservation') return `Booked ${result?.reservationId || 'the room'}`;
  return name;
}

export async function runConcierge(messages, { base }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const ops = new ConciergeOps(base);
  const steps = [];
  let convo = messages.map((m) => ({ role: m.role, content: m.content }));

  for (let hop = 0; hop < 8; hop++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: 'low' }, // snappy for a chat concierge
      system: SYSTEM,
      tools: TOOLS,
      messages: convo,
    });

    if (resp.stop_reason !== 'tool_use') {
      const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { reply: text || '(no reply)', steps };
    }

    convo.push({ role: 'assistant', content: resp.content });
    const toolResults = [];
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue;
      let out;
      try {
        if (block.name === 'get_availability') out = await ops.getAvailability(block.input.checkin, block.input.checkout, block.input.contactId);
        else if (block.name === 'identify_caller') out = await ops.identifyByPhone(block.input.phone);
        else if (block.name === 'verify_identity') out = await ops.verifyIdentity(block.input.contactId, block.input.code);
        else if (block.name === 'create_reservation') out = await ops.createReservation(block.input);
        else out = { error: 'unknown tool' };
        steps.push({ tool: block.name, label: stepLabel(block.name, block.input, out) });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) });
      } catch (e) {
        steps.push({ tool: block.name, label: `${block.name} failed` });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${e.message}`, is_error: true });
      }
    }
    convo.push({ role: 'user', content: toolResults });
  }
  return { reply: "Sorry — I got stuck completing that. Let me get a colleague to help.", steps };
}

function extractCsrf(html) {
  const m = html.match(/name="_csrf" value="([a-f0-9]+)"/);
  if (!m) throw new Error('CSRF token not found');
  return m[1];
}
