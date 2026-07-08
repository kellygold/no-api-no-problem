// FINALE — "one tee time... er, one arrival": find → hydrate → act, end to end.
// This is what the agent orchestrates on stage; running it directly is the backup.
//
//   node book-arrival.mjs                 (books Jordan Avery into the Loft King)
//   node book-arrival.mjs G-1044 marlowe-suite
import { MarloweClient } from './marlowe-client.mjs';

const c = new MarloweClient();
const guestId = process.argv[2] || 'G-1007';
const roomSlug = process.argv[3] || 'loft-king';

console.log(`\nThe morning at the front desk — booking arrival ${guestId} into ${roomSlug}\n`);

// 1. FIND (public): what does the public channel show for this room?
const pub = (await c.searchAvailability('2026-07-07', '2026-07-09')).find((r) => r.slug === roomSlug);
console.log(`1. Public channel: ${pub.name} — $${pub.rackRate}/night, ${pub.soldOut ? 'SOLD OUT' : pub.available + ' left'}`);

// 2. HYDRATE (auth read): the negotiated rate + true availability the public can't see.
const q = await c.getRateQuote(guestId, roomSlug);
console.log(`2. Front desk (RezMaster): ${q.guestName} · ${q.ratePlan}`);
console.log(`   negotiated $${q.negotiatedRate} (vs $${q.rackRate} rack) · true availability ${q.trueAvailable} (public ${q.publicAvailable})`);

// 3. ACT (auth write): book it at the negotiated rate.
const booking = await c.createReservation({ guestId, roomSlug, checkin: '2026-07-07', checkout: '2026-07-09' });
console.log(`3. Booked: ${booking.reservationId} — ${q.roomName} at $${q.negotiatedRate}/night for ${q.guestName}\n`);
console.log('   Public said sold out at rack. The desk booked a held room at the corporate rate. Same hotel, two doors.');
