"""FastAPI service for semantic Steam-game recommendations."""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).parents[1] / "data"))
CATALOG_PATH = DATA_DIR / "games.json"
ARTIFACT_DIR = DATA_DIR / "artifacts"
TIER_VALUE = {"Integrated": 0, "Entry": 1, "Mid-range": 2, "High-end": 3}


class SearchRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=500)
    os: str = "Any OS"
    ram_gb: str = "Any RAM"
    cpu_tier: str = "Any CPU"
    gpu_tier: str = "Any GPU"
    storage_gb: str = "Any storage"
    genre: str = "Any genre"
    price: Literal["Any price", "Free to play", "Paid"] = "Any price"
    limit: int = Field(default=12, ge=1, le=50)


def numeric_choice(value: str) -> int | None:
    match = re.search(r"\d+", value)
    return int(match.group()) if match else None


@lru_cache
def catalog() -> list[dict]:
    with CATALOG_PATH.open(encoding="utf-8") as file:
        return json.load(file)


@lru_cache
def semantic_engine():
    """Load persisted FAISS artifacts if a full data refresh has been run."""
    index_path, ids_path = ARTIFACT_DIR / "games_hnsw.faiss", ARTIFACT_DIR / "vector_ids.json"
    if not (index_path.exists() and ids_path.exists()):
        return None
    import faiss
    from sentence_transformers import SentenceTransformer

    return faiss.read_index(str(index_path)), json.loads(ids_path.read_text()), SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


def semantic_scores(prompt: str) -> dict[int, float]:
    engine = semantic_engine()
    if engine is not None:
        index, vector_ids, model = engine
        vector = model.encode([prompt], normalize_embeddings=True, convert_to_numpy=True).astype("float32")
        _, ids = index.search(vector, min(250, index.ntotal))
        return {vector_ids[item]: 1.0 / (rank + 1) for rank, item in enumerate(ids[0]) if item >= 0}
    words = {word for word in re.findall(r"[a-z0-9]+", prompt.lower()) if len(word) > 2}
    scores = {}
    for game in catalog():
        haystack = f"{game['title']} {game['description']} {' '.join(game['genres'])}".lower()
        score = sum(word in haystack for word in words) / max(1, len(words))
        if score:
            scores[game["app_id"]] = score
    return scores


def is_compatible(game: dict, query: SearchRequest) -> bool:
    specs = game["requirements"]
    if query.os != "Any OS" and query.os.lower() not in specs["os"].lower(): return False
    if (ram := numeric_choice(query.ram_gb)) is not None and specs["ram_gb"] > ram: return False
    if (storage := numeric_choice(query.storage_gb)) is not None and specs["storage_gb"] > storage: return False
    if query.cpu_tier != "Any CPU" and TIER_VALUE[specs["cpu_tier"]] > TIER_VALUE[query.cpu_tier]: return False
    if query.gpu_tier != "Any GPU" and TIER_VALUE[specs["gpu_tier"]] > TIER_VALUE[query.gpu_tier]: return False
    if query.genre != "Any genre" and query.genre.lower() not in {genre.lower() for genre in game["genres"]}: return False
    if query.price == "Free to play" and not game["free_to_play"]: return False
    return not (query.price == "Paid" and game["free_to_play"])


app = FastAPI(title="Spec Scout API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","), allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "games": len(catalog()), "semantic_index": semantic_engine() is not None}


@app.post("/api/search")
def search(query: SearchRequest) -> dict:
    scores = semantic_scores(query.prompt)
    matches = [{**game, "match_score": round(scores[game["app_id"]], 4)} for game in catalog() if game["app_id"] in scores and is_compatible(game, query)]
    matches.sort(key=lambda game: (-game["positive_reviews"], -game["estimated_owners"], -game["match_score"]))
    return {"results": matches[:query.limit], "total": len(matches), "search_mode": "FAISS semantic retrieval" if semantic_engine() else "Keyword match fallback"}
