"""Enhance all landing 3D icon PNGs: upscale, unsharp, color polish, clean alpha."""
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

HERO = Path(r"e:\IBO-Exchange\ibo-exchange\public\hero")

# target max side for retina display sizes used in UI
TARGETS = {
    "icon-shield.png": 1024,
    "icon-cards.png": 1024,
    "icon-coin.png": 1024,
    "kyc-key.png": 900,
    "kyc-card.png": 900,
    "kyc-wallet.png": 900,
    "kyc-face.png": 1024,
    "platform-cubes.png": 1100,
    "ibo-token-3d.png": 1100,
}


def enhance(path: Path, max_side: int):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    scale = max_side / max(w, h)
    if scale > 1.01:
        nw, nh = int(round(w * scale)), int(round(h * scale))
        im = im.resize((nw, nh), Image.Resampling.LANCZOS)

    rgb = im.convert("RGB")
    alpha = im.getchannel("A")

    # Mild polish — keep dark matte bodies readable on black UI
    rgb = ImageEnhance.Contrast(rgb).enhance(1.08)
    rgb = ImageEnhance.Color(rgb).enhance(1.12)
    rgb = ImageEnhance.Brightness(rgb).enhance(1.04)
    rgb = rgb.filter(ImageFilter.UnsharpMask(radius=1.4, percent=115, threshold=2))

    out = rgb.copy()
    # Soften alpha jaggies slightly then harden interior
    a = alpha.filter(ImageFilter.GaussianBlur(radius=0.35))
    a_arr = np.array(a).astype(np.float32)
    # harden: push mid-alphas toward 0 or 255 around edges for cleaner silhouette
    a_arr = np.where(a_arr < 18, 0, a_arr)
    a_arr = np.where(a_arr > 236, 255, a_arr)
    out.putalpha(Image.fromarray(a_arr.astype(np.uint8)))

    # Zero RGB under clear pixels (no fringe bleed when scaled by browser)
    arr = np.array(out)
    arr[arr[:, :, 3] < 12, :3] = 0
    out = Image.fromarray(arr, "RGBA")

    out.save(path, optimize=True, compress_level=6)
    hist = out.getchannel("A").histogram()
    print(
        f"{path.name}: {im.size[0]}x{im.size[1]} -> {out.size} "
        f"t={hist[0]} o={hist[255]} mid={sum(hist[1:255])}"
    )


def main():
    for name, max_side in TARGETS.items():
        path = HERO / name
        if not path.exists():
            print(f"skip missing {name}")
            continue
        enhance(path, max_side)


if __name__ == "__main__":
    main()
