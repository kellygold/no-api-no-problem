# The Marlowe — "No API? No Problem."

A two-sided demo target built for the conference talk **"No API? No Problem."** —
about giving AI agents *hands* in software that offers no usable API.

It's a single [Express](https://expressjs.com/) app that simulates one fictional
boutique hotel with **two doors**:

- a **public booking site** — server-rendered pages with a hidden JSON feed behind
  the booking widget, and
- a **legacy front-desk PMS, "RezMaster 4.2,"** behind a login (session cookie +
  CSRF token).

It's deliberately built to be *reverse-engineered live on stage*. **All data is
fictional and self-hosted.** Nothing here talks to a real hotel, payment system, or
third-party service.

## The story: one arrival, three walls

One guest wants one room. Watch how many no-API walls stand between *"I want to
stay"* and *"booked at the right price."*

| Wall | Access · Operation | Surface |
|------|--------------------|---------|
| **1 — Find** | public · read | `GET /api/availability` — the hidden JSON feed behind the booking widget. Public rack rates + public inventory only. Copy-as-cURL just works. |
| **2 — Read the page** | public · read | `GET /rooms/:slug` — a server-rendered room detail page with no JSON equivalent. When there's no feed, the page *is* the feed: you parse the DOM. |
| **3a — Hydrate** | authenticated · read | Log into RezMaster, then call `GET /api/availability?contactId=G-1007` **with the front-desk session** — the *same endpoint* now returns that contact's **negotiated rate** and the **true availability** (rooms held off the public channel) the public site never shows. |
| **3b — Act** | authenticated · write | `POST /rezmaster/reservations` — book a room at the negotiated rate. CSRF-protected. |

The stakes climb with every wall — public read → private read → private write — which
is the setup for the ethics discussion at the close. The signature beat: the public
site shows the **Loft King sold out at $349**, but the front desk books a **held room
at the $286 corporate rate**.

### One availability endpoint, context decides the view

There is exactly **one** availability API. The `contactId` (plus a logged-in
front-desk session) is the only switch:

```
GET /api/availability                     → public: rack rate + public inventory
GET /api/availability?contactId=G-1007    → (while logged in) that contact's
                                            negotiated rate + true availability
```

Whoever calls it — a browser, a `curl`, or the agent — asks the same way, and the
endpoint decides what to return.

## Run locally

```bash
npm install
npm start                  # http://localhost:8080
# HARD_MODE=1 npm start     # turns on a bot challenge on the public feed (Level 4)
```

- Front-desk login (RezMaster): `frontdesk@themarlowe.test` / `reception24`
- Data is in-memory and deterministic (dates fixed around **2026-07-07**). It resets
  on every restart.

### The concierge agent (optional)

`/concierge` is a guest-facing chat agent — a Claude tool-use loop
(`concierge-agent.mjs`) that runs the whole **find → hydrate → act** chain through
three tools: `identify_caller`, `get_availability`, and `create_reservation`. It acts
*as the business* (it holds the front-desk login), which is what lets it quote
negotiated rates and book held rooms.

To enable it, set an Anthropic API key before starting the server:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # your own key
npm start
# then open http://localhost:8080/concierge
```

Without the key the rest of the app still runs; only `/concierge` is disabled.

## Walk through it

`tools/demo.sh` is the canonical, copy-paste walkthrough — every wall, in order, as
plain shell one-liners. It's the run sheet for the live demo; reading it top to bottom
is the fastest way to understand what the target exposes. `RUNBOOK.md` narrates the
same journey for the stage.

Helper scripts (in `tools/`) show each technique on its own:

```bash
cd tools && npm install
node get-room.mjs loft-king             # Wall 2: parse the SSR page → clean object
node availability.mjs 2026-07-07 2026-07-09              # Wall 1: public rack rates
node availability.mjs 2026-07-07 2026-07-09 415-555-1111 # Wall 3a: member rate + held rooms
node book-arrival.mjs                   # the finale, end to end (find → hydrate → act)
```

Verify harnesses:

```bash
cd tools
node verify-live.mjs        # mechanics + negative cases across all walls
node verify-userflows.mjs   # the actual on-stage journeys, browser-style
```

Both default to the local server; set `MARLOWE_URL` to point them at a deployed URL.

## MCP server — the "one clean interface" payoff

`tools/mcp-server.mjs` wraps every technique behind a single set of
[MCP](https://modelcontextprotocol.io/) tools — `search_availability`, `get_room`,
`get_guest_rate`, `get_guest`, `create_reservation` — so an agent calls clean tools
and never knows there's a hidden feed, a scraped DOM, a login, or a CSRF token
underneath. Register it in `.mcp.json`:

```json
{ "mcpServers": { "marlowe": {
    "command": "node",
    "args": ["<ABS-PATH>/tools/mcp-server.mjs"],
    "env": { "MARLOWE_URL": "http://localhost:8080" } } } }
```

## Deploy (optional)

It's a plain container (see `Dockerfile`) and runs anywhere. For example, on Cloud
Run:

```bash
gcloud run deploy marlowe-demo --source . \
  --region us-central1 --allow-unauthenticated \
  --set-env-vars SESSION_SECRET=<random-string>
```

## Not for production

This is a stage prop. Fictional data, deliberately weak demo credentials, in-memory
state, and unauthenticated access are all by design. Don't run it as anything real.

## Brand assets

`assets/` (and `public/img/`) hold the generated brand set — the Marlowe logo, hero,
room and suite photos, favicon, and the RezMaster legacy logo. All AI-generated for
the demo.

## License

MIT — see [`LICENSE`](LICENSE).
