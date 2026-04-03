"""Build the artist collaboration graph from shared track appearances.

The exported parquet stores unique undirected artist pairs using the real
`rowid` values from `artists.parquet`.
"""
from pathlib import Path
import sys

import duckdb
import time

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.config import (
    ARTISTS_FILE,
    CONNECTIONS_FILE,
    DUCKDB_MEMORY_LIMIT,
    DUCKDB_TEMP_DIR,
    MIN_POPULARITY,
    TRACK_ARTISTS_FILE,
)
from core.utils import as_sql_path, ensure_directory

def build_graph() -> None:
    print("[*] Building artist collaboration graph...")
    start_time = time.time()
    
    con = duckdb.connect()
    
    # Configure DuckDB temp storage and memory usage.
    temp_dir = ensure_directory(DUCKDB_TEMP_DIR)
    con.execute(f"SET temp_directory='{as_sql_path(temp_dir)}'")
    con.execute(f"SET memory_limit='{DUCKDB_MEMORY_LIMIT}'")
    
    # Step 1: materialize valid artists above the popularity threshold.
    print("    Step 1: Filtering artists by popularity...")
    con.execute(f"""
        CREATE TEMPORARY TABLE valid_artists AS
        SELECT rowid as artist_id, name, popularity
        FROM '{as_sql_path(ARTISTS_FILE)}'
        WHERE popularity >= {MIN_POPULARITY}
    """)
    
    valid_count = con.execute("SELECT COUNT(*) FROM valid_artists").fetchone()[0]
    print(f"    Valid artists (popularity >= {MIN_POPULARITY}): {valid_count:,}")
    
    # Step 2: keep only track appearances from valid artists.
    print("    Step 2: Filtering collaborations...")
    con.execute(f"""
        CREATE TEMPORARY TABLE filtered_track_artists AS
        SELECT ta.track_rowid, ta.artist_rowid
        FROM '{as_sql_path(TRACK_ARTISTS_FILE)}' ta
        JOIN valid_artists va ON ta.artist_rowid = va.artist_id
    """)
    
    # Step 3: generate unique collaboration pairs from shared tracks.
    print("    Step 3: Building collaboration pairs...")
    con.execute(f"""
        CREATE TEMPORARY TABLE collaborations AS
        SELECT DISTINCT 
            LEAST(t1.artist_rowid, t2.artist_rowid) as source,
            GREATEST(t1.artist_rowid, t2.artist_rowid) as target
        FROM filtered_track_artists t1
        JOIN filtered_track_artists t2 
            ON t1.track_rowid = t2.track_rowid 
            AND t1.artist_rowid < t2.artist_rowid
    """)
    
    collab_count = con.execute("SELECT COUNT(*) FROM collaborations").fetchone()[0]
    print(f"    Unique collaborations found: {collab_count:,}")
    
    # Step 4: export the graph to parquet.
    print("    Step 4: Exporting parquet...")
    con.execute(f"""
        COPY collaborations TO '{as_sql_path(CONNECTIONS_FILE)}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    
    print(f"[*] Graph built in {time.time() - start_time:.2f}s")
    print(f"    Output: {CONNECTIONS_FILE}")

if __name__ == "__main__":
    build_graph()
