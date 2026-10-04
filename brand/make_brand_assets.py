#!/usr/bin/env python3
"""
Regenerates every logo-derived asset from brand/logo-source.jpg:

  1. src-tauri/icons/*        the app icon set (PNGs, icon.ico, icon.icns)
  2. index.html               the two embedded in-app logo masks (solid + shaded)

Run from the repo root:   python3 brand/make_brand_assets.py
Needs:                    pip install pillow numpy

The source is white artwork on a (near-)pure black background, so luminance is
the alpha: that is what lets one logo be drawn in any theme colour (see
architecture.md §A17). To use new artwork, replace logo-source.jpg and adjust
LOGO_BBOX (the pixel box that tightly contains the logo; print it with the
snippet in the comment below).

    # ys, xs = np.where(luminance > 25); print(xs.min(), ys.min(), xs.max()+1, ys.max()+1)
"""
import base64, io, os, re, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "brand", "logo-source.jpg")
ICONS = os.path.join(ROOT, "src-tauri", "icons")
INDEX = os.path.join(ROOT, "index.html")

LOGO_BBOX = (290, 258, 735, 613)   # x0, y0, x1, y1 in the 1024px source
MASK_PX = 176                      # in-app masks: displayed at <=96px, so ~2x for HiDPI

src = Image.open(SRC).convert("RGB")
lum = np.asarray(src).astype(float).mean(axis=2)
x0, y0, x1, y1 = LOGO_BBOX
cx, cy, w, h = (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0


def smoothstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- app icon set
S, plate = 1024, 824                      # Apple icon grid: 824px plate in a 1024px canvas
off, radius = (S - plate) // 2, int(plate * 0.2237)
grad = np.linspace(0, 1, plate)[:, None]
g = 12 + 10 * grad                        # near-black, slight vertical gradient
plate_img = Image.fromarray(np.dstack([np.repeat(g, plate, 1)] * 3).astype("uint8"), "RGB").convert("RGBA")
mask = Image.new("L", (plate * 4, plate * 4), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, plate * 4 - 1, plate * 4 - 1), radius * 4, fill=255)
mask = mask.resize((plate, plate), Image.LANCZOS)
plate_img.putalpha(mask)

side = int(max(w, h))
crop = src.crop((int(cx - side / 2), int(cy - side / 2), int(cx + side / 2), int(cy + side / 2)))
target = int(plate * 0.70 * side / w)
logo = crop.resize((target, target), Image.LANCZOS)
alpha = np.clip((np.asarray(logo).astype(float).mean(axis=2) - 3) / (240 - 3), 0, 1)
logo_img = Image.fromarray(np.dstack([np.asarray(logo), (alpha * 255).astype("uint8")]).astype("uint8"), "RGBA")

canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sm = Image.new("L", (S, S), 0)
sm.paste(mask, (off, off + 14))
shadow.putalpha(sm.point(lambda v: int(v * 0.45)))
canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(14)))
canvas.alpha_composite(plate_img, (off, off))
canvas.alpha_composite(logo_img, (S // 2 - target // 2, S // 2 - target // 2 + 4))

os.makedirs(ICONS, exist_ok=True)
sized = lambda n: canvas.resize((n, n), Image.LANCZOS)
sized(32).save(os.path.join(ICONS, "32x32.png"))
sized(128).save(os.path.join(ICONS, "128x128.png"))
sized(256).save(os.path.join(ICONS, "128x128@2x.png"))
sized(512).save(os.path.join(ICONS, "icon.png"))
canvas.save(os.path.join(ICONS, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
canvas.save(os.path.join(ICONS, "icon.icns"))
print("wrote app icon set to", os.path.relpath(ICONS, ROOT))

# ------------------------------------------------------- in-app theme-aware masks
side2 = int(max(w, h) * 1.10)
l = lum[int(cy - side2 / 2):int(cy + side2 / 2), int(cx - side2 / 2):int(cx + side2 / 2)]
variants = {
    "shaded": np.clip((l - 3) / (235 - 3), 0, 1),   # keeps the bevel; used on dark backgrounds
    "solid": smoothstep(l, 14, 64),                 # flat silhouette; used on light backgrounds
}
uris = {}
for name, a in variants.items():
    m = Image.fromarray((a * 255).astype("uint8"), "L").resize((MASK_PX, MASK_PX), Image.LANCZOS)
    la = Image.merge("LA", (Image.new("L", (MASK_PX, MASK_PX), 255), m))   # white + alpha; only alpha is used
    buf = io.BytesIO()
    la.save(buf, "PNG", optimize=True)
    uris[name] = base64.b64encode(buf.getvalue()).decode()

html = open(INDEX, encoding="utf-8").read()
for var, name in (("html.dark", "shaded"), (":root", "solid")):
    pat = re.compile(r"(%s \{[^}]*?--logo-mask: url\(data:image/png;base64,)[A-Za-z0-9+/=]+(\))" % re.escape(var), re.S)
    html, n = pat.subn(lambda m: m.group(1) + uris[name] + m.group(2), html)
    if n != 1:
        sys.exit(f"index.html: couldn't find the --logo-mask declaration under `{var}`")
open(INDEX, "w", encoding="utf-8").write(html)
print("updated the embedded logo masks in index.html")
