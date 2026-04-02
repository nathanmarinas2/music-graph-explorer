from __future__ import annotations

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("SPOTIFY_DATA_DIR", PROJECT_ROOT / "data")).resolve()
DUCKDB_TEMP_DIR = Path(
    os.getenv("SPOTIFY_DUCKDB_TEMP_DIR", PROJECT_ROOT / "duckdb_tmp")
).resolve()

ARTISTS_FILE = DATA_DIR / "artists.parquet"
ARTIST_GENRES_FILE = DATA_DIR / "artist_genres.parquet"
TRACKS_FILE = DATA_DIR / "tracks.parquet"
TRACK_ARTISTS_FILE = DATA_DIR / "track_artists.parquet"
CONNECTIONS_FILE = DATA_DIR / "artist_connections.parquet"
VIZ_DATA_FILE = DATA_DIR / "viz_data.json"
VIZ_TOP100K_FILE = DATA_DIR / "viz_data_top100k.json"
EDGES_TOP100K_FILE = DATA_DIR / "edges_top100k.json"
EDGES_WITH_TRACKS_FILE = DATA_DIR / "edges_top100k_with_tracks.json"
NODE2VEC_MODEL_FILE = DATA_DIR / "node2vec_spotify.model"
NODE2VEC_LIGHT_MODEL_FILE = DATA_DIR / "node2vec_spotify_light.model"
MIXDNA_LITE_META_FILE = DATA_DIR / "mixdna_lite_meta.json"
MIXDNA_LITE_VECTORS_FILE = DATA_DIR / "mixdna_lite_vectors.bin"
LINK_PREDICTOR_MODEL_FILE = DATA_DIR / "link_predictor_model.pkl"
LINK_PREDICTOR_FEATURES_FILE = DATA_DIR / "link_predictor_features.json"
HIT_PREDICTOR_MODEL_FILE = DATA_DIR / "hit_predictor_model_v3.pkl"
HIT_PREDICTOR_TEXT_MODEL_FILE = DATA_DIR / "hit_predictor_model_v3.txt"
HIT_PREDICTOR_INFO_FILE = DATA_DIR / "hit_predictor_info_v3.json"

MIN_POPULARITY = int(os.getenv("SPOTIFY_MIN_POPULARITY", "5"))
TOP_K = int(os.getenv("SPOTIFY_TOP_K", "100000"))
DUCKDB_MEMORY_LIMIT = os.getenv("SPOTIFY_DUCKDB_MEMORY_LIMIT", "10GB")
RANDOM_SEED = int(os.getenv("SPOTIFY_RANDOM_SEED", "42"))
LINK_POSITIVE_SAMPLE_LIMIT = int(os.getenv("SPOTIFY_LINK_POSITIVE_SAMPLE_LIMIT", "50000"))
LINK_NEGATIVE_SAMPLE_RATIO = int(os.getenv("SPOTIFY_LINK_NEGATIVE_SAMPLE_RATIO", "2"))
HIT_TRACK_LIMIT = int(os.getenv("SPOTIFY_HIT_TRACK_LIMIT", "500000"))
SEARCH_RESULT_LIMIT = int(os.getenv("SPOTIFY_SEARCH_RESULT_LIMIT", "10"))

API_HOST = os.getenv("SPOTIFY_API_HOST", "127.0.0.1")
API_PORT = int(os.getenv("SPOTIFY_API_PORT", "8000"))


def _split_csv_env(value: str | None, default: list[str]) -> list[str]:
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


ALLOWED_ORIGINS = _split_csv_env(
    os.getenv("SPOTIFY_ALLOWED_ORIGINS"),
    [
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "null",
    ],
)