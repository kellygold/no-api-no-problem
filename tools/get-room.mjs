// WALL 2 — "No feed? Hydrate it yourself."
// The public feed (Wall 1) has live inventory + the rack rate but no detail; the room
// page has the description + amenities but no JSON. We pull BOTH and merge them into one
// clean object neither source had alone — the object we hand the agent.
//
//   node get-room.mjs loft-king [checkin] [checkout]
import { MarloweClient } from './marlowe-client.mjs';

const slug = process.argv[2] || 'loft-king';
const checkin = process.argv[3] || '2026-07-07';
const checkout = process.argv[4] || '2026-07-09';
const c = new MarloweClient();

const feed = (await c.searchAvailability(checkin, checkout)).find((r) => r.slug === slug) || {};
console.log('① public feed (JSON) — inventory + rate, no detail:');
console.dir({ name: feed.name, rackRate: feed.rackRate, sleeps: feed.sleeps, available: feed.available, soldOut: feed.soldOut }, { depth: null });

const page = await c.getRoom(slug);
console.log('\n② parsed from the page (HTML, no feed) — the detail the feed lacks:');
console.dir({ description: page.description, amenities: page.amenities }, { depth: null });

const hydrated = {
  slug,
  name: feed.name ?? page.name,
  rackRate: feed.rackRate ?? page.rackRate,
  sleeps: feed.sleeps ?? page.sleeps,
  available: feed.available,
  soldOut: feed.soldOut,
  description: page.description,
  amenities: page.amenities,
};
console.log('\n→ hydrated object (feed + page) — the tool we hand the agent:');
console.dir(hydrated, { depth: null });
