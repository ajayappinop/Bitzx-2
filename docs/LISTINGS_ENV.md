# Token listing & IBO platform token — environment variables

Add these keys to `backend/.env`. Leave values empty until you are ready; the server skips IBO seed when `IBO_CONTRACT_ADDRESS` is unset.

## Platform default token (IBO)

```env
# ── IBO listed token (auto-seeded on startup when contract is set) ──
IBO_PROJECT_NAME=Ibo
IBO_TOKEN_NAME=Ibo Token
IBO_TOKEN_SYMBOL=IBO
IBO_BLOCKCHAIN_NETWORK=BEP-20 (BNB Chain)
IBO_CONTRACT_ADDRESS=0x7962f32a587c49ad4235ddc5982a0ae1945a2c01
IBO_TOKEN_DECIMALS=18
IBO_MAX_TOTAL_SUPPLY=1000000000
IBO_DEX_SWAP_LINK=https://pancakeswap.finance/swap?outputCurrency=0xYOUR_CONTRACT
IBO_OFFICIAL_WEBSITE=https://ibo.io
IBO_TWITTER=https://x.com/iboofficial
IBO_TELEGRAM=https://t.me/iboofficial
IBO_CONTACT_EMAIL=admin@ibo.io
IBO_DESCRIPTION=Neutral one-line token description for explorers.
IBO_LOGO_URL=https://api.ibo.io/api/token-logo
IBO_LEGAL_ENTITY_NAME=Ibo Private Limited
IBO_TEAM_DIRECTOR_NAME=
IBO_TEAM_DIRECTOR_ROLE=Director
IBO_TEAM_DIRECTOR_LINKEDIN=
IBO_TEAM_DIRECTOR_BIO=
IBO_EXCHANGE_STATUS=Currently in development
IBO_DEPOSIT_ENABLED=true
IBO_WITHDRAW_ENABLED=false
IBO_TRADING_ENABLED=true
```

## Security (optional but recommended in production)

```env
# Fernet key for encrypting contract addresses at rest in MongoDB.
# Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
LISTINGS_CONFIG_ENCRYPTION_KEY=

# Or derive Fernet from an existing secret (fallback if KEY unset):
# LISTINGS_CONFIG_ENCRYPTION_SEED=
```

## Blockchain (required for deposits to detect on-chain transfers)

```env
BLOCKCHAIN_PROVIDER=quicknode
BLOCKCHAIN_MASTER_MNEMONIC=
DEPOSIT_POLL_ENABLED=true
QUICKNODE_BSC_URL=
QUICKNODE_ETH_URL=
USDT_BEP20_CONTRACT=
USDT_ERC20_CONTRACT=
# Listed tokens (IBO, etc.) — blocks to scan on startup + REST fallback
DEPOSIT_POLL_LISTED_LOOKBACK_BLOCKS=3000
DEPOSIT_POLL_BSC_CATCHUP_MAX=40
```

Admin: `POST /api/admin/deposit-events/rescan-listed` re-runs listed-token lookback and repairs orphan rows (wrong asset label).

IBO on BSC uses the same RPC as BEP-20 USDT; deposit scanning uses `IBO_CONTRACT_ADDRESS` from the listing record.

Optional BscScan API key (free tier) for holder/transfer counts in admin **Your token (IBO)** tab:

```env
BSCSCAN_API_KEY=
```

After setting `IBO_CONTRACT_ADDRESS`, restart the backend to seed `listed_tokens` and enable per-user IBO deposit addresses via `GET /api/wallet/deposit-addresses`.

## Rate limits (listing submissions)

Uses the global `RATE_LIMIT_ENABLED` Mongo limiter:

- 5 submissions per IP per hour
- 3 submissions per email per day
