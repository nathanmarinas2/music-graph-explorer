"""
04_train_embeddings_light.py - Entrena embeddings Node2Vec sobre el grafo de colaboraciones.

CORREGIDO: Los IDs en artist_connections.parquet ahora son rowid reales.
Este script no necesita cambios lógicos porque simplemente lee source/target del parquet.
El entrenamiento es agnóstico al contenido de los IDs.
"""
from pathlib import Path
import sys

import pandas as pd
from gensim.models import Word2Vec
import random
import time
import multiprocessing

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.config import CONNECTIONS_FILE, NODE2VEC_MODEL_FILE, RANDOM_SEED
from core.utils import build_adjacency

# Configuración Node2Vec
WALK_LENGTH = 15   # Longitud del camino
NUM_WALKS = 10     # Caminos por nodo
VECTOR_SIZE = 64   # Dimensiones del embedding
WINDOW = 5         # Ventana de contexto
WORKERS = multiprocessing.cpu_count()

def train_embeddings():
    print("[*] Iniciando entrenamiento de embeddings...")
    start_time = time.time()
    rng = random.Random(RANDOM_SEED)
    
    # Cargar conexiones
    print("    Cargando grafo...")
    df = pd.read_parquet(CONNECTIONS_FILE)
    print(f"    Conexiones cargadas: {len(df):,}")
    
    # Construir lista de adyacencia
    print("    Construyendo lista de adyacencia...")
    adj = build_adjacency(df, as_sets=False)
    
    nodes = list(adj.keys())
    print(f"    Nodos únicos: {len(nodes):,}")
    
    # Generar Random Walks
    print(f"[*] Generando Random Walks ({NUM_WALKS} x {WALK_LENGTH})...")
    walks = []
    
    total_expected = len(nodes) * NUM_WALKS
    step_count = 0
    
    for _ in range(NUM_WALKS):
        rng.shuffle(nodes)
        for node in nodes:
            walk = [str(node)]  # Gensim necesita strings
            curr = node
            for _ in range(WALK_LENGTH - 1):
                neighbors = adj.get(curr, [])
                if not neighbors:
                    break
                curr = rng.choice(neighbors)
                walk.append(str(curr))
            walks.append(walk)
            
            step_count += 1
            if step_count % 500_000 == 0:
                print(f"    Progreso: {step_count / 1_000_000:.1f}M caminatas...")

    print(f"    Total caminatas: {len(walks):,}")
    
    # Liberar memoria
    del adj, df
    
    # Entrenar Word2Vec
    print(f"[*] Entrenando Word2Vec ({VECTOR_SIZE} dimensiones)...")
    model = Word2Vec(
        sentences=walks,
        vector_size=VECTOR_SIZE,
        window=WINDOW,
        min_count=1,
        sg=1,  # Skip-gram
        workers=WORKERS,
        epochs=5,
        seed=RANDOM_SEED,
    )
    
    # Guardar
    print("[*] Guardando modelo...")
    model.save(str(NODE2VEC_MODEL_FILE))
    
    print(f"[*] ¡ÉXITO! Entrenamiento completado en {time.time() - start_time:.2f}s")
    print(f"    Modelo: {NODE2VEC_MODEL_FILE}")
    print(f"    Vocabulario: {len(model.wv)} nodos")

if __name__ == "__main__":
    train_embeddings()
