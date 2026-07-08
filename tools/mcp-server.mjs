#!/usr/bin/env node
// marlowe-mcp — the payoff. Everything clawed out of the two-sided Marlowe target,
// exposed as clean MCP tools. The agent calls these and never knows there's a
// hidden feed, a scraped DOM, a login, or a CSRF token underneath.
//
// .mcp.json:
//   { "mcpServers": { "marlowe": {
//       "command": "node",
//       "args": ["/ABS/PATH/demo-marlowe/tools/mcp-server.mjs"],
//       "env": { "MARLOWE_URL": "https://<cloud-run-url>" } } } }

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MarloweClient } from './marlowe-client.mjs';

const c = new MarloweClient();
const server = new McpServer({ name: 'marlowe', version: '1.0.0' });
const json = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] });

server.tool(
  'search_availability',
  'Public: search room availability and PUBLIC rack rates for a date range.',
  { checkin: z.string().describe('YYYY-MM-DD'), checkout: z.string().describe('YYYY-MM-DD') },
  async ({ checkin, checkout }) => json(await c.searchAvailability(checkin, checkout)),
);
server.tool(
  'get_room',
  'Public: get a room type’s details (name, rack rate, amenities).',
  { slug: z.string().describe('e.g. loft-king, marlowe-suite') },
  async ({ slug }) => json(await c.getRoom(slug)),
);
server.tool(
  'get_guest_rate',
  'Front-desk only: a guest’s NEGOTIATED rate and the TRUE availability (incl. held rooms) for a room — data the public site never shows. Login handled internally.',
  { guestId: z.string().describe('e.g. G-1007'), roomSlug: z.string().describe('e.g. loft-king') },
  async ({ guestId, roomSlug }) => json(await c.getRateQuote(guestId, roomSlug)),
);
server.tool(
  'get_guest',
  'Front-desk only: a guest’s profile, loyalty/corporate account, notes, and per-room rate quotes.',
  { guestId: z.string().describe('e.g. G-1007') },
  async ({ guestId }) => json(await c.getGuest(guestId)),
);
server.tool(
  'create_reservation',
  'Front-desk only: book a room for a guest at their negotiated rate. Authenticated write.',
  {
    guestId: z.string(),
    roomSlug: z.string(),
    checkin: z.string().describe('YYYY-MM-DD'),
    checkout: z.string().describe('YYYY-MM-DD'),
  },
  async (a) => json(await c.createReservation(a)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('marlowe-mcp ready on stdio; target =', process.env.MARLOWE_URL || 'http://localhost:8080');
