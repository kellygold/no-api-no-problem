#!/usr/bin/env bash
# The Marlowe — demo run sheet.  COPY LINES FROM THIS FILE (plain text), not a markdown preview.
# Run from demo-marlowe/tools/.  The .sh / node helpers default to the live URL.

M=https://marlowe-demo-15002197811.us-central1.run.app


# ── WALL 1 · FIND (public, no login) ─────────────────────────────
# the booking widget's hidden JSON feed — an API all along:
curl -s "$M/api/availability?checkin=2026-07-07&checkout=2026-07-09" | jq

# the room detail page — just HTML, no JSON:
curl -s "$M/rooms/loft-king"

# curl + regex → JSON  (run `cat get-room.sh` first if you want to show the pipe):
./get-room.sh loft-king

# ...or a real parser (cheerio), merging the feed + page into one object:
node get-room.mjs loft-king


# ── WALL 2 · PRICE (log in — the numbers that aren't public) ─────
# try to open the target's Guest Book with no session → bounced to the login page:
curl -sL "$M/rezmaster/guests"

# naive: POST the creds → Forbidden, it wants a CSRF token:
curl -s -X POST "$M/rezmaster/login" -d email=frontdesk@themarlowe.test -d password=reception24 | grep -iE 'Forbidden|CSRF'

# the token lives on the login PAGE (not logging in yet — just grabbing the form).
# -i shows the cookie it sets; -c /tmp/jar saves that cookie. copy the _csrf value:
curl -si -c /tmp/jar "$M/rezmaster/login" | grep -iE 'set-cookie:|name="_csrf"'

# NOW log in: paste the token, sent with the saved cookie (-b) → 302, we're in:
curl -si -b /tmp/jar -c /tmp/jar -X POST "$M/rezmaster/login" -d _csrf=PASTE_TOKEN_HERE -d email=frontdesk@themarlowe.test -d password=reception24 -d next=/rezmaster | grep -iE 'HTTP/|^location:|set-cookie:'

# reuse the session → the target's Guest Book. all the guests, but it's an HTML table (no JSON):
curl -s -b /tmp/jar "$M/rezmaster/guests" | grep -A2 '<td>'

# ...so WE wrap that page into our OWN clean endpoint (/api/contacts — our namespace, not the target's):
curl -s -b /tmp/jar "$M/api/contacts" | jq '.contacts'

# THE SAME availability endpoint from Wall 1 — now add a contactId (+ our session).
# public: Loft King sold out at rack:
curl -s "$M/api/availability?checkin=2026-07-07&checkout=2026-07-09" | jq '.rooms[]|select(.slug=="loft-king")'
# with contactId=G-1007 (logged in): Jordan's rate AND the held room appear.
# NB: if "authenticated" is false, the login above didn't take — redo the token paste:
curl -s -b /tmp/jar "$M/api/availability?checkin=2026-07-07&checkout=2026-07-09&contactId=G-1007" | jq '{authenticated, contact, loftKing:(.rooms[]|select(.slug=="loft-king"))}'

# same call, every room, for one client — member vs standard:
./avail-auth.sh G-1007    # Jordan / Corporate → member rate + held rooms unlocked
./avail-auth.sh G-1050    # Chris  / Standard  → rack rate + public inventory (Loft King sold out)


# ── ASSOCIATION · client → their availability (our unified API) ──
node availability.mjs 2026-07-07 2026-07-09                 # public: rack rates, Loft King sold out
node availability.mjs 2026-07-07 2026-07-09 415-555-1111    # member: member rates + held rooms


# ── FINALE · the concierge (2FA → member rates → card-on-file booking) ──
open "$M/concierge"
# Say your dates, then give a phone number to look up the account.   Verification code: 12345
#   415-555-1111   member (Jordan · Acme Corp)  → asks for code → 12345 → $286 vs $349 + Amex on file → book
#   415-555-2222   standard (Chris)             → verifies, but rack rates + Loft King sold out (no perks)
#   415-555-1112   not on file (a stranger)     → straight to public rack rates, no account, no code
