from pathlib import Path
import sys
import unittest

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.utils import build_adjacency, build_edge_structures, cosine_similarity, parse_genres


class CoreUtilsTests(unittest.TestCase):
    def test_parse_genres_handles_stringified_lists(self) -> None:
        parsed = parse_genres("['rock', ' pop ', '']")
        self.assertEqual(parsed, {"rock", "pop"})

    def test_parse_genres_handles_empty_values(self) -> None:
        self.assertEqual(parse_genres(None), set())
        self.assertEqual(parse_genres("  "), set())

    def test_cosine_similarity_handles_zero_vectors(self) -> None:
        vec_a = np.array([0.0, 0.0], dtype=np.float32)
        vec_b = np.array([1.0, 1.0], dtype=np.float32)
        self.assertEqual(cosine_similarity(vec_a, vec_b), 0.0)

    def test_build_adjacency_builds_bidirectional_links(self) -> None:
        edges_df = pd.DataFrame(
            {
                "source": [1, 1, 2],
                "target": [2, 3, 3],
            }
        )

        adjacency = build_adjacency(edges_df, as_sets=True)

        self.assertEqual(adjacency[1], {2, 3})
        self.assertEqual(adjacency[2], {1, 3})
        self.assertEqual(adjacency[3], {1, 2})

    def test_build_edge_structures_normalizes_pairs(self) -> None:
        edges_df = pd.DataFrame(
            {
                "source": [10, 20],
                "target": [20, 10],
            }
        )

        edge_set, adjacency = build_edge_structures(edges_df)

        self.assertEqual(edge_set, {(10, 20)})
        self.assertEqual(adjacency[10], {20})
        self.assertEqual(adjacency[20], {10})


if __name__ == "__main__":
    unittest.main()
