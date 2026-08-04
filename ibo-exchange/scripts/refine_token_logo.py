"""Flood-fill black bg, soft edge clean, crop, and upscale token logo."""
from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SRC = Path(
    r"C:\Users\Naushad\.cursor\projects\e-Bitzx-2\assets"
    r"\c__Users_Naushad_AppData_Roaming_Cursor_User_workspaceStorage_"
    r"b5749a437a046b7c8a9636dcc9cf2ed5_images_image-bae1b698-a71a-4ca9-9c59-ebbb5df0bf75.png"
)
DST = Path(__file__).resolve().parents[1] / "public" / "hero" / "ibo-token-3d.png"


def main() -> None:
    threshold = 32
    im = Image.open(SRC).convert("RGBA")
    w, h = im.size
    px = im.load()

    def is_bg(r: int, g: int, b: int, a: int) -> bool:
        if a < 8:
            return True
        return r <= threshold and g <= threshold and b <= threshold

    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def try_push(x: int, y: int) -> None:
        if x < 0 or y < 0 or x >= w or y >= h or visited[y][x]:
            return
        r, g, b, a = px[x, y]
        if is_bg(r, g, b, a):
            visited[y][x] = True
            q.append((x, y))

    for x in range(w):
        try_push(x, 0)
        try_push(x, h - 1)
    for y in range(h):
        try_push(0, y)
        try_push(w - 1, y)

    cleared = 0
    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        cleared += 1
        try_push(x + 1, y)
        try_push(x - 1, y)
        try_push(x, y + 1)
        try_push(x, y - 1)

    # Fade leftover near-black fringe only at the silhouette edge
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if r > 45 or g > 45 or b > 45:
                continue
            near_clear = False
            for dx, dy in (
                (1, 0), (-1, 0), (0, 1), (0, -1),
                (1, 1), (-1, -1), (1, -1), (-1, 1),
            ):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 0:
                    near_clear = True
                    break
            if not near_clear:
                continue
            lum = (r + g + b) / 3
            if lum <= 24:
                px[x, y] = (0, 0, 0, 0)
            elif lum <= 40:
                px[x, y] = (r, g, b, max(0, int(a * (lum - 24) / 16)))

    bbox = im.getbbox()
    if bbox:
        pad = 28
        l, t, r, b = bbox
        l = max(0, l - pad)
        t = max(0, t - pad)
        r = min(w, r + pad)
        b = min(h, b + pad)
        im = im.crop((l, t, r, b))

    # Soften transitional alpha only
    r_ch, g_ch, b_ch, a_ch = im.split()
    a_blur = a_ch.filter(ImageFilter.GaussianBlur(radius=0.6))
    a0 = np.array(a_ch, dtype=np.float32)
    a1 = np.array(a_blur, dtype=np.float32)
    a_out = a0.copy()
    band = (a0 > 5) & (a0 < 250)
    a_out[band] = a1[band] * 0.7 + a0[band] * 0.3
    a_img = Image.fromarray(np.clip(a_out, 0, 255).astype("uint8"), mode="L")
    im = Image.merge("RGBA", (r_ch, g_ch, b_ch, a_img))

    # Higher-res for larger hero display
    im = im.resize((im.width * 2, im.height * 2), Image.Resampling.LANCZOS)
    DST.parent.mkdir(parents=True, exist_ok=True)
    im.save(DST, "PNG", optimize=True)
    print(f"cleared={cleared} size={im.size} corner={im.getpixel((0, 0))} -> {DST}")


if __name__ == "__main__":
    main()
