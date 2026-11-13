#!/usr/bin/env bash
# One-time setup: gets a Cloudflare token from you, then creates the D1
# database, sets the GitHub and Pages secrets and connects pizzacontest.ca.
# Safe to re-run; each step skips what already exists.
set -euo pipefail

ACCOUNT_ID=7679249973b3ca7cd658c198c69e1e5e
PROJECT=pizza-contest
DB_NAME=pizza-contest
DOMAIN=pizzacontest.ca
REPO=JontiH/pizza-contest
CF=https://api.cloudflare.com/client/v4
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
cf() { curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@"; }
# Prints the given field of a Cloudflare API response, or fails with its errors.
field() {
  python3 -c '
import json, sys
d = json.load(sys.stdin)
if not d.get("success"):
    sys.exit("Cloudflare API error: " + json.dumps(d.get("errors")))
v = d["result"]
for k in sys.argv[1].split(".") if sys.argv[1] else []:
    if isinstance(v, list):
        v = v[int(k)] if int(k) < len(v) else None
    else:
        v = v.get(k) if v else None
print("" if v is None else v)
' "${1:-}"
}

# 1. Token
TOKEN=""
[ -f .env ] && TOKEN=$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' .env)
if [ -z "$TOKEN" ]; then
  perms='[{"key":"page","type":"edit"},{"key":"d1","type":"edit"},{"key":"zone","type":"read"},{"key":"dns","type":"edit"}]'
  url="https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$perms")&name=$PROJECT"
  say "Step 1: create a Cloudflare token"
  echo "Opening the Cloudflare dashboard with the permissions filled in:"
  echo "  Pages Edit, D1 Edit, Zone Read, DNS Edit"
  echo "Under Zone Resources pick 'Specific zone' -> $DOMAIN, then Continue -> Create Token."
  echo
  echo "  $url"
  xdg-open "$url" >/dev/null 2>&1 || true
  echo
  read -rsp "Paste the token here (hidden): " TOKEN; echo
  [ -n "$TOKEN" ] || die "No token entered."
fi

status=$(cf "$CF/accounts/$ACCOUNT_ID/tokens/verify" | field status 2>/dev/null || cf "$CF/user/tokens/verify" | field status)
[ "$status" = active ] || die "Token is not active (status: $status)."
umask 077
printf 'CLOUDFLARE_API_TOKEN=%s\nCLOUDFLARE_ACCOUNT_ID=%s\n' "$TOKEN" "$ACCOUNT_ID" > .env
chmod 600 .env
echo "Token works. Saved to .env (gitignored)."

# 2. D1 database
say "Step 2: D1 database"
DB_ID=$(cf "$CF/accounts/$ACCOUNT_ID/d1/database?name=$DB_NAME" | field 0.uuid)
if [ -z "$DB_ID" ]; then
  DB_ID=$(cf -X POST "$CF/accounts/$ACCOUNT_ID/d1/database" -d "{\"name\":\"$DB_NAME\"}" | field uuid)
  echo "Created $DB_NAME ($DB_ID)."
else
  echo "Already exists ($DB_ID)."
fi
sed -i "s/^database_id = .*/database_id = \"$DB_ID\"/" wrangler.toml

# 3. GitHub secret
say "Step 3: GitHub secret"
printf '%s' "$TOKEN" | GH_TOKEN=$(gh auth token --user JontiH) gh secret set CLOUDFLARE_API_TOKEN -R "$REPO"
echo "Set CLOUDFLARE_API_TOKEN on $REPO."

# 4. Party code
say "Step 4: party code"
echo "Guests need this to add pizzas or vote. Leave blank for no code."
read -rp "Party code: " CODE
if [ -n "$CODE" ]; then
  body=$(python3 -c 'import json,sys;print(json.dumps({"deployment_configs":{"production":{"env_vars":{"PARTY_CODE":{"type":"secret_text","value":sys.argv[1]}}}}}))' "$CODE")
  cf -X PATCH "$CF/accounts/$ACCOUNT_ID/pages/projects/$PROJECT" -d "$body" | field name >/dev/null
  echo "Set. Share this link: https://$DOMAIN/?code=$CODE"
fi

# 5. Custom domain
say "Step 5: connect $DOMAIN"
ZONE_ID=$(cf "$CF/zones?name=$DOMAIN" | field 0.id)
if [ -z "$ZONE_ID" ]; then
  echo "No $DOMAIN zone visible to this token yet. Re-run this script once the domain shows up in Cloudflare."
else
  if [ -z "$(cf "$CF/zones/$ZONE_ID/dns_records?type=CNAME&name=$DOMAIN" | field 0.id)" ]; then
    cf -X POST "$CF/zones/$ZONE_ID/dns_records" \
      -d "{\"type\":\"CNAME\",\"name\":\"$DOMAIN\",\"content\":\"$PROJECT.pages.dev\",\"proxied\":true}" | field id >/dev/null
    echo "Added CNAME $DOMAIN -> $PROJECT.pages.dev."
  fi
  if [ -z "$(cf "$CF/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/domains/$DOMAIN" 2>/dev/null | field name 2>/dev/null)" ]; then
    cf -X POST "$CF/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/domains" -d "{\"name\":\"$DOMAIN\"}" | field name >/dev/null
  fi
  echo "$DOMAIN attached to the Pages project."
fi

say "Done."
echo "wrangler.toml now has the database ID. Commit and push it to deploy."
