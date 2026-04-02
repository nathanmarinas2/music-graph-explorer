"""
06_generate_top100k.py - Genera datos reducidos para el modo 'Top 100k' con Path Finder.

Outputs:
  - viz_data_top100k.json: 100k artistas más populares con coordenadas 3D
  - edges_top100k.json: Aristas (colaboraciones) entre esos 100k artistas
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

def main():
    print("[*] Generando datos para modo Top 100k...")
    start = time.time()
    
    # 1. Cargar viz_data.json completo
    print("    Cargando viz_data.json...")
    with open(VIZ_DATA_FILE, 'r', encoding='utf-8') as f:
        all_artists = json.load(f)
    
    print(f"    Total artistas cargados: {len(all_artists):,}")
    
    # 2. Ordenar por popularidad y tomar Top K
    print(f"    Seleccionando Top {TOP_K:,} por popularidad...")
    sorted_artists = sorted(all_artists, key=lambda x: x['p'], reverse=True)
    top_artists = sorted_artists[:TOP_K]
    
    # Crear set de IDs válidos para filtrar aristas
    top_ids = set(a['i'] for a in top_artists)
    
    # 3. Guardar viz_data_top100k.json
    print(f"    Guardando {VIZ_TOP100K_FILE.name}...")
    with open(VIZ_TOP100K_FILE, 'w', encoding='utf-8') as f:
        json.dump(top_artists, f)
    
    # 4. Filtrar aristas (solo entre artistas del Top 100k)
    print("    Cargando y filtrando aristas...")
    con = duckdb.connect()
    top_ids_df = pd.DataFrame({'artist_id': list(top_ids)})
    con.register('top_ids_df', top_ids_df)

    total_edges = con.execute(
        f"SELECT COUNT(*) FROM '{as_sql_path(CONNECTIONS_FILE)}'"
    ).fetchone()[0]
    print(f"    Aristas totales: {total_edges:,}")

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
    
    print(f"    Aristas filtradas (Top 100k): {len(filtered_edges):,}")
    
    # 5. Guardar edges_top100k.json
    print(f"    Guardando {EDGES_TOP100K_FILE.name}...")
    with open(EDGES_TOP100K_FILE, 'w', encoding='utf-8') as f:
        json.dump(filtered_edges, f)
    
    # Stats
    print(f"\n[*] ¡Completado en {time.time() - start:.1f}s!")
    print(f"    Artistas: {len(top_artists):,}")
    print(f"    Aristas: {len(filtered_edges):,}")
    print(f"    Archivos: {VIZ_TOP100K_FILE.name}, {EDGES_TOP100K_FILE.name}")

if __name__ == "__main__":
    main()
