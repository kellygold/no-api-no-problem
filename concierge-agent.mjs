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
    const r = await this._fetch('/rezmaster/api/guests', { headers: { Accept: 'application/json' } });
    const { guests } = await r.json();
    const want = String(phone || '').replace(/\D/g, '').slice(-10);
    const g = want.length >= 7 ? guests.find((x) => String(x.phone || '').replace(/\D/g, '').slice(-10) === want) : null;
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
    description: "Look up a guest account by phone number — the way the phone concierge resolves a caller from their caller ID. Call this once the guest gives you a number. Returns { matched, guest } with the guest's id (use it as the contactId), name, tier and corporate account if the number is on file, or { matched: false } if it isn't (treat as a public/new guest).",
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'The phone number the guest provided, any format' },
      },
      required: ['phone'],
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

AVAILABILITY IS ONE TOOL — get_availability:
- Call it with NO contactId for anyone just browsing → public rack rates + public availability (some rooms may show sold out).
- Call it WITH a contactId → that contact's negotiated rate + their true availability (rooms held off the public channel that the public site shows as sold out). Only pass a contactId once you've matched the caller.

FIND THE CALLER FIRST (before pricing them as a member):
- We do NOT identify members by name. Over the phone we'd have caller ID; here, just ask for the number naturally — e.g. "To look up your account, can I grab the phone number on file?"
- Call identify_caller with whatever number they give. If it matches, you get their guest id — use it as the contactId. If it does NOT match, they're a public/new guest — call get_availability with no contactId and never reveal member pricing.

QUOTING & BOOKING:
- With a matched contact, call get_availability with their contactId, then show the member rate next to the rack rate so the savings are clear (e.g. "$286 vs $349 public"), and note if a publicly sold-out room is available to them.
- Confirm the room and dates, then create_reservation (pass the matched contactId as guestId). After booking, give the confirmation number and the nightly rate.

- Today is 2026-07-06. If the guest says "tomorrow", that's 2026-07-07. Default a stay to 2 nights unless told otherwise.`;

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
