# AGENTS.md

Pizza party site at pizzacontest.ca (Saturday November 28, 2026). Guests
log in with an emailed code, the host approves them, they sign up the pizza
they're bringing, and at the party the site hands each guest one slice at a
time to score from 1 to 10. Results are counted several ways and published.

## Layout

- `public/index.html`: home page with the dancing slice (`assets/dancer.js`;
  routines are pose functions; the home page plays `MEDLEY`, 30 seconds).
  `assets/pizza-dance.gif` is an export of it, used as the link preview.
- `public/app/`: the guest app (Lineup, Info, Vote, Results, Admin tabs).
- `public/results/`: results explorer. Uses `/api/results` when logged in,
  otherwise `/pub/results`.
- `public/assets/tally.js`: counting methods (average, most firsts, instant
  runoff, STV podium, Schulze head-to-head, Borda, fullness-adjusted).
  `needle.js` simulates win chances from a partial count.
- `functions/api/[[route]].js`: everything that needs a login.
  `functions/pub/[[route]].js`: login, and results once revealed.
- `lib/`: auth (codes, sessions), the tasting engine, results payload.
- `migrations/`: D1 schema, applied by CI before each deploy.

## Lineup and places

The two categories are shown as Cheese and Not cheese; the keys in code and
the database stay `platonic` and `non_platonic`.

Pizzas have a restaurant, a pizza type (`kind`, required only for
not cheese), extra `notes`, and for returning champions a `placing`
(1 to 3, shown as gold/silver/bronze "v1" labels outlined blue; this
contest's podium on the results page uses red-outlined "v2" labels).
Guests add one pizza of their own plus any champion slots; admins add any
number for anyone.

Locations come from Photon (komoot's OpenStreetMap geocoder) through
`/api/places`, cached in `place_cache`. If a guest doesn't pick a
suggestion, the client asks which location when there are several, and the
server falls back to the best food match. Admins can move a pin by pasting
a Google Maps link. The Lineup map uses self-hosted Leaflet with
OpenStreetMap tiles; tile requests must send the origin as Referer
(`referrerPolicy: "strict-origin"`) or OSM blocks them.

## Info tab

Party details (`info_*` settings: date, address, unit, buzzer, parking)
are only in the D1 settings table and only served by `/api/info` to
approved guests. Never put them in the repo, migrations or logs; the repo
is public. Admins edit them under Admin > Edit info.

The FAQ is `lib/faq.js` (shared questions, edit it in the repo) followed by
the optional "More FAQ" text from D1 (`info_body`) for anything private.

## Privacy rules

- Every `/api` route requires a session; `/pub` must never return names,
  emails or the lineup before the admin sets the phase to `revealed`.
- Emails leave the server only in `/api/admin`. Guests and the public see
  display names. Results renumber voters so user IDs never leave either.
- Writes must be JSON (`readJson`), which with the SameSite=Lax session
  cookie blocks cross-site writes.

## Login

`/pub/login/start` emails a 6-digit code through Resend from
`login@pizzacontest.ca`; `/pub/login/verify` sets the `pizza_session`
cookie (30 days). Codes last 10 minutes, allow 5 tries, one per minute per
email. Sends are capped at 90 a day site-wide (Resend's free plan allows
100) and 40 per IP (guests at the party share the WiFi). Admins are the
addresses in the `ADMIN_EMAILS` secret. Admins get an email when someone
signs up, and a guest gets one when the admin approves them.

Resend's DNS records (DKIM, SPF and MX on `send.`) were added by its
Cloudflare auto-configure; `_dmarc` is `p=none`.

## Phases

`signup` (lineup only) → `tasting` (checked-in guests get slices) →
`closed` (scores locked, results for guests) → `revealed` (public
results). The admin switches phases from the Admin tab and can preview
results in any phase. `app/count.html` (ballot-by-ballot count with the
needle) is unlinked for now.

Each score can have a note. "Skip this pizza for now" is off unless the
`allow_skip` setting is on (Admin checkbox); the server refuses skips
while it's off.

The tasting engine (`lib/tasting.js`) gives each guest the untried pizza
eaten least often at their current slice number, so early and late slices
spread evenly and late arrivals balance out. It also picks an "up next"
slice ahead of time (`tastings.queued = 1`, shown as a corner card on the
Vote tab) so guests can heat it while eating the current one. Admin > Pizzas
"Mark out" (`finished_at`) takes a pizza out of rotation and drops it from
anyone's up next.

## Cloudflare

| Name | ID |
|------|----|
| Account | `7679249973b3ca7cd658c198c69e1e5e` |
| Pages project | `pizza-contest` (`pizza-contest.pages.dev`, `pizzacontest.ca`) |
| D1 database | `pizza-contest` (ID in `wrangler.toml`) |

Secrets on the Pages project: `ADMIN_EMAILS`, `RESEND_API_KEY`.
`scripts/setup.sh` sets them and the rest of the one-time setup; it's safe
to re-run. The repo secret `CLOUDFLARE_API_TOKEN` and local `.env` hold a
token for this project only.

Pushes to `main` run `.github/workflows/deploy.yml`: migrations,
`scripts/stamp-assets.sh` (adds `?v=<sha>` to every script and stylesheet
URL, since the zone lets browsers cache .js and .css for 4 hours), then
`wrangler pages deploy`.

## Local dev

```bash
docker compose up -d        # http://localhost:8788
docker compose down -v      # wipe the local database
```

Without `RESEND_API_KEY`, on localhost the code is printed in the logs and
filled in on screen. Local admins come from `.dev.vars` (gitignored); keep
that file even if empty, or wrangler loads `.env` (with the API token) into
the Worker.

Host Node is too old for wrangler, so everything runs in `node:22-slim`.
