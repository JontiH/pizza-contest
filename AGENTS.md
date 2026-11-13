# AGENTS.md

Pizza ranking site for a party, at pizzacontest.ca. Guests sign up with
the pizza they're bringing and score each pizza from 1 to 10.

## Layout

- `public/`: static page (`index.html`, `app.js`, `style.css`). No build step.
- `functions/api/[[route]].js`: Pages Function serving `/api/*`.
- `migrations/`: D1 schema, applied by CI before each deploy.

## API

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/state?voter=<id>` | Pizzas with average and vote count, who has voted, and the caller's own votes. |
| POST | `/api/pizzas` | `restaurant`, `brought_by` required. Capped at 60 pizzas. |
| DELETE | `/api/pizzas/<id>?voter=<id>` | Only the voter who added it. Deletes its votes too. |
| PUT | `/api/votes` | Upsert one score per voter per pizza. `score: null` clears it. |

There are no accounts. Each browser makes a random voter ID and keeps it
in `localStorage`, so clearing site data or switching phones makes a new
voter. Never return `creator_id` or `voter_id` from the API: knowing
someone's ID lets you edit their votes.

If the `PARTY_CODE` secret is set, every write needs a matching
`x-party-code` header. Share `https://pizzacontest.ca/?code=<code>` and
the page stores it. Set it with
`npx wrangler pages secret put PARTY_CODE --project-name=pizza-contest`.

## Git

Personal repo `JontiH/pizza-contest`. Local git config commits as
`JontiH` and pushes with `~/.ssh/JontiH`. Run `gh` with
`GH_TOKEN=$(gh auth token --user JontiH)`.

## Cloudflare

| Name | ID |
|------|----|
| Account | `7679249973b3ca7cd658c198c69e1e5e` |
| Pages project | `pizza-contest` (`pizza-contest.pages.dev`) |
| D1 database | `pizza-contest` (ID in `wrangler.toml`) |

`scripts/setup.sh` does the one-time setup. It opens a pre-filled token
page in the dashboard, then creates the D1 database, writes its ID into
`wrangler.toml`, and sets the repo secret, the `PARTY_CODE` secret and the
custom domain. It's safe to re-run.

Pushes to `main` run `.github/workflows/deploy.yml`: D1 migrations, then
`wrangler pages deploy`. The `CLOUDFLARE_API_TOKEN` repo secret and the
local `.env` (gitignored, see `.env.example`) hold a token for this
project only, with Account: Cloudflare Pages Edit and Account: D1 Edit,
plus Zone Read and DNS Edit on `pizzacontest.ca`.

## Local dev

Host Node is too old for wrangler, so run it in Docker:

```bash
docker run --rm -it -v "$PWD":/app -w /app -p 8788:8788 node:22-slim sh -c \
  "apt-get update -qq && apt-get install -y -qq ca-certificates && \
   npx -y wrangler@4 d1 migrations apply DB --local && \
   npx -y wrangler@4 pages dev --ip 0.0.0.0 --port 8788"
```

Open http://localhost:8788. Local data lives in `.wrangler/` (gitignored).
Put local secrets such as `PARTY_CODE` in `.dev.vars` (gitignored). Keep
that file even if it's empty: without it, wrangler loads `.env` into the
Worker, including the API token.
