// WALL 3a — "The number that matters isn't public." (hydrate)
// Log in as the business, then read the negotiated rate + TRUE availability
// (including rooms held off the public channel) — none of it on the public site.
//
//   node hydrate.mjs G-1007 loft-king
import { MarloweClient } from './marlowe-client.mjs';

const guestId = process.argv[2] || 'G-1007';
const roomSlug = process.argv[3] || 'loft-king';

const c = new MarloweClient();
console.log('Logging in as the front desk…');
await c.login();
console.log('Session captured:', [...c.cookies.keys()].join(', '), '\n');

const q = await c.getRateQuote(guestId, roomSlug);
console.log(`${q.guestName} · ${q.ratePlan}`);
console.log(`  ${q.roomName}: rack $${q.rackRate}  →  negotiated $${q.negotiatedRate}`);
console.log(`  public availability ${q.publicAvailable}  →  TRUE availability ${q.trueAvailable} (${q.trueAvailable - q.publicAvailable} held off the public channel)`);
