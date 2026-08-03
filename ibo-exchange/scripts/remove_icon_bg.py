"""Remove flat studio backdrop (#151515) without eating dark icon bodies or gold.

Do NOT use rembg — it deletes matte charcoal bodies and keeps only gold accents.
Studio gray is exactly 21; subject body starts ~31.
"""
from pathlib import Path
from collections import deque

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage


ASSETS = Path(r"C:\Users\Naushad\.cursor\projects\e-IBO-Exchange\assets")
OUT = Path(r"e:\IBO-Exchange\ibo-exchange\public\hero")

MAP = {
    "ca18c2a7": "icon-shield.png",
    "24af7ef1": "icon-cards.png",
    "5ec474d7": "icon-coin.png",
}

BG = (21, 21, 21)


def find_src(token: str) -> Path:
    matches = list(ASSETS.glob(f"*{token}*"))
    if not matches:
        raise FileNotFoundError(token)
    return matches[0]


def dist(c, bg=BG):
    return abs(int(c[0]) - bg[0]) + abs(int(c[1]) - bg[1]) + abs(int(c[2]) - bg[2])


def is_flat_neutral(c, max_chroma=5):
    return max(c[:3]) - min(c[:3]) <= max_chroma


def flood_mask(rgb: np.ndarray, tol: int = 4) -> np.ndarray:
    """True = subject keep. Flood from edges through flat studio gray."""
    h, w, _ = rgb.shape
    is_bg = np.zeros((h, w), dtype=bool)
    for y in range(h):
        for x in range(w):
            c = rgb[y, x]
            if is_flat_neutral(c) and dist(c) <= tol:
                is_bg[y, x] = True

    visited = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_bg[y, x]:
                visited[y, x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not visited[y, x] and is_bg[y, x]:
                visited[y, x] = True
                q.append((x, y))

    while q:
        x, y = q.popleft()
        for nx, ny in (
            (x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1),
            (x + 1, y + 1), (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1),
        ):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny, nx] and is_bg[ny, nx]:
                visited[ny, nx] = True
                q.append((nx, ny))

    return ~visited  # subject


def peel_near_bg(rgb: np.ndarray, keep: np.ndarray, tol: int = 8, rounds: int = 4) -> np.ndarray:
    keep = keep.copy()
    h, w = keep.shape
    for _ in range(rounds):
        kill = []
        ys, xs = np.where(keep)
        for y, x in zip(ys, xs):
            c = rgb[y, x]
            if not (is_flat_neutral(c) and dist(c) <= tol):
                continue
            transparent_n = 0
            total_n = 0
            for nx, ny in (
                (x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1),
                (x + 1, y + 1), (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1),
            ):
                if 0 <= nx < w and 0 <= ny < h:
                    total_n += 1
                    if not keep[ny, nx]:
                        transparent_n += 1
            if total_n and transparent_n / total_n >= 0.5:
                kill.append((y, x))
        for y, x in kill:
            keep[y, x] = False
    return keep


def remove_flat_bg(src: Path, dest: Path):
    original = Image.open(src).convert("RGBA")
    arr = np.array(original)
    rgb = arr[:, :, :3]

    keep = flood_mask(rgb, tol=4)
    keep = peel_near_bg(rgb, keep, tol=8, rounds=4)

    # Always keep chromatic / gold pixels
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    bright = rgb.max(axis=2)
    keep |= (chroma >= 16) & (bright >= 65)

    # Morphological opening removes fringe spikes; light close fills tiny bites
    keep = ndimage.binary_opening(keep, structure=np.ones((3, 3)), iterations=1)
    keep = ndimage.binary_closing(keep, structure=np.ones((3, 3)), iterations=1)

    # Soft anti-aliased alpha from distance to edge (no RGB bleed)
    dist_in = ndimage.distance_transform_edt(keep)
    dist_out = ndimage.distance_transform_edt(~keep)
    # 1.2px feather
    alpha = np.zeros(keep.shape, dtype=np.float32)
    alpha[keep] = np.clip(dist_in[keep] / 1.2, 0, 1)
    edge = (~keep) & (dist_out <= 1.2)
    alpha[edge] = np.clip(1.0 - dist_out[edge] / 1.2, 0, 1)
    # Harden interior fully
    alpha[dist_in >= 1.2] = 1.0

    out = np.zeros_like(arr)
    out[:, :, :3] = rgb
    out[:, :, 3] = (alpha * 255).astype(np.uint8)

    img = Image.fromarray(out, "RGBA")
    w, h = img.size
    # 4× LANCZOS + light unsharp for crisp retina display at smaller CSS sizes
    scale = 4
    final = img.resize((w * scale, h * scale), Image.Resampling.LANCZOS)
    rgb = final.convert("RGB")
    alpha = final.getchannel("A")
    rgb = rgb.filter(ImageFilter.UnsharpMask(radius=1.2, percent=120, threshold=2))
    final = rgb.copy()
    final.putalpha(alpha)

    bbox = final.getbbox()
    if bbox:
        pad = 16
        l, t, r, b = bbox
        final = final.crop(
            (max(0, l - pad), max(0, t - pad), min(final.width, r + pad), min(final.height, b + pad))
        )

    # High-quality PNG (no palette crush)
    final.save(dest, optimize=True, compress_level=6)
    final.save(dest.with_name(dest.stem + "-clear.png"), optimize=True, compress_level=6)
    hist = final.getchannel("A").histogram()
    print(f"{dest.name}: {final.size} transparent={hist[0]} opaque={hist[255]} mid={sum(hist[1:255])}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for token, name in MAP.items():
        src = find_src(token)
        print(f"processing {src.name} -> {name}")
        remove_flat_bg(src, OUT / name)


if __name__ == "__main__":
    main()
