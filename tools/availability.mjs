// THE availability API — one endpoint, the response depends on context.
//   node availability.mjs 2026-07-07 2026-07-09                 (anonymous / public)
//   node availability.mjs 2026-07-07 2026-07-09 415-555-1111    (a member, by phone → contactId)
import { MarloweClient } from './marlowe-client.mjs';

const [, , checkin = '2026-07-07', checkout = '2026-07-09', phone] = process.argv;
const { contact, rooms } = await new MarloweClient().getAvailability(checkin, checkout, { phone });

const ctx = contact ? `${contact.name} · ${contact.ratePlan} — member rates, true inventory` : 'public — rack rates, public inventory';
console.log(`\nGET /api/availability  ${checkin} → ${checkout}${phone ? '  (caller ' + phone + ')' : ''}`);
console.log(`context: ${ctx}\n`);
for (const r of rooms) {
  const rate = contact ? `$${r.rate} (rack $${r.rackRate})` : `$${r.rackRate}`;
  const avail = r.soldOut ? 'SOLD OUT' : `${r.available} left`;
  console.log(`  ${r.name.padEnd(17)} ${rate.padEnd(20)} ${avail}`);
}
console.log('');
