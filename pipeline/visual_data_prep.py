"""
05_visual_data_prep.py - Genera el JSON para la visualización 3D.

CORREGIDO: Ahora usa 'rowid' real de artists.parquet para cruzar con el modelo.
Los IDs en el modelo Word2Vec ahora son rowid reales (strings), así que el JOIN funciona.
"""
from pathlib import Path
import sys

import pandas as pd
import numpy as np
import umap
from gensim.models import Word2Vec
import duckdb
import json
import time

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.config import ARTIST_GENRES_FILE, ARTISTS_FILE, NODE2VEC_MODEL_FILE, VIZ_DATA_FILE
from core.utils import as_sql_path

def generate_viz_data():
    print("[*] Preparando datos para visualización 3D...")
    start_time = time.time()
    
    # 1. Cargar Modelo Word2Vec
    print("    Cargando modelo Node2Vec...")
    model = Word2Vec.load(str(NODE2VEC_MODEL_FILE))
    
    # Los keys del modelo son strings (rowid convertido a str durante entrenamiento)
    # Convertimos a int para poder hacer JOIN con DuckDB
    node_ids = [int(k) for k in model.wv.index_to_key]
    vectors = model.wv.vectors
    
    print(f"    Vectores cargados: {len(node_ids):,} (Dim: {vectors.shape[1]})")
    
    # 2. Reducción UMAP a 3D
    print("    Ejecutando UMAP (64D -> 3D)... esto toma unos minutos...")
    reducer = umap.UMAP(
        n_components=3, 
        n_neighbors=15, 
        min_dist=0.1, 
        metric='cosine',
        random_state=42,
        n_jobs=1  # Deterministic
    )
    embedding_3d = reducer.fit_transform(vectors)
    print("    UMAP completado.")
    
    # 3. Enriquecer con Nombres y Géneros (DuckDB)
    print("    Enriqueciendo datos con metadatos...")
    
    # Crear DF temporal con los rowid que tenemos en el modelo
    df_nodes = pd.DataFrame({'artist_rowid': node_ids})
    
    con = duckdb.connect()
    con.register('df_nodes', df_nodes)
    
    # Query usando rowid REAL
    query = f"""
    SELECT 
        n.artist_rowid as id,
        a.name,
        a.popularity,
        min(g.genre) as genre
    FROM df_nodes n
    LEFT JOIN '{as_sql_path(ARTISTS_FILE)}' a ON n.artist_rowid = a.rowid
    LEFT JOIN '{as_sql_path(ARTIST_GENRES_FILE)}' g ON n.artist_rowid = g.artist_rowid
    GROUP BY n.artist_rowid, a.name, a.popularity
    """
    
    print("    Ejecutando JOIN...")
    metadata_df = con.execute(query).df()

    # Reordenar para que coincida con el orden de vectors
    metadata_df = metadata_df.set_index('id').reindex(node_ids).reset_index()
    
    # 4. Construir JSON
    print("    Construyendo JSON...")

    scale = 50  # Escalar coordenadas UMAP

    coords_df = pd.DataFrame(embedding_3d, columns=['x', 'y', 'z'])
    output_df = pd.DataFrame({
        'i': metadata_df['id'].fillna(-1).astype(int),
        'n': metadata_df['name'].fillna('Unknown'),
        'p': metadata_df['popularity'].fillna(0).astype(int),
        'g': metadata_df['genre'].fillna('Other'),
        'x': np.round(coords_df['x'] * scale, 2),
        'y': np.round(coords_df['y'] * scale, 2),
        'z': np.round(coords_df['z'] * scale, 2),
    })
    data = output_df.to_dict(orient='records')
    
    # Guardar
    with open(VIZ_DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f)
    
    print(f"[*] ¡ÉXITO! Datos generados en {time.time() - start_time:.2f}s")
    print(f"    Archivo: {VIZ_DATA_FILE}")
    print(f"    Nodos: {len(data):,}")
    
    # Verificación rápida: buscar artistas famosos
    print("\n    Verificación de artistas famosos:")
    famous = ["Taylor Swift", "The Weeknd", "Bad Bunny", "Drake", "Ed Sheeran"]
    for name in famous:
        matches = [d for d in data if name.lower() in d['n'].lower()]
        if matches:
            print(f"      ✓ {name}: encontrado (pop={matches[0]['p']})")
        else:
            print(f"      ✗ {name}: NO encontrado")

if __name__ == "__main__":
    generate_viz_data()
