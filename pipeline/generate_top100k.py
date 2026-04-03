"""Build the public top-100k artist subset used by the static demo.

Outputs:
    - viz_data_top100k.json: the most popular artists with 3D coordinates
    - edges_top100k.json: collaboration edges between those artists
"""
from pathlib import Path
import sys

import json
import duckdb
import pandas as pd
import time

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.config import CONNECTIONS_FILE, TOP_K, VIZ_DATA_FILE, VIZ_TOP100K_FILE, EDGES_TOP100K_FILE
from core.utils import as_sql_path

def main() -> None:
    print("[*] Building top-100k public data...")
    start = time.time()
    
    # 1. Load the full visualization dataset.
    print("    Loading viz_data.json...")
    with open(VIZ_DATA_FILE, 'r', encoding='utf-8') as f:
        all_artists = json.load(f)
    
    print(f"    Total artists loaded: {len(all_artists):,}")
    
    # 2. Rank by popularity and keep the top-K slice.
    print(f"    Selecting top {TOP_K:,} artists by popularity...")
    sorted_artists = sorted(all_artists, key=lambda x: x['p'], reverse=True)
    top_artists = sorted_artists[:TOP_K]
    
    # Build the ID set used to filter graph edges.
    top_ids = set(a['i'] for a in top_artists)
    
    # 3. Save the reduced node payload.
    print(f"    Saving {VIZ_TOP100K_FILE.name}...")
    with open(VIZ_TOP100K_FILE, 'w', encoding='utf-8') as f:
        json.dump(top_artists, f)
    
    # 4. Keep only edges whose endpoints are both in the public subset.
    print("    Loading and filtering edges...")
    con = duckdb.connect()
    top_ids_df = pd.DataFrame({'artist_id': list(top_ids)})
    con.register('top_ids_df', top_ids_df)

    total_edges = con.execute(
        f"SELECT COUNT(*) FROM '{as_sql_path(CONNECTIONS_FILE)}'"
    ).fetchone()[0]
    print(f"    Total edges: {total_edges:,}")

    filtered_edges = [
        [int(source), int(target)]
        for source, target in con.execute(
            f"""
            SELECT c.source, c.target
            FROM '{as_sql_path(CONNECTIONS_FILE)}' c
            JOIN top_ids_df src ON c.source = src.artist_id
            JOIN top_ids_df tgt ON c.target = tgt.artist_id
            ORDER BY c.source, c.target
            """
        ).fetchall()
    ]
    
    print(f"    Filtered edges (top-100k): {len(filtered_edges):,}")
    
    # 5. Save the reduced edge list.
    print(f"    Saving {EDGES_TOP100K_FILE.name}...")
    with open(EDGES_TOP100K_FILE, 'w', encoding='utf-8') as f:
        json.dump(filtered_edges, f)
    
    print(f"\n[*] Completed in {time.time() - start:.1f}s")
    print(f"    Artists: {len(top_artists):,}")
    print(f"    Edges: {len(filtered_edges):,}")
    print(f"    Outputs: {VIZ_TOP100K_FILE.name}, {EDGES_TOP100K_FILE.name}")

if __name__ == "__main__":
    main()
