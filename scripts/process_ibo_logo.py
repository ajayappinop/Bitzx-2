"""Punch square backdrop outside the IBO circular logo to full transparency."""
from __future__ import annotations

import math
import os
from PIL import Image, ImageDraw, ImageFilter

SRC = r"e:\IBO-Exchange\frontend\public\ibo-logo.png"  # already partially processed

DESTS = [
    r"e:\IBO-Exchange\frontend\public\ibo-logo.png",
    r"e:\IBO-Exchange\ibo-exchange\public\ibo-logo.png",
    r"e:\IBO-Exchange\ibo-admin\public\ibo-logo.png",
    r"e:\IBO-Exchange\backend\assets\ibo_token_logo.png",
    r"e:\IBO-Exchange\ibo-mobile-app\src\assets\ibo-logo.png",
    r"e:\IBO-Exchange\ibo-mobile-app\src\assets\Ibo_Logo-removebg.png",
]


def main() -> None:
    # Prefer original upload if available (cleaner white bg detection)
    original = (
        r"C:\Users\Naushad\.cursor\projects\e-IBO-Exchange\assets"
        r"\c__Users_Naushad_AppData_Roaming_Cursor_User_workspaceStorage_"
        r"ed72962af47ac315556ab5a23fe88969_images_image-331b9d8e-97ab-44da-b1bf-8019d6ea7618.png"
    )
    path = original if os.path.exists(original) else SRC
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    cx, cy = (w - 1) / 2.0, (h - 1) / 2.0

    # Find circle radius from opaque/non-white content density along diagonals
    pixels = img.load()

    def is_bg(r, g, b, a=255):
        if a < 10:
            return True
        brightness = (r + g + b) / 3.0
        chroma = max(r, g, b) - min(r, g, b)
        # white / near-white square
        if brightness >= 220 and chroma < 30:
            return True
        # pure black leftover canvas
        if brightness <= 8 and chroma < 8:
            return True
        return False

    # Estimate radius: farthest non-bg pixel from center
    max_r = 0.0
    step = max(1, min(w, h) // 400)
    for y in range(0, h, step):
        for x in range(0, w, step):
            r, g, b, a = pixels[x, y]
            if not is_bg(r, g, b, a):
                dist = math.hypot(x - cx, y - cy)
                if dist > max_r:
                    max_r = dist
    radius = max_r * 1.01 if max_r > 0 else min(w, h) * 0.48
    print(f"size={w}x{h} radius={radius:.1f}")

    # Circular soft mask
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    # slight inset so fringe white is gone
    r_inner = radius - 1.5
    draw.ellipse(
        (cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner),
        fill=255,
    )
    mask = mask.filter(ImageFilter.GaussianBlur(radius=1.2))

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out_px = out.load()
    mask_px = mask.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            m = mask_px[x, y]
            if m <= 0 or is_bg(r, g, b, a):
                continue
            # combine original alpha with circular mask
            alpha = int(a * (m / 255.0))
            if alpha < 8:
                continue
            out_px[x, y] = (r, g, b, alpha)

    bbox = out.getbbox()
    if bbox:
        pad = 6
        left, top, right, bottom = bbox
        left = max(0, left - pad)
        top = max(0, top - pad)
        right = min(w, right + pad)
        bottom = min(h, bottom + pad)
        out = out.crop((left, top, right, bottom))

    ow, oh = out.size
    side = max(ow, oh)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(out, ((side - ow) // 2, (side - oh) // 2), out)
    if max(square.size) > 1024:
        square.thumbnail((1024, 1024), Image.Resampling.LANCZOS)

    # Verify corner transparency
    sp = square.load()
    sw, sh = square.size
    corners = [sp[0, 0], sp[sw - 1, 0], sp[0, sh - 1], sp[sw - 1, sh - 1]]
    print("corner alphas", [c[3] for c in corners])

    for dest in DESTS:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        square.save(dest, "PNG")
        print("wrote", dest, square.size)


if __name__ == "__main__":
    main()
