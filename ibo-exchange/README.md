# IBO Exchange (web)

Vite + React exchange UI. **Run this app** for markets, wallet, landing, and trading — not the repo `frontend/` folder.

```bash
npm install
cp .env.example .env   # or use existing .env
npm run dev
```

Open **http://localhost:5173** (see `vite.config.js` if the port is taken).

Requires backend at `VITE_BACKEND_URL` (default `http://localhost:8000` via `.env`).

**Production build** (deployed API — same as mobile release APK):

```bash
npm run build
```

Uses `.env.production` (`http://207.180.213.153:8005`). Edit that file if your server URL changes.
