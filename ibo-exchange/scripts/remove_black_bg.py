"""Flood-fill remove near-black backgrounds from PNG assets (preserve dark subjects)."""
from __future__ import annotations

import os
from collections import deque
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public')

FILES = [
    'ibo-exchange-logo.png',
    'ibo-logo.png',
    'hero/ibo-exchange-logo.png',
    'hero/icon-shield.png',
    'hero/icon-shield-clear.png',
    'hero/icon-coin.png',
    'hero/icon-coin-clear.png',
    'hero/icon-cards.png',
    'hero/icon-cards-clear.png',
    'hero/feature-security.png',
    'hero/feature-charts.png',
    'hero/feature-portfolio.png',
    'hero/feature-speed.png',
    'hero/platform-cubes.png',
    'hero/platform-coin-machine.png',
    'hero/platform-dollar-medal.png',
    'hero/ibo-token-3d.png',
    'hero/why-vault-safe.png',
    'hero/why-btc-coins.png',
    'hero/why-crypto-cubes.png',
    'hero/why-secure-wallet.png',
    'hero/why-shield.png',
    'hero/deposit-shield.png',
    'hero/deposit-wallet.png',
    'hero/deposit-search.png',
    'hero/deposit-coin.png',
    'hero/kyc-key.png',
    'hero/kyc-card.png',
    'hero/kyc-face.png',
    'hero/kyc-wallet.png',
]


def is_bg(r: int, g: int, b: int, a: int, threshold: int) -> bool:
    if a < 8:
        return True
    return r <= threshold and g <= threshold and b <= threshold


def remove_black_bg(path: str, threshold: int = 28) -> tuple[int, int]:
    img = Image.open(path).convert('RGBA')
    w, h = img.size
    px = img.load()

    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def try_push(x: int, y: int) -> None:
        if x < 0 or y < 0 or x >= w or y >= h or visited[y][x]:
            return
        r, g, b, a = px[x, y]
        if is_bg(r, g, b, a, threshold):
            visited[y][x] = True
            q.append((x, y))

    for x in range(w):
        try_push(x, 0)
        try_push(x, h - 1)
    for y in range(h):
        try_push(0, y)
        try_push(w - 1, y)

    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        try_push(x + 1, y)
        try_push(x - 1, y)
        try_push(x, y + 1)
        try_push(x, y - 1)

    # Soften dark fringe next to transparency
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if r <= 45 and g <= 45 and b <= 45:
                near_t = False
                for nx, ny in (
                    (x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1),
                    (x + 1, y + 1), (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1),
                ):
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 0:
                        near_t = True
                        break
                if near_t:
                    darkness = (r + g + b) / 3.0
                    new_a = max(0, min(a, int(a * (darkness / 45.0))))
                    px[x, y] = (r, g, b, new_a)

    bbox = img.getbbox()
    if bbox:
        pad = 2
        l, t, r2, b2 = bbox
        l = max(0, l - pad)
        t = max(0, t - pad)
        r2 = min(w, r2 + pad)
        b2 = min(h, b2 + pad)
        img = img.crop((l, t, r2, b2))

    img.save(path, 'PNG', optimize=True)
    return img.size


def main() -> None:
    done = 0
    for rel in FILES:
        path = os.path.normpath(os.path.join(ROOT, rel))
        if not os.path.exists(path):
            print(f'MISS {rel}')
            continue
        thr = 34 if 'logo' in rel else 26
        size = remove_black_bg(path, thr)
        print(f'OK {rel} -> {size}')
        done += 1
    print(f'Done {done}/{len(FILES)}')


if __name__ == '__main__':
    main()
