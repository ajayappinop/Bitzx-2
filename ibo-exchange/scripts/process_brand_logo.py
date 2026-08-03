"""Convert uploaded logo to transparent PNGs for dark/light UI + mark icon."""
from pathlib import Path
import shutil
import numpy as np
from PIL import Image

SRC = Path(
    r"C:\Users\Naushad\.cursor\projects\e-Bitzx-2\assets"
    r"\c__Users_Naushad_AppData_Roaming_Cursor_User_workspaceStorage_"
    r"b5749a437a046b7c8a9636dcc9cf2ed5_images_image-25277ac8-2bfb-435a-8644-f64ae7e063cf.png"
)
PUBLIC = Path(__file__).resolve().parents[1] / "public"


def trim(im: Image.Image, pad: int = 4) -> Image.Image:
    a = np.array(im)[:, :, 3]
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return im
    box = (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(im.width, int(xs.max()) + pad + 1),
        min(im.height, int(ys.max()) + pad + 1),
    )
    return im.crop(box)


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    if not SRC.exists():
        raise SystemExit(f"Source logo not found: {SRC}")

    img = Image.open(SRC).convert("RGBA")
    arr = np.array(img).astype(np.float32)
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = mx - mn

    # White/near-white background → transparent (soft edges)
    bg_hard = (luma >= 248) & (sat <= 12)
    bg_soft = (luma >= 230) & (sat <= 18) & ~bg_hard
    a_out = a.copy()
    a_out[bg_hard] = 0
    fade = np.clip((248 - luma) / 18.0, 0, 1)
    a_out[bg_soft] = a_out[bg_soft] * fade[bg_soft]

    # Dark text lines → white for dark UI
    is_black = (luma <= 55) & (sat <= 28) & (a_out > 8)
    r_d, g_d, b_d = r.copy(), g.copy(), b.copy()
    r_d[is_black] = 255
    g_d[is_black] = 255
    b_d[is_black] = 255
    near_black = (luma <= 90) & (sat <= 20) & (a_out > 8) & ~is_black
    t = np.clip((90 - luma[near_black]) / 90.0, 0, 1)
    r_d[near_black] = r_d[near_black] * (1 - t) + 255 * t
    g_d[near_black] = g_d[near_black] * (1 - t) + 255 * t
    b_d[near_black] = b_d[near_black] * (1 - t) + 255 * t

    dark = np.stack([r_d, g_d, b_d, a_out], axis=2).astype(np.uint8)
    light = np.stack([r, g, b, a_out], axis=2).astype(np.uint8)
    dark_img = trim(Image.fromarray(dark, "RGBA"))
    light_img = trim(Image.fromarray(light, "RGBA"))

    # Compact mark: left icon facet only
    alpha = dark[:, :, 3]
    ys, xs = np.where(alpha > 10)
    if len(xs):
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        h = max(1, y1 - y0 + 1)
        mark_w = int(h * 1.15)
        x_end = min(x1, x0 + mark_w)
        mark = Image.fromarray(dark, "RGBA").crop((x0, y0, x_end + 2, y1 + 1))
        side = max(mark.size) + 8
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(mark, ((side - mark.size[0]) // 2, (side - mark.size[1]) // 2), mark)
    else:
        canvas = dark_img.copy()

    out_dark = PUBLIC / "ibo-exchange-logo.png"
    out_light = PUBLIC / "ibo-exchange-logo-light.png"
    out_mark = PUBLIC / "ibo-logo.png"
    bak_dir = PUBLIC / "_bak_pre_transparent"
    bak_dir.mkdir(exist_ok=True)
    for p in (out_dark, out_mark):
        bak = bak_dir / p.name
        if p.exists() and not bak.exists():
            shutil.copy2(p, bak)

    dark_img.save(out_dark, "PNG", optimize=True)
    light_img.save(out_light, "PNG", optimize=True)
    canvas.save(out_mark, "PNG", optimize=True)

    for name, size in (
        ("favicon-32.png", 32),
        ("favicon-32x32.png", 32),
        ("favicon-48x48.png", 48),
        ("apple-touch-icon.png", 180),
    ):
        canvas.resize((size, size), Image.Resampling.LANCZOS).save(PUBLIC / name, "PNG", optimize=True)

    print(f"dark  {out_dark} {dark_img.size} {out_dark.stat().st_size}b")
    print(f"light {out_light} {light_img.size} {out_light.stat().st_size}b")
    print(f"mark  {out_mark} {canvas.size} {out_mark.stat().st_size}b")


if __name__ == "__main__":
    main()
