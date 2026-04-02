"""
07_generate_edges_with_tracks.py - Genera aristas con nombres de canciones.

Output:
  - edges_top100k_with_tracks.json: [[source_id, target_id, "track_name"], ...]

Esto permite mostrar qué canción conecta a dos artistas en el Path Finder.
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

from core.config import (
    DUCKDB_MEMORY_LIMIT,
    DUCKDB_TEMP_DIR,
    EDGES_WITH_TRACKS_FILE,
    TRACK_ARTISTS_FILE,
    TRACKS_FILE,
    VIZ_TOP100K_FILE,
)
from core.utils import as_sql_path, ensure_directory

def main():
    print("[*] Generando aristas con nombres de canciones...")
    start = time.time()
    
    # 1. Cargar IDs del Top 100k
    print("    Cargando Top 100k IDs...")
    with open(VIZ_TOP100K_FILE, 'r', encoding='utf-8') as f:
        top_artists = json.load(f)
    top_ids_df = pd.DataFrame({'artist_id': [int(a['i']) for a in top_artists]})
    print(f"    IDs cargados: {len(top_ids_df):,}")
    
    # 2. Consultar DuckDB para obtener colaboraciones con nombres de tracks
    print("    Consultando colaboraciones con nombres de tracks...")
    con = duckdb.connect()
    con.register('top_ids_df', top_ids_df)
    
    # Configurar DuckDB para evitar OOM (Out Of Memory)
    print("    Configurando DuckDB (Disk Spilling)...")
    temp_dir = ensure_directory(DUCKDB_TEMP_DIR)
    con.execute(f"SET temp_directory='{as_sql_path(temp_dir)}'")
    con.execute(f"SET memory_limit='{DUCKDB_MEMORY_LIMIT}'")
    
    query = f"""
    WITH filtered_track_artists AS (
        SELECT ta.track_rowid, ta.artist_rowid
        FROM '{as_sql_path(TRACK_ARTISTS_FILE)}' ta
        JOIN top_ids_df top_ids ON ta.artist_rowid = top_ids.artist_id
    ),
    ranked_collaborations AS (
        SELECT 
            LEAST(t1.artist_rowid, t2.artist_rowid) AS source,
            GREATEST(t1.artist_rowid, t2.artist_rowid) AS target,
            COALESCE(t.name, 'Unknown Track') AS track_name,
            ROW_NUMBER() OVER (
                PARTITION BY LEAST(t1.artist_rowid, t2.artist_rowid), GREATEST(t1.artist_rowid, t2.artist_rowid)
                ORDER BY COALESCE(t.popularity, -1) DESC, t1.track_rowid
            ) AS pair_rank
        FROM filtered_track_artists t1
        JOIN filtered_track_artists t2
            ON t1.track_rowid = t2.track_rowid
            AND t1.artist_rowid < t2.artist_rowid
        LEFT JOIN '{as_sql_path(TRACKS_FILE)}' t ON t1.track_rowid = t.rowid
    )
    SELECT source, target, track_name
    FROM ranked_collaborations
    WHERE pair_rank = 1
    ORDER BY source, target
    """
    
    print("    Ejecutando query (esto puede tardar)...")
    rows = con.execute(query).fetchall()
    edges_with_tracks = [[int(src), int(tgt), track] for src, tgt, track in rows]
    
    print(f"    Aristas filtradas: {len(edges_with_tracks):,}")
    
    # 4. Guardar
    print(f"    Guardando {EDGES_WITH_TRACKS_FILE.name}...")
    with open(EDGES_WITH_TRACKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(edges_with_tracks, f)
    
    print(f"\n[*] ¡Completado en {time.time() - start:.1f}s!")
    print(f"    Archivo: {EDGES_WITH_TRACKS_FILE}")

if __name__ == "__main__":
    main()
