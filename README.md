# IBO Token Website

Official marketing website for **IBO ($IBO)** — the utility token powering the upcoming IBO centralized exchange on BNB Chain (BEP-20).

---

## Project Structure

```
IBO-Exchange/
├── ibo-exchange/    # ★ Exchange web app (Vite) — http://localhost:5173
├── ibo-admin/       # ★ Admin panel (Vite) — http://localhost:5174
├── backend/           # FastAPI + MongoDB — http://localhost:8000
├── frontend/          # Legacy token marketing site only — http://localhost:3000
│                      # (NOT the exchange; new UI work is in ibo-exchange/)
└── scripts/start-platform.ps1   # Start backend + exchange + admin together
```

> **Important:** Market catalog, wallet deposit search, and landing markets UI live in **`ibo-exchange`** and **`ibo-admin`**, not in `frontend/`. If you run `npm start` inside `frontend/`, you will not see those changes.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 19, React Router 7, Tailwind CSS 3, Framer Motion, Recharts, tsParticles, shadcn/ui, html2pdf.js |
| **Backend** | FastAPI, Motor (async MongoDB), Pydantic v2 |
| **Database** | MongoDB |

---

## Running Locally

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10+
- **MongoDB** instance (connection string in `backend/.env`)

---

### Backend

```bash
cd backend

# Create & activate virtual environment (recommended)
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS / Linux

# Install dependencies
pip install -r requirements.txt

# Configure environment
# Edit backend/.env:
#   MONGO_URL=<your-mongodb-connection-string>
#   DB_NAME=ibo_db
#   CORS_ORIGINS=http://localhost:3000

# Start the API server
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

API will be available at **http://localhost:8000**

#### API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/` | Health check |
| GET | `/api/health` | Detailed health (includes DB status) |
| GET | `/api/token-stats` | IBO token information |
| POST | `/api/status` | Create a status record |
| GET | `/api/status` | List all status records |

---

### Exchange + Admin (current platform UI)

From the repo root, you can start all three services:

```powershell
.\scripts\start-platform.ps1
```

Or manually:

```bash
# Terminal 1 — API
cd backend
uvicorn server:app --reload --host 0.0.0.0 --port 8000

# Terminal 2 — Exchange
cd ibo-exchange
npm install
npm run dev
# → http://localhost:5173

# Terminal 3 — Admin
cd ibo-admin
npm install
npm run dev
# → http://localhost:5174  → sidebar: Market Catalog, Token Listings
```

Copy env files (or create from examples):

- `ibo-exchange/.env` → `VITE_BACKEND_URL=http://localhost:8000`
- `ibo-admin/.env` → `VITE_BACKEND_URL=http://localhost:8000`

After changing `.env` or backend code, **restart** the dev servers. Hard-refresh the browser (`Ctrl+Shift+R`).

### Legacy marketing frontend (`frontend/`)

```bash
cd frontend
npm install
npm start
```

App will be available at **http://localhost:3000** — token landing / whitepaper only, not the exchange.

#### Build for production

```bash
cd frontend
npm run build
```

---

## Token Details

| Property | Value |
|---|---|
| **Name** | IBO |
| **Symbol** | $IBO |
| **Network** | BNB Chain (BEP-20) |
| **Total Supply** | 1,000,000,000 |
| **Contract** | `0x7962f32a587c49ad4235ddc5982a0ae1945a2c01` |
| **BscScan** | [View on BscScan](https://bscscan.com/token/0x7962f32a587c49ad4235ddc5982a0ae1945a2c01) |
| **Buy** | [PancakeSwap](https://pancakeswap.finance/swap?outputCurrency=0x7962f32a587c49ad4235ddc5982a0ae1945a2c01) |

---

## Social Links (Update in `frontend/src/components/Footer.jsx` → `SOCIAL` object)

| Channel | Status |
|---|---|
| Telegram | `https://t.me/iboofficial` |
| Twitter / X | `https://x.com/iboofficial` |
| Discord | `https://discord.gg/ibo` |
| Email | `contact@ibo.io` |

---

## Features

- Animated landing page with particle effects
- Full whitepaper page with **PDF download**
- About page
- Tokenomics with interactive chart
- 5-phase roadmap timeline
- FAQ accordion
- Stats bar connected to backend API (with static fallback)
- Mobile responsive design

---

## Environment Variables

### `backend/.env`

```env
MONGO_URL=<mongodb-connection-string>
DB_NAME=ibo_db
CORS_ORIGINS=http://localhost:3000
```

### `frontend/.env`

```env
REACT_APP_BACKEND_URL=http://localhost:8000
WDS_SOCKET_PORT=443
ENABLE_HEALTH_CHECK=false
```
