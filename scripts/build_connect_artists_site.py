"""Build a direct-entry Connect Artists public site for static hosting."""

from __future__ import annotations

import shutil
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.config import (
    EDGES_TOP100K_FILE,
    EDGES_WITH_TRACKS_FILE,
    MIXDNA_LITE_META_FILE,
    MIXDNA_LITE_VECTORS_FILE,
    PROJECT_ROOT,
    VIZ_TOP100K_FILE,
)


OUTPUT_DIR = PROJECT_ROOT / "docs"
OUTPUT_DATA_DIR = OUTPUT_DIR / "spotify_clean_parquet"
WEB_DIR = PROJECT_ROOT / "web"

STATIC_ASSETS = [
    VIZ_TOP100K_FILE,
    EDGES_WITH_TRACKS_FILE,
    EDGES_TOP100K_FILE,
    MIXDNA_LITE_META_FILE,
    MIXDNA_LITE_VECTORS_FILE,
]

SHELL_ASSETS = [
    WEB_DIR / "styles.css",
    WEB_DIR / "app.js",
]

SHELL_ASSET_DIRS = [
    (WEB_DIR / "vendor", OUTPUT_DIR / "vendor"),
]

HEADERS_TEXT = """/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/spotify_clean_parquet/*.json
  Cache-Control: public, max-age=3600, must-revalidate

/spotify_clean_parquet/*.bin
  Cache-Control: public, max-age=31536000, immutable
"""


def build_entry_html(source_html: str) -> str:
    html = source_html.replace(
        "<title>Spotify Universe | 3D Artist Explorer</title>",
        "<title>Spotify Universe | Connect Artists</title>",
        1,
    )
    html = html.replace(
        'content="Explore 900,000+ artists in an interactive 3D galaxy powered by AI embeddings."',
        'content="Trace artist collaboration routes and blend artist DNA in a free browser-native public edition."',
        1,
    )
    html = html.replace(
        '<script src="./app.js"></script>',
        '<script>window.__SPOTIFY_FORCE_CONNECT_ONLY__ = true;</script>\n    <script src="./app.js"></script>',
        1,
    )
    return html


def copy_assets() -> None:
    OUTPUT_DATA_DIR.mkdir(parents=True, exist_ok=True)
    for asset in STATIC_ASSETS:
        shutil.copy2(asset, OUTPUT_DATA_DIR / asset.name)
        print(f"    Copied {asset.name}")


def copy_shell_assets() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for asset in SHELL_ASSETS:
        shutil.copy2(asset, OUTPUT_DIR / asset.name)
        print(f"    Copied {asset.name}")

    for source_dir, target_dir in SHELL_ASSET_DIRS:
        if not source_dir.exists():
            continue
        shutil.copytree(source_dir, target_dir, dirs_exist_ok=True)
        print(f"    Copied {source_dir.name}/")


def write_public_entries(entry_html: str) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (PROJECT_ROOT / "web" / "connect-artists.html").write_text(entry_html, encoding="utf-8")
    (OUTPUT_DIR / "index.html").write_text(entry_html, encoding="utf-8")
    (OUTPUT_DIR / "404.html").write_text(entry_html, encoding="utf-8")
    (OUTPUT_DIR / ".nojekyll").write_text("", encoding="utf-8")
    (OUTPUT_DIR / "_headers").write_text(HEADERS_TEXT, encoding="utf-8")


def main() -> None:
    print("[*] Building deployable Connect Artists site...")
    source_html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
    entry_html = build_entry_html(source_html)
    write_public_entries(entry_html)
    copy_shell_assets()
    copy_assets()
    print(f"[*] Ready to deploy from: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()