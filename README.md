# Spec Scout

Dynamic Steam-game recommendation site using the Kaggle `deepann/80000-steam-games-dataset`, `all-MiniLM-L6-v2` embeddings, and Qdrant Cloud vector search.

## Architecture

1. `backend/scripts/index_qdrant.py` downloads the complete Kaggle catalog, normalizes descriptions, genres, requirements, review/owner fields, generates 384-dimensional MiniLM embeddings, and uploads all valid games to Qdrant.
2. The Vercel `/api/search` route embeds the user's prompt with the same MiniLM model through Hugging Face Inference, queries Qdrant for the 500 nearest games, applies the selected hardware and genre rules, then orders matches by positive reviews and estimated owners.
3. An empty prompt uses Qdrant's positive-review payload index to browse popular compatible games.

No 10-game catalog is used by the deployed search route.

## One-time Qdrant indexing

1. Create a free Qdrant Cloud cluster at `https://cloud.qdrant.io/`.
2. Copy its HTTPS cluster URL and API key.
3. Set them for your local shell, then run the indexer:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-refresh.txt
$env:QDRANT_URL = "https://your-cluster.cloud.qdrant.io"
$env:QDRANT_API_KEY = "your-qdrant-api-key"
python scripts/index_qdrant.py --recreate
```

The complete 80k index takes time to download, embed, and upload. Do not commit generated vectors or credentials.

## Configure Vercel

In Vercel Project Settings → Environment Variables, add these values for Production, Preview, and Development:

| Variable | Value |
| --- | --- |
| `QDRANT_URL` | Your Qdrant Cloud HTTPS URL |
| `QDRANT_API_KEY` | Your Qdrant API key |
| `HUGGINGFACE_API_TOKEN` | A Hugging Face read token from `https://huggingface.co/settings/tokens` |

Redeploy after adding the variables. `HUGGINGFACE_API_TOKEN` is used only server-side and is never exposed to the browser.

## Run locally

```powershell
npm install
npm run dev
```

For local Vercel-route testing, create `.env.local` with the same three secrets. For the older local Python API prototype, see `backend/app/main.py`; the deployed route uses Qdrant instead.
