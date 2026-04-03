"""Train Node2Vec-style embeddings over the artist collaboration graph."""
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

# Node2Vec-style training configuration.
WALK_LENGTH = 15
NUM_WALKS = 10
VECTOR_SIZE = 64
WINDOW = 5
WORKERS = multiprocessing.cpu_count()

def train_embeddings() -> None:
    print("[*] Training embeddings...")
    start_time = time.time()
    rng = random.Random(RANDOM_SEED)
    
    # Load graph edges.
    print("    Loading graph...")
    df = pd.read_parquet(CONNECTIONS_FILE)
    print(f"    Connections loaded: {len(df):,}")
    
    # Build adjacency lists for random walks.
    print("    Building adjacency list...")
    adj = build_adjacency(df, as_sets=False)
    
    nodes = list(adj.keys())
    print(f"    Unique nodes: {len(nodes):,}")
    
    # Generate random walks.
    print(f"[*] Generating random walks ({NUM_WALKS} x {WALK_LENGTH})...")
    walks = []
    
    total_expected = len(nodes) * NUM_WALKS
    step_count = 0
    
    for _ in range(NUM_WALKS):
        rng.shuffle(nodes)
        for node in nodes:
            walk = [str(node)]
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
                print(f"    Progress: {step_count / 1_000_000:.1f}M walks...")

    print(f"    Total walks: {len(walks):,}")
    
    # Release memory before training.
    del adj, df
    
    # Train Word2Vec on the generated walks.
    print(f"[*] Training Word2Vec ({VECTOR_SIZE} dimensions)...")
    model = Word2Vec(
        sentences=walks,
        vector_size=VECTOR_SIZE,
        window=WINDOW,
        min_count=1,
        sg=1,
        workers=WORKERS,
        epochs=5,
        seed=RANDOM_SEED,
    )
    
    # Persist the model.
    print("[*] Saving model...")
    model.save(str(NODE2VEC_MODEL_FILE))
    
    print(f"[*] Training completed in {time.time() - start_time:.2f}s")
    print(f"    Model: {NODE2VEC_MODEL_FILE}")
    print(f"    Vocabulary: {len(model.wv)} nodes")

if __name__ == "__main__":
    train_embeddings()
