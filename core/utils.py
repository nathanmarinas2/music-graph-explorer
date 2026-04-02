from __future__ import annotations

import ast
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
from gensim.models import Word2Vec


def as_sql_path(path: Path) -> str:
    return path.as_posix()


def ensure_directory(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    norm_a = float(np.linalg.norm(vec_a))
    norm_b = float(np.linalg.norm(vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))


def parse_genres(value: object) -> set[str]:
    if value is None:
        return set()

    if isinstance(value, float) and pd.isna(value):
        return set()

    if isinstance(value, (list, tuple, set)):
        return {str(item).strip() for item in value if str(item).strip()}

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return set()

        if text.startswith("[") and text.endswith("]"):
            try:
                parsed = ast.literal_eval(text)
            except (SyntaxError, ValueError):
                return set()
            return parse_genres(parsed)

        return {text}

    return {str(value).strip()}


def load_word2vec_embeddings(
    model_path: Path,
    allowed_ids: Iterable[int] | None = None,
) -> dict[int, np.ndarray]:
    model = Word2Vec.load(str(model_path))
    allowed = set(allowed_ids) if allowed_ids is not None else None
    embeddings: dict[int, np.ndarray] = {}

    for key in model.wv.index_to_key:
        try:
            artist_id = int(key)
        except (TypeError, ValueError):
            continue

        if allowed is not None and artist_id not in allowed:
            continue

        embeddings[artist_id] = model.wv[key]

    del model
    return embeddings


def build_adjacency(edges_df: pd.DataFrame, *, as_sets: bool) -> dict[int, list[int] | set[int]]:
    pairs = edges_df.loc[:, ["source", "target"]].astype("int64")
    reversed_pairs = pairs.rename(columns={"source": "target", "target": "source"})
    reversed_pairs.columns = ["source", "target"]
    stacked = pd.concat([pairs, reversed_pairs], ignore_index=True)
    grouped = stacked.groupby("source", sort=False)["target"].agg(list)

    if as_sets:
        return {
            int(source): {int(target) for target in targets}
            for source, targets in grouped.items()
        }

    return {
        int(source): [int(target) for target in targets]
        for source, targets in grouped.items()
    }


def build_edge_structures(edges_df: pd.DataFrame) -> tuple[set[tuple[int, int]], dict[int, set[int]]]:
    pairs = edges_df.loc[:, ["source", "target"]].astype("int64")
    sources = pairs["source"].to_numpy(copy=False)
    targets = pairs["target"].to_numpy(copy=False)
    edge_set = set(zip(np.minimum(sources, targets).tolist(), np.maximum(sources, targets).tolist()))
    adjacency = build_adjacency(pairs, as_sets=True)
    return edge_set, adjacency