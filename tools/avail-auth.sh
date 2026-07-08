#!/usr/bin/env bash
# Match a client to their REAL availability — ONE call to the availability API with a
# contactId. Log in as the front desk (so the contact's private data is unlocked), then:
#   GET /api/availability?contactId=<id>  →  that client's rate + true availability
#   ./avail-auth.sh G-1007   Jordan / Corporate → "your rate" is BELOW rack (preferred rate)
#   ./avail-auth.sh G-1050   Chris  / Standard  → "your rate" EQUALS rack (no preferred rate)
M="${MARLOWE_URL:-https://marlowe-demo-15002197811.us-central1.run.app}"
id="${1:-G-1007}"
jar="$(mktemp)"

# log in (grab the CSRF token, POST it with the session cookie)
csrf=$(curl -s -c "$jar" "$M/rezmaster/login" | grep -oE 'name="_csrf" value="[a-f0-9]+"' | grep -oE '[a-f0-9]{16,}')
curl -s -b "$jar" -c "$jar" -X POST "$M/rezmaster/login" \
  -d "_csrf=$csrf" -d email=frontdesk@themarlowe.test -d password=reception24 -o /dev/null

# one availability call, scoped to this contact
curl -s -b "$jar" "$M/api/availability?checkin=2026-07-07&checkout=2026-07-09&contactId=$id" | jq -r '
  "\n  \(.contact.id)  \(.contact.name) · \(.contact.ratePlan)",
  "──────────────────────────────────────────────────────────",
  (.rooms[] | "  \(.name + (" " * (18 - (.name|length))))  rack $\(.rackRate)    your rate $\(.rate)    \(.available) avail (\(.held) held)")'
rm -f "$jar"
