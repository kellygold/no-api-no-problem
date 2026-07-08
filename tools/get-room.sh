#!/usr/bin/env bash
# WALL 2, the hacky way — turn the room page's HTML into clean JSON with nothing but
# curl + regex + jq. Great for the stage: curl it (HTML garbage) → run this (JSON) →
# "…or we just use a real HTML parser" → node get-room.mjs.
#
#   ./get-room.sh loft-king
URL="${MARLOWE_URL:-https://marlowe-demo-15002197811.us-central1.run.app}"
slug="${1:-loft-king}"
html="$(curl -s "$URL/rooms/$slug")"

name="$(   printf '%s' "$html" | grep -oE '<h1>[^<]+'                 | head -1 | sed -E 's/<h1>//')"
desc="$(   printf '%s' "$html" | grep -oE '<p style="color:[^"]*">[^<]+' | head -1 | sed -E 's/<p[^>]*>//')"
rate="$(   printf '%s' "$html" | grep -oE 'class="price">\$[0-9]+'    | grep -oE '[0-9]+')"
sleeps="$( printf '%s' "$html" | grep -oE 'sleeps [0-9]+'            | grep -oE '[0-9]+')"
amenities="$(printf '%s' "$html" | grep -oE 'pill-tag">[^<]+' | sed -E 's/pill-tag">//' | jq -R . | jq -s .)"

jq -n \
  --arg slug "$slug" \
  --arg name "$name" \
  --arg description "$desc" \
  --argjson rackRate "${rate:-0}" \
  --argjson sleeps "${sleeps:-0}" \
  --argjson amenities "${amenities:-[]}" \
  '{slug:$slug, name:$name, rackRate:$rackRate, sleeps:$sleeps, description:$description, amenities:$amenities}'
