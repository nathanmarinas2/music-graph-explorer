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

MIN_POPULARITY = int(os.getenv("SPOTIFY_MIN_POPULARITY", "5"))
TOP_K = int(os.getenv("SPOTIFY_TOP_K", "100000"))
DUCKDB_MEMORY_LIMIT = os.getenv("SPOTIFY_DUCKDB_MEMORY_LIMIT", "10GB")
RANDOM_SEED = int(os.getenv("SPOTIFY_RANDOM_SEED", "42"))