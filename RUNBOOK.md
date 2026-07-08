# Live demo runbook — The Marlowe ("No API? No Problem.")

The **"one arrival, three walls"** demo. Each segment: what the room watches
(browser) + what you/Claude Code run (terminal). Backup one-liner per wall.

**Before you start:**
- Marlowe is reachable. **Live:** _(Cloud Run URL)_ or local `npm start` → `http://localhost:8080`.
- `export MARLOWE_URL=<url>` in the terminal Claude Code runs in.
- `cd tools && npm install` for the backup path.
- Browser open to the site with DevTools (Network tab) ready.
- Front-desk login: `frontdesk@themarlowe.test` / `reception24`.
- **Pre-flight:** `node verify-live.mjs && node verify-userflows.mjs` → all green.

The through-line: *"One guest wants one room. Watch how many no-API walls stand
between 'I want to stay' and 'booked at the right price.'"*

---

## WALL 1 · Find (public, read) — "It was an API all along"

**Browser:** open the site. Room cards populate on load. DevTools → Network →
Fetch/XHR → reload → the one request is `GET /api/availability?checkin=…`. Click it
→ clean JSON (rack rates + public availability). Right-click → **Copy as cURL** →
paste in terminal → runs with no auth.

**Terminal:**
```bash
curl -s "$MARLOWE_URL/api/availability?checkin=2026-07-07&checkout=2026-07-09" | python3 -m json.tool
```
👉 "The booking widget already speaks JSON — it just wasn't meant for me."

---

## WALL 2 · Read the page (public, read) — "They didn't even give you JSON"

**Browser:** click a room (e.g. the Loft King). It's a server-rendered page —
Network shows the document *is* the data, no XHR to grab.

**Terminal:**
```bash
curl -s "$MARLOWE_URL/rooms/loft-king" | head -40      # HTML, no clean feed
curl -s -o /dev/null -w "%{http_code}\n" "$MARLOWE_URL/api/rooms/loft-king"   # 404 — there is no JSON
cd tools && node get-room.mjs loft-king                # parse the DOM → clean object
```
👉 "When there's no feed, the page is the feed. You read the DOM."

---

## WALL 3a · Hydrate (authenticated, read) ★ — "The number that matters isn't public"

The whole point: the public site shows the **Loft King sold out at $349 rack**. But
the guest is a corporate/loyalty member — and *their* rate, and the rooms held back
from the public channel, only live inside RezMaster.

**Browser:** open `/rezmaster/guests/G-1007` (Incognito) → bounced to the RezMaster
login. In DevTools tick **Preserve log**, sign in → watch `POST /rezmaster/login` →
`Set-Cookie: rm_session`. View Source shows the hidden `_csrf`. You land on Jordan
Avery: **negotiated $286 (vs $349 rack)** and **2 rooms held** on the "sold out"
Loft King.

**Terminal (headless login → replay the SAME `/api/availability` endpoint, now with
a `contactId` and the session):**
```bash
cd tools && node hydrate.mjs G-1007 loft-king   # login → negotiated rate + true availability
```
👉 "Log in *as the business* — and see what the public and partner APIs never will."

---

## WALL 3b · Act (authenticated, write) — the finale

**Browser or agent:** book the arrival at the negotiated rate. `POST` is
CSRF-protected; the confirmation shows `$286`, not `$349`. The booking then appears
in `/rezmaster/reservations`.

**The real demo — Claude Code drives the MCP tools.** Wire `.mcp.json` (below),
then prompt: *"Book tomorrow's arrival Jordan Avery into the Loft King at their
negotiated rate."* Watch it call `search_availability → get_guest_rate →
create_reservation`.

**Backup (no agent):**
```bash
node tools/book-arrival.mjs
```
👉 "Public said sold out at rack. The desk booked a held room at the corporate rate.
Same hotel, two doors — and the agent walked through both."

### The MCP server is already wired
`demo-marlowe/.mcp.json` registers the `marlowe` server (pointed at the live URL).
**Start Claude Code from inside `demo-marlowe/`** so it picks up that project config,
then `/mcp` to confirm the `marlowe` tools loaded. To demo offline, edit `MARLOWE_URL`
in `.mcp.json` to `http://localhost:8080` and run `npm start` first.

---

## LEVEL 4 · "When they fight back" (talk-through)

Public site runs with the bot challenge **off**. To show it, run locally with
`HARD_MODE=1 npm start`:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/availability          # 403
curl -s -o /dev/null -w "%{http_code}\n" \
  -H 'User-Agent: Mozilla/5.0 … Chrome/126 Safari/537.36' -H 'Accept: text/html' \
  http://localhost:8080/api/availability                                                  # 200
```
👉 "This is RPA — reborn with a brain."

---

## Reset / Wi-Fi-died
In-memory data resets on restart (or Cloud Run cold start). If the venue Wi-Fi dies,
`npm start` locally and `export MARLOWE_URL=http://localhost:8080` — every command works offline.
