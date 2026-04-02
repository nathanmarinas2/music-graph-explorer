"""
03_build_graph.py - Construye el grafo de colaboraciones entre artistas.

CORREGIDO: Usa la columna 'rowid' real de artists.parquet en lugar de row_number().
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

def build_graph():
    print("[*] Construyendo grafo de colaboraciones (CORREGIDO)...")
    start_time = time.time()
    
    con = duckdb.connect()
    
    # Configurar temp directory
    temp_dir = ensure_directory(DUCKDB_TEMP_DIR)
    con.execute(f"SET temp_directory='{as_sql_path(temp_dir)}'")
    con.execute(f"SET memory_limit='{DUCKDB_MEMORY_LIMIT}'")
    
    # Paso 1: Obtener artistas válidos (con popularidad mínima) usando su rowid REAL
    print("    Paso 1: Filtrando artistas por popularidad...")
    con.execute(f"""
        CREATE TEMPORARY TABLE valid_artists AS
        SELECT rowid as artist_id, name, popularity
        FROM '{as_sql_path(ARTISTS_FILE)}'
        WHERE popularity >= {MIN_POPULARITY}
    """)
    
    valid_count = con.execute("SELECT COUNT(*) FROM valid_artists").fetchone()[0]
    print(f"    Artistas válidos (popularidad >= {MIN_POPULARITY}): {valid_count:,}")
    
    # Paso 2: Filtrar track_artists para quedarnos solo con artistas válidos
    print("    Paso 2: Filtrando colaboraciones...")
    con.execute(f"""
        CREATE TEMPORARY TABLE filtered_track_artists AS
        SELECT ta.track_rowid, ta.artist_rowid
        FROM '{as_sql_path(TRACK_ARTISTS_FILE)}' ta
        JOIN valid_artists va ON ta.artist_rowid = va.artist_id
    """)
    
    # Paso 3: Generar pares de colaboración (artistas que aparecen en el mismo track)
    print("    Paso 3: Generando pares de colaboración (esto tarda un poco)...")
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
    print(f"    Colaboraciones únicas encontradas: {collab_count:,}")
    
    # Paso 4: Exportar a Parquet
    print("    Paso 4: Exportando a Parquet...")
    con.execute(f"""
        COPY collaborations TO '{as_sql_path(CONNECTIONS_FILE)}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    
    print(f"[*] ¡Grafo construido en {time.time() - start_time:.2f}s!")
    print(f"    Archivo: {CONNECTIONS_FILE}")

if __name__ == "__main__":
    build_graph()
