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

## Deploy

The repository includes `render.yaml` for the FastAPI service and `vercel.json` for the Next.js frontend.

1. Create a Render Blueprint from the GitHub repository. Render discovers `render.yaml`, builds `backend/requirements.txt`, and exposes `/health`.
2. Copy the resulting Render URL, such as `https://spec-scout-api.onrender.com`.
3. Import the repository into Vercel. Set `NEXT_PUBLIC_API_URL` to the Render URL for Production, Preview, and Development, then deploy.
4. On Render, change `CORS_ORIGINS` from `*` to the deployed Vercel URL after it is known, for example `https://spec-scout.vercel.app`.

The Render runtime intentionally installs only the small API dependency set. The local refresh command installs the heavier transformer/FAISS tools when you want to generate production retrieval artifacts.
