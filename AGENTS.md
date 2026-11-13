# AGENTS.md

Pizza party site at pizzacontest.ca (Saturday November 28, 2026). Guests
log in with an emailed code, the host approves them, they sign up the pizza
they're bringing, and at the party the site hands each guest one slice at a
time to score from 1 to 10. Results are counted several ways and published.

## Layout

- `public/index.html`: home page with the dancing slice (`assets/dancer.js`;
  routines are pose functions, `CARLTON` and `MACARENA`).
- `public/app/`: the guest app (Lineup, Vote, Results, Admin tabs) and
  `count.html`, the election-night page for the TV.
- `public/results/`: results explorer. Uses `/api/results` when logged in,
  otherwise `/pub/results`.
- `public/assets/tally.js`: counting methods (average, most firsts, instant
  runoff, STV podium, Schulze head-to-head, Borda, fullness-adjusted).
  `needle.js` simulates win chances from a partial count.
- `functions/api/[[route]].js`: everything that needs a login.
  `functions/pub/[[route]].js`: login, and results once revealed.
- `lib/`: auth (codes, sessions), the tasting engine, results payload.
- `migrations/`: D1 schema, applied by CI before each deploy.

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
addresses in the `ADMIN_EMAILS` secret.

Resend's DNS records (DKIM, SPF and MX on `send.`) were added by its
Cloudflare auto-configure; `_dmarc` is `p=none`.

## Phases

`signup` (lineup only) → `tasting` (checked-in guests get slices) →
`closed` (scores locked, results for guests, count page) → `revealed`
(public results). The admin switches phases from the Admin tab.

The tasting engine (`lib/tasting.js`) gives each guest the untried pizza
eaten least often at their current slice number, so early and late slices
spread evenly and late arrivals balance out.

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

Pushes to `main` run `.github/workflows/deploy.yml`: migrations, then
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
