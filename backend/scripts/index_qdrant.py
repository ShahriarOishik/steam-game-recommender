"""Embed the complete Kaggle Steam catalog and upload it to Qdrant Cloud.

Set QDRANT_URL and QDRANT_API_KEY, then run:
python scripts/index_qdrant.py --recreate
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
from pathlib import Path

import kagglehub
import numpy as np
import pandas as pd
from qdrant_client import QdrantClient, models
from sentence_transformers import SentenceTransformer

DATASET = "deepann/80000-steam-games-dataset"
COLLECTION = "steam_games"
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
BATCH_SIZE = 128


def clean(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=True)
    value = html.unescape(str(value))
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", value)).strip()


def choose(frame: pd.DataFrame, candidates: list[str]) -> str | None:
    available = {str(column).lower(): column for column in frame.columns}
    return next((available[candidate] for candidate in candidates if candidate in available), None)


def labeled_number(text: str, label: str, default: int) -> int:
    match = re.search(rf"{label}[\s\S]{{0,80}}?(\d+(?:\.\d+)?)\s*(gb|mb)", text, re.I)
    if not match:
        return default
    value = float(match.group(1))
    return max(1, round(value / 1024)) if match.group(2).lower() == "mb" else max(1, round(value))


def hardware_tier(text: str, gpu: bool) -> str:
    value = text.lower()
    if gpu and any(word in value for word in ("intel hd", "intel uhd", "integrated", "onboard")):
        return "Integrated"
    if any(word in value for word in ("rtx", "rx 6", "rx 7", "gtx 10", "gtx 16", "i7", "i9", "ryzen 7", "ryzen 9")):
        return "High-end"
    if any(word in value for word in ("gtx", "radeon", "geforce", "i5", "ryzen 5")):
        return "Mid-range"
    return "Entry"


def owner_count(value: str) -> int:
    match = re.search(r"[\d,]+", value)
    return int(match.group().replace(",", "")) if match else 0


def load_frame() -> pd.DataFrame:
    directory = Path(kagglehub.dataset_download(DATASET))
    candidates = sorted(directory.rglob("*.json")) + sorted(directory.rglob("*.csv"))
    if not candidates:
        raise FileNotFoundError("No JSON or CSV file was found in the Kaggle dataset.")
    source = max(candidates, key=lambda path: path.stat().st_size)
    if source.suffix.lower() == ".csv":
        return pd.read_csv(source, low_memory=False)
    payload = json.loads(source.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        payload = payload.get("games", payload.get("data", list(payload.values())))
    return pd.json_normalize(payload, sep=".")


def build_games(frame: pd.DataFrame) -> list[dict]:
    fields = {
        "id": choose(frame, ["appid", "app_id", "steam_appid"]),
        "title": choose(frame, ["name", "title"]),
        "description": choose(frame, ["full_desc.desc", "description", "detailed_description", "about_the_game", "short_description"]),
        "genres": choose(frame, ["genres", "genre", "popu_tags", "tags", "categories"]),
        "minimum": choose(frame, ["requirements.minimum", "pc_requirements.minimum", "minimum_requirements", "minimum"]),
        "positive": choose(frame, ["positive", "positive_reviews", "ratings.positive", "reviews.positive"]),
        "owners": choose(frame, ["owners", "estimated_owners", "owner_count"]),
        "free": choose(frame, ["is_free", "free_to_play"]),
        "header": choose(frame, ["header_image", "header"]),
    }
    if not all(fields[key] for key in ("id", "title", "description")):
        raise ValueError(f"Required fields missing. Columns available: {frame.columns.tolist()[:40]}")

    games, seen = [], set()
    for _, row in frame.iterrows():
        try:
            app_id = int(row[fields["id"]])
        except (TypeError, ValueError):
            continue
        description = clean(row[fields["description"]])
        title = clean(row[fields["title"]])
        if app_id in seen or not title or len(description) < 30:
            continue
        seen.add(app_id)
        requirement = clean(row[fields["minimum"]]) if fields["minimum"] else ""
        genre_text = clean(row[fields["genres"]]) if fields["genres"] else "Other"
        genres = [item.strip() for item in re.split(r"[,;|]", genre_text) if item.strip()][:12] or ["Other"]
        positive = int(pd.to_numeric(row[fields["positive"]], errors="coerce")) if fields["positive"] and pd.notna(pd.to_numeric(row[fields["positive"]], errors="coerce")) else 0
        owners = owner_count(clean(row[fields["owners"]])) if fields["owners"] else 0
        free_value = clean(row[fields["free"]]).lower() if fields["free"] else "false"
        games.append({
            "app_id": app_id, "title": title, "genres": genres, "description": description[:1800],
            "positive_reviews": positive, "estimated_owners": owners, "free_to_play": free_value in {"1", "true", "yes"},
            "steam_url": f"https://store.steampowered.com/app/{app_id}/", "header_image": clean(row[fields["header"]]) if fields["header"] else "",
            "requirements": {"os": "Windows macOS Linux" if "linux" in requirement.lower() and "mac" in requirement.lower() else "Windows macOS" if "mac" in requirement.lower() else "Windows", "ram_gb": labeled_number(requirement, "memory", 8), "cpu_tier": hardware_tier(requirement, False), "gpu_tier": hardware_tier(requirement, True), "storage_gb": labeled_number(requirement, "storage", 30)},
        })
    return games


def document(game: dict) -> str:
    specs = game["requirements"]
    return f"{game['title']}. Genres and tags: {' '.join(game['genres'])}. {game['description']} Requirements: {specs['os']}, {specs['ram_gb']} GB RAM, {specs['cpu_tier']} CPU, {specs['gpu_tier']} GPU, {specs['storage_gb']} GB storage."


def main(recreate: bool) -> None:
    url, api_key = os.getenv("QDRANT_URL"), os.getenv("QDRANT_API_KEY")
    if not url or not api_key:
        raise RuntimeError("Set QDRANT_URL and QDRANT_API_KEY before indexing.")
    games = build_games(load_frame())
    if len(games) < 20_000:
        raise RuntimeError(f"Only {len(games):,} usable games were found; expected the 80k dataset.")
    client = QdrantClient(url=url, api_key=api_key, timeout=120)
    if recreate and client.collection_exists(COLLECTION):
        client.delete_collection(COLLECTION)
    if not client.collection_exists(COLLECTION):
        client.create_collection(COLLECTION, vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE))
        for field, schema in (("positive_reviews", models.PayloadSchemaType.INTEGER), ("estimated_owners", models.PayloadSchemaType.INTEGER), ("requirements.ram_gb", models.PayloadSchemaType.INTEGER), ("requirements.storage_gb", models.PayloadSchemaType.INTEGER)):
            client.create_payload_index(COLLECTION, field_name=field, field_schema=schema)

    model = SentenceTransformer(MODEL_NAME)
    for start in range(0, len(games), BATCH_SIZE):
        batch = games[start:start + BATCH_SIZE]
        vectors = model.encode([document(game) for game in batch], batch_size=32, normalize_embeddings=True, convert_to_numpy=True).astype(np.float32)
        client.upsert(COLLECTION, points=[models.PointStruct(id=game["app_id"], vector=vector.tolist(), payload=game) for game, vector in zip(batch, vectors)], wait=True)
        print(f"Uploaded {min(start + len(batch), len(games)):,}/{len(games):,} games")
    print(f"Qdrant collection '{COLLECTION}' is ready with {len(games):,} games.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--recreate", action="store_true", help="Delete and rebuild the Qdrant collection.")
    main(parser.parse_args().recreate)
