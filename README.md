# Spec Scout

Steam-game recommendation website with natural-language search, PC-specification filters, FAISS semantic retrieval, and popularity ranking.

## Run locally

1. Start the API in one terminal:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

2. Start the Next.js site in another terminal:

```powershell
npm run dev
```

Open `http://localhost:3000`. The included 10-game catalog makes the site usable immediately.

## Search and ranking

The search form submits a natural-language prompt plus OS, RAM, CPU, GPU, storage, genre, and price filters. The API filters by minimum requirements first, then ranks compatible games by positive Steam reviews descending and estimated SteamSpy owners descending. With FAISS artifacts present, the prompt is embedded by `all-MiniLM-L6-v2` and searched through HNSW; otherwise, the API uses a clearly labelled keyword fallback.

## Refresh production data

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pip install -r requirements-refresh.txt
python scripts/prepare_data.py --limit 1000
```

The script downloads Kaggle dataset `deepann/80000-steam-games-dataset`, enriches valid Steam app IDs using SteamSpy, writes `backend/data/games.json`, and builds `backend/data/artifacts/games_hnsw.faiss`. SteamSpy's owner count is an estimate, not a count of unique active players. The script waits between requests; use moderate limits and respect SteamSpy availability/rate limits.

## Configuration

Copy `.env.example` for the browser API URL and `backend/.env.example` for backend CORS/data location. No secrets are committed.

## Deploy on Vercel

The website includes a Vercel-native `/api/search` route, so it can run without a separate backend host or payment method.

1. Import the GitHub repository into Vercel or run `vercel --prod` from the project root.
2. No environment variables are required for the all-Vercel deployment.
3. The Python/FastAPI backend remains in `backend/` for local work and optional FAISS experiments.

The Vercel route uses the lightweight catalog and keyword matching. The Python backend and local refresh command support the heavier transformer/FAISS workflow when you need it.
