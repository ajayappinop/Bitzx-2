# BscScan token info submission — project checklist

Use this after updating `backend/.env` and rebuilding/deploying the token website (`frontend`).

## Environment keys (backend)

Set in `backend/.env` (see `docs/LISTINGS_ENV.md`):

| Variable | Purpose |
|----------|---------|
| `IBO_OFFICIAL_WEBSITE` | Must match form |
| `IBO_CONTACT_EMAIL` | **Must** be `@ibo.io` (same as website) |
| `IBO_TWITTER` / `IBO_TELEGRAM` | Full URLs |
| `IBO_DEX_SWAP_LINK` | PancakeSwap link |
| `IBO_LOGO_URL` | Public logo (e.g. `https://api.ibo.io/api/token-logo`) |
| `IBO_TEAM_DIRECTOR_LINKEDIN` | **You must fill this** before resubmitting |
| `IBO_LEGAL_ENTITY_NAME` | Exact registered company name |

Optional: `IBO_DISCORD`, `IBO_TEAM_JSON` (array of team members).

## API

`GET /api/public/site-config` — JSON used to verify env matches what you submit.

## Still required from you (3 items)

1. **Director LinkedIn URL** — public profile updated to show IBO / Ibo Private Limited role.  
2. **Exact legal entity name** — as on registration certificate (update `IBO_LEGAL_ENTITY_NAME` if different).  
3. **Confirm social profiles** — X and Telegram active and mention the project (optional Discord only if you use it).

## BscScan form

- Request type: **New/First Time Token Update** (if never approved)
- Submit only via the official token update form on BscScan
- Use **admin@ibo.io** (or your official domain email) — not Gmail
- One submission per contract; reply on the same email thread for follow-ups

Guidelines: https://info.etherscan.com/how-to-update-token-info/
