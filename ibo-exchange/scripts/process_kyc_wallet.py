"""Cut out kyc-wallet.png: dark leather on studio gray (31,31,31).

Do not aggressively peel — leather shadows sit near studio gray.
Hybrid:
  1) clear exact studio gray (incl. holes between bills)
  2) flood only AA fringe gray 30–32 from edges
  3) rembg drops contact shadow only (never confident body/gold)
"""
from pathlib import Path
from collections import deque

import numpy as np
from PIL import Image, ImageFilter
from rembg import remove
from scipy import ndimage

ASSETS = Path(r"C:\Users\Naushad\.cursor\projects\e-IBO-Exchange\assets")
OUT = Path(r"e:\IBO-Exchange\ibo-exchange\public\hero")
TOKEN = "4813d9e4"
DEST = OUT / "kyc-wallet.png"
BG = 31
MAX_SIDE = 640


def process():
    src = list(ASSETS.glob(f"*{TOKEN}*"))[0]
    original = Image.open(src).convert("RGBA")
    arr = np.array(original)
    rgb = arr[:, :, :3].astype(np.int16)
    h, w, _ = rgb.shape
    chroma = rgb.max(2) - rgb.min(2)
    gray = rgb.mean(2)
    flat = chroma <= 5
    exact = (
        (rgb[:, :, 0] == BG) & (rgb[:, :, 1] == BG) & (rgb[:, :, 2] == BG)
    )

    keep = ~exact

    ok = flat & (gray >= 30) & (gray <= 32)
    visited = np.zeros((h, w), dtype=bool)
    q = deque()
    for y, x in zip(*np.where(exact)):
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if (
                0 <= nx < w
                and 0 <= ny < h
                and keep[ny, nx]
                and ok[ny, nx]
                and not visited[ny, nx]
            ):
                visited[ny, nx] = True
                q.append((nx, ny))
    for x in range(w):
        for y in (0, h - 1):
            if keep[y, x] and ok[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if keep[y, x] and ok[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((x, y))
    while q:
        x, y = q.popleft()
        keep[y, x] = False
        for nx, ny in (
            (x + 1, y),
            (x - 1, y),
            (x, y + 1),
            (x, y - 1),
            (x + 1, y + 1),
            (x - 1, y - 1),
            (x + 1, y - 1),
            (x - 1, y + 1),
        ):
            if (
                0 <= nx < w
                and 0 <= ny < h
                and keep[ny, nx]
                and ok[ny, nx]
                and not visited[ny, nx]
            ):
                visited[ny, nx] = True
                q.append((nx, ny))

    ra = np.array(remove(original))[:, :, 3]
    confident = (flat & (gray >= 37)) | ((chroma >= 14) & (rgb.max(2) >= 60))
    shadow = keep & (ra < 50) & (~confident) & flat & (gray <= 36)
    keep[shadow] = False

    keep |= (chroma >= 18) & (rgb.max(2) >= 70)
    keep &= ~exact
    keep = ndimage.binary_closing(keep, structure=np.ones((3, 3)), iterations=1)
    keep &= ~exact

    dist_in = ndimage.distance_transform_edt(keep)
    dist_out = ndimage.distance_transform_edt(~keep)
    alpha = np.zeros((h, w), dtype=np.float32)
    alpha[keep] = np.clip(dist_in[keep] / 1.0, 0, 1)
    edge = (~keep) & (dist_out <= 1.0)
    alpha[edge] = np.clip(1.0 - dist_out[edge] / 1.0, 0, 1)
    alpha[dist_in >= 1.0] = 1.0

    out = np.zeros_like(arr)
    out[:, :, :3] = arr[:, :, :3]
    out[:, :, 3] = (alpha * 255).astype(np.uint8)
    out[alpha < 0.02, :3] = 0

    img = Image.fromarray(out, "RGBA")
    bbox = img.getbbox()
    if bbox:
        pad = 8
        l, t, r, b = bbox
        img = img.crop(
            (max(0, l - pad), max(0, t - pad), min(img.width, r + pad), min(img.height, b + pad))
        )

    img = img.resize((img.width * 2, img.height * 2), Image.Resampling.LANCZOS)
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)

    rgb_i = np.array(
        img.convert("RGB").filter(ImageFilter.UnsharpMask(radius=1.0, percent=90, threshold=2))
    )
    a_i = np.array(img.getchannel("A"))
    rgb_i[a_i < 8] = 0
    img = Image.fromarray(rgb_i, "RGB")
    img.putalpha(Image.fromarray(a_i))

    OUT.mkdir(parents=True, exist_ok=True)
    img.save(DEST, optimize=True, compress_level=6)
    hist = img.getchannel("A").histogram()
    print(
        f"{DEST.name}: {img.size} transparent={hist[0]} "
        f"opaque={hist[255]} mid={sum(hist[1:255])}"
    )


if __name__ == "__main__":
    process()
