"""Process Instant KYC 3D icons: remove studio bg, HD transparent PNGs."""
from pathlib import Path
from collections import deque
from PIL import Image

ASSETS = Path(r"C:\Users\Naushad\.cursor\projects\e-IBO-Exchange\assets")
OUT = Path(r"e:\IBO-Exchange\ibo-exchange\public\hero")
OUT.mkdir(parents=True, exist_ok=True)

JOBS = [
    ("e53bc87d", "kyc-key.png", 640),
    ("83c1ab6a", "kyc-card.png", 640),
    ("4813d9e4", "kyc-wallet.png", 640),
    ("700898f6", "kyc-face.png", 720),
]


def process(token: str, name: str, max_side: int, tol: int = 5, peel: int = 8):
    src = list(ASSETS.glob(f"*{token}*"))[0]
    original = Image.open(src).convert("RGBA")
    bg = original.getpixel((2, 2))[:3]
    im = original.copy()
    w, h = im.size
    px = im.load()
    opx = original.load()

    def dist(c):
        return abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(c[2] - bg[2])

    def is_flat(c):
        return max(c[:3]) - min(c[:3]) <= 6

    def ok(c):
        return is_flat(c) and dist(c) <= tol

    visited = [[False] * h for _ in range(w)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if ok(px[x, y]):
                visited[x][y] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not visited[x][y] and ok(px[x, y]):
                visited[x][y] = True
                q.append((x, y))

    while q:
        x, y = q.popleft()
        r, g, b, _ = px[x, y]
        px[x, y] = (r, g, b, 0)
        for nx, ny in (
            (x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1),
            (x + 1, y + 1), (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1),
        ):
            if 0 <= nx < w and 0 <= ny < h and not visited[nx][ny] and ok(px[nx, ny]):
                visited[nx][ny] = True
                q.append((nx, ny))

    for _ in range(3):
        kill = []
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a == 0:
                    continue
                if not (is_flat((r, g, b)) and dist((r, g, b)) <= peel):
                    continue
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if not (0 <= nx < w and 0 <= ny < h) or px[nx, ny][3] == 0:
                        kill.append((x, y))
                        break
        for x, y in kill:
            r, g, b, _ = px[x, y]
            px[x, y] = (r, g, b, 0)

    for y in range(h):
        for x in range(w):
            if px[x, y][3] != 0:
                continue
            or_, og, ob, _ = opx[x, y]
            chroma = max(or_, og, ob) - min(or_, og, ob)
            if chroma >= 18 and max(or_, og, ob) >= 70:
                px[x, y] = (or_, og, ob, 255)

    bbox = im.getbbox()
    if bbox:
        pad = 10
        l, t, r, b = bbox
        im = im.crop((max(0, l - pad), max(0, t - pad), min(w, r + pad), min(h, b + pad)))

    im = im.resize((im.width * 2, im.height * 2), Image.Resampling.LANCZOS)
    if max(im.size) > max_side:
        im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

    dest = OUT / name
    im.save(dest, optimize=True)
    hist = im.getchannel("A").histogram()
    print(f"{name}: bg={bg} size={im.size} transparent={hist[0]} opaque={hist[255]}")


def main():
    for token, name, max_side in JOBS:
        process(token, name, max_side)


if __name__ == "__main__":
    main()
