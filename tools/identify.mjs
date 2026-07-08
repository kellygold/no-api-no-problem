// THE CLIENT LOOKUP — the PMS has no "find by phone." So we log in as the business,
// replay the internal guest directory (with our session), and match the caller's
// number ourselves. Phone in → membership out, the way caller ID resolves a caller.
//
//   node identify.mjs 415-555-1111    (a member)
//   node identify.mjs 415-555-1112    (a stranger)
import { MarloweClient } from './marlowe-client.mjs';

const phone = process.argv[2] || '415-555-1111';
const c = new MarloweClient();
console.log('Logging in as the front desk, replaying the guest directory…');
const who = await c.identifyByPhone(phone);

if (!who.matched) {
  console.log(`\n${phone}  →  no account on file → public guest (rack rates only).`);
  process.exit(0);
}
const g = who.guest;
console.log(`\n${phone}  →  ${g.name}`);
console.log(`  rate plan:  ${g.ratePlan}`);
console.log(`  loyalty:    ${g.loyaltyTier || 'none'}`);
console.log(`  corporate:  ${g.corporateAccount || 'none'}`);
console.log(`  guest id:   ${g.id}`);
