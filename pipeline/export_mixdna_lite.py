"""Export a browser-friendly, quantized embedding asset for MixDNA lite."""

from __future__ import annotations

import json
from pathlib import Path
import sys

import numpy as np
from gensim.models import Word2Vec

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.config import (
    MIXDNA_LITE_META_FILE,
    MIXDNA_LITE_VECTORS_FILE,
    NODE2VEC_MODEL_FILE,
    NODE2VEC_LIGHT_MODEL_FILE,
    VIZ_TOP100K_FILE,
)


MODEL_CANDIDATES = [
    NODE2VEC_LIGHT_MODEL_FILE,
    NODE2VEC_MODEL_FILE,
]


def collect_matching_vectors(model_path, top_ids):
    model = Word2Vec.load(str(model_path))
    matched_ids: list[int] = []
    matched_vectors: list[np.ndarray] = []

    for key in model.wv.index_to_key:
        try:
            artist_id = int(key)
        except (TypeError, ValueError):
            continue

        if artist_id not in top_ids:
            continue

        matched_ids.append(artist_id)
        matched_vectors.append(model.wv[key])

    return matched_ids, matched_vectors


def main() -> None:
    print("[*] Exporting MixDNA lite assets...")

    with open(VIZ_TOP100K_FILE, "r", encoding="utf-8") as f:
        top_artists = json.load(f)

    top_ids = {int(artist["i"]): artist["n"] for artist in top_artists}
    print(f"    Top artists loaded: {len(top_ids):,}")

    best_model_path = None
    export_ids: list[int] = []
    export_vectors: list[np.ndarray] = []

    for model_path in MODEL_CANDIDATES:
        candidate_ids, candidate_vectors = collect_matching_vectors(model_path, top_ids)
        print(f"    Coverage with {model_path.name}: {len(candidate_ids):,} artists")
        if len(candidate_ids) > len(export_ids):
            best_model_path = model_path
            export_ids = candidate_ids
            export_vectors = candidate_vectors

    if not export_vectors:
        raise RuntimeError("No embeddings matched the top-100k artist subset")

    matrix = np.vstack(export_vectors).astype(np.float32)
    scales = np.max(np.abs(matrix), axis=0)
    scales[scales == 0] = 1.0
    quantized = np.clip(np.rint(matrix / scales * 127), -127, 127).astype(np.int8)

    MIXDNA_LITE_VECTORS_FILE.write_bytes(quantized.tobytes())
    metadata = {
        "count": len(export_ids),
        "dimensions": int(matrix.shape[1]),
        "ids": export_ids,
        "scales": scales.astype(np.float32).tolist(),
        "source_model": best_model_path.name,
        "notes": "int8 quantized vectors with per-dimension symmetric scales",
    }
    with open(MIXDNA_LITE_META_FILE, "w", encoding="utf-8") as f:
        json.dump(metadata, f)

    raw_size_mb = matrix.nbytes / (1024 * 1024)
    quantized_size_mb = quantized.nbytes / (1024 * 1024)

    print(f"    Exported vectors: {len(export_ids):,}")
    print(f"    Dimensions: {matrix.shape[1]}")
    print(f"    Raw float32 size: {raw_size_mb:.2f} MB")
    print(f"    Quantized int8 size: {quantized_size_mb:.2f} MB")
    print(f"    Metadata: {MIXDNA_LITE_META_FILE}")
    print(f"    Vector blob: {MIXDNA_LITE_VECTORS_FILE}")


if __name__ == "__main__":
    main()