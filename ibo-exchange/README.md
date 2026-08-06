# IBO Exchange (web)

Vite + React exchange UI. **Run this app** for markets, wallet, landing, and trading — not the repo `frontend/` folder.

```bash
npm install
cp .env.example .env   # or use existing .env
npm run dev
```

Open **http://localhost:5173** (see `vite.config.js` if the port is taken).

Requires backend at `VITE_BACKEND_URL` (default `http://localhost:8000` via `.env`).

### Auth (email + Google / Apple)

Login and register use normal accounts (empty form fields — no demo autofill).

**Frontend** (`ibo-exchange/.env`):

```env
VITE_GOOGLE_CLIENT_ID=your-google-web-client-id.apps.googleusercontent.com
VITE_APPLE_CLIENT_ID=com.your.services.id
VITE_APPLE_REDIRECT_URI=https://your-domain.com/login
# Optional: VITE_AUTH_RELAXED=1 only for local weak-password testing
```

**Backend** (`backend/.env`):

```env
GOOGLE_OAUTH_CLIENT_ID=same-as-frontend-web-client-id
APPLE_OAUTH_CLIENT_ID=same-services-id
APPLE_OAUTH_REDIRECT_URI=https://your-domain.com/login
# AUTH_RELAXED=1 only for local weak-password testing (default is strict)
```

Google Cloud: OAuth client type **Web**, authorized JS origins include your exchange origin.  
Apple Developer: **Sign in with Apple** Services ID + domains/return URLs matching `APPLE_OAUTH_REDIRECT_URI`.

**Production build** (deployed API — same as mobile release APK):

```bash
npm run build
```

Uses `.env.production` (`http://207.180.213.153:8005`). Edit that file if your server URL changes.
