"""Refresh the catalog from Kaggle, enrich it with SteamSpy, and build HNSW artifacts.

Run from backend: python scripts/prepare_data.py --limit 3000
"""

from __future__ import annotations

import argparse
import html
import json
import re
import time
from pathlib import Path

import faiss
import kagglehub
import numpy as np
import pandas as pd
import requests
from sentence_transformers import SentenceTransformer

ROOT = Path(__file__).parents[1]
DATA_DIR = ROOT / "data"
DATASET = "deepann/80000-steam-games-dataset"


def clean(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    if isinstance(value, (dict, list)):
        value = json.dumps(value)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(str(value)))).strip()


def first_column(frame: pd.DataFrame, choices: list[str]) -> str | None:
    columns = {str(column).lower(): column for column in frame.columns}
    return next((columns[choice] for choice in choices if choice in columns), None)


def number(text: str, default: int) -> int:
    match = re.search(r"(\d+(?:\.\d+)?)\s*(gb|mb)?", text.lower())
    if not match:
        return default
    value = float(match.group(1))
    return max(1, round(value / 1024)) if match.group(2) == "mb" else max(1, round(value))


def tier(text: str, gpu: bool) -> str:
    value = text.lower()
    if any(key in value for key in ("rtx", "rx 6", "rx 7", "gtx 108", "gtx 166", "i7", "ryzen 7", "i9", "ryzen 9")):
        return "High-end"
    if any(key in value for key in ("gtx", "rx", "radeon", "geforce", "i5", "ryzen 5")):
        return "Mid-range"
    if gpu and any(key in value for key in ("intel", "integrated", "hd graphics", "uhd")):
        return "Integrated"
    return "Entry"


def steamspy(app_id: int) -> dict:
    response = requests.get("https://steamspy.com/api.php", params={"request": "appdetails", "appid": app_id}, timeout=20)
    response.raise_for_status()
    return response.json()


def main(limit: int) -> None:
    source = Path(kagglehub.dataset_download(DATASET))
    files = sorted(source.rglob("*.json")) + sorted(source.rglob("*.csv"))
    if not files:
        raise FileNotFoundError("The Kaggle dataset contains no CSV or JSON file.")
    selected = max(files, key=lambda path: path.stat().st_size)
    if selected.suffix == ".csv":
        frame = pd.read_csv(selected, low_memory=False)
    else:
        payload = json.loads(selected.read_text(encoding="utf-8"))
        if isinstance(payload, dict): payload = payload.get("games", payload.get("data", list(payload.values())))
        frame = pd.json_normalize(payload, sep=".")

    names = {field: first_column(frame, choices) for field, choices in {
        "id": ["appid", "app_id", "steam_appid"], "title": ["name", "title"],
        "description": ["full_desc.desc", "description", "detailed_description", "about_the_game", "short_description"],
        "genres": ["genres", "genre", "popu_tags", "tags", "categories"],
        "minimum": ["requirements.minimum", "pc_requirements.minimum", "minimum_requirements", "minimum"],
    }.items()}
    if not names["id"] or not names["title"] or not names["description"]:
        raise ValueError(f"Required columns not found. Available columns: {frame.columns.tolist()[:30]}")

    games = []
    for _, row in frame.dropna(subset=[names["id"], names["title"]]).head(limit * 3).iterrows():
        try: app_id = int(row[names["id"]])
        except (TypeError, ValueError): continue
        description, genres, minimum = clean(row[names["description"]]), clean(row[names["genres"]]) if names["genres"] else "", clean(row[names["minimum"]]) if names["minimum"] else ""
        if len(description) < 30: continue
        try:
            stats = steamspy(app_id)
            time.sleep(0.25)  # SteamSpy asks applications to avoid aggressive requests.
        except requests.RequestException:
            stats = {}
        tags = [tag.strip() for tag in re.split(r"[,;|]", genres) if tag.strip()][:6]
        if not tags: tags = [tag for tag in stats.get("genre", "").split(",") if tag] or ["Other"]
        owners = stats.get("owners", "0 .. 0").split("..")[0].strip().replace(",", "")
        games.append({"app_id": app_id, "title": clean(row[names["title"]]), "genres": tags, "positive_reviews": int(stats.get("positive", 0)), "estimated_owners": int(owners) if owners.isdigit() else 0, "free_to_play": stats.get("price", "1") == "0", "steam_url": f"https://store.steampowered.com/app/{app_id}/", "description": description[:1400], "requirements": {"os": "Windows" if "windows" in minimum.lower() else "Windows", "ram_gb": number(minimum, 8), "cpu_tier": tier(minimum, False), "gpu_tier": tier(minimum, True), "storage_gb": number(re.search(r"storage[^.]*", minimum, re.I).group(0) if re.search(r"storage[^.]*", minimum, re.I) else "", 30)}})
        if len(games) >= limit: break

    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "games.json").write_text(json.dumps(games, ensure_ascii=True), encoding="utf-8")
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    documents = [f"{game['title']}. {' '.join(game['genres'])}. {game['description']} Requirements: {game['requirements']}" for game in games]
    vectors = model.encode(documents, normalize_embeddings=True, show_progress_bar=True, convert_to_numpy=True).astype("float32")
    index = faiss.IndexHNSWFlat(vectors.shape[1], 32, faiss.METRIC_L2)
    index.hnsw.efConstruction, index.hnsw.efSearch = 80, 64
    index.add(vectors)
    artifacts = DATA_DIR / "artifacts"; artifacts.mkdir(exist_ok=True)
    faiss.write_index(index, str(artifacts / "games_hnsw.faiss"))
    (artifacts / "vector_ids.json").write_text(json.dumps([game["app_id"] for game in games]))
    print(f"Saved {len(games)} games and HNSW artifacts to {DATA_DIR}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=1000)
    main(parser.parse_args().limit)
