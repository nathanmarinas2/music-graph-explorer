"""Generate a lightweight looping GIF for the README hero section."""

from __future__ import annotations

from pathlib import Path
import sys

from PIL import Image, ImageOps


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


SCREENSHOTS_DIR = PROJECT_ROOT / "assets" / "screenshots"
OUTPUT_FILE = SCREENSHOTS_DIR / "music-graph-explorer-hero.gif"
SIZE = (960, 540)
HOLD_FRAMES = 15
FADE_FRAMES = 8
FRAME_DURATION_MS = 100

SOURCE_IMAGES = [
    SCREENSHOTS_DIR / "capture-connect-engine.png",
    SCREENSHOTS_DIR / "capture-connect-engine-2.png",
    SCREENSHOTS_DIR / "dna-fusion.png",
]


def fit_cover(image: Image.Image) -> Image.Image:
    return ImageOps.fit(
        image.convert("RGB"),
        SIZE,
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )


def scene_frames(image: Image.Image) -> list[Image.Image]:
    base = fit_cover(image)
    return [base.copy() for _ in range(HOLD_FRAMES)]


def crossfade_frames(start: Image.Image, end: Image.Image) -> list[Image.Image]:
    frames: list[Image.Image] = []
    for index in range(1, FADE_FRAMES + 1):
        alpha = index / (FADE_FRAMES + 1)
        frames.append(Image.blend(start, end, alpha))
    return frames


def main() -> None:
    missing = [path.name for path in SOURCE_IMAGES if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Missing source screenshots: {', '.join(missing)}")

    source_images = [Image.open(path) for path in SOURCE_IMAGES]
    built_scenes = [scene_frames(image) for image in source_images]

    frames: list[Image.Image] = []
    for index, scene in enumerate(built_scenes):
        frames.extend(scene)
        next_scene = built_scenes[(index + 1) % len(built_scenes)]
        frames.extend(crossfade_frames(scene[-1], next_scene[0]))

    if not frames:
        raise RuntimeError("No GIF frames were generated")

    first, *rest = frames
    first.save(
        OUTPUT_FILE,
        save_all=True,
        append_images=rest,
        optimize=True,
        loop=0,
        duration=[FRAME_DURATION_MS] * len(frames),
        disposal=2,
    )

    print(f"[*] GIF generated: {OUTPUT_FILE}")
    print(f"[*] Frames: {len(frames)}")


if __name__ == "__main__":
    main()