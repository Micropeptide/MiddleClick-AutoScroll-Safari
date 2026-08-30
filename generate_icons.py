"""Generates the app/extension icon: a blue gradient squircle with a white
compass glyph, matching the macOS-icon style used across the other tools on
runtian.uk/software (gradient background, single white glyph, no photo-real
shading). Outputs go to two places from one source of truth:

- extension/images/icon-*.png  (Safari toolbar/popup icon, also used on the
  website — these are flat, full-bleed squares; Safari and the webpage each
  apply their own corner treatment)
- .../Assets.xcassets/AppIcon.appiconset/mac-icon-*.png (the native macOS
  app/Dock icon — baked-in rounded-squircle mask, since Xcode does not
  re-derive these from the extension icons)
"""
from PIL import Image, ImageDraw
import math
import os

ROOT = os.path.dirname(__file__)
EXT_OUTDIR = os.path.join(ROOT, "extension", "images")
APPICON_DIR = os.path.join(
    ROOT,
    "Middle-Click AutoScroll",
    "Middle-Click AutoScroll",
    "Assets.xcassets",
    "AppIcon.appiconset",
)

# (filename, pixel size) for the macOS AppIcon slots, per Contents.json.
MAC_ICON_FILES = [
    ("mac-icon-16@1x.png", 16),
    ("mac-icon-16@2x.png", 32),
    ("mac-icon-32@1x.png", 32),
    ("mac-icon-32@2x.png", 64),
    ("mac-icon-128@1x.png", 128),
    ("mac-icon-128@2x.png", 256),
    ("mac-icon-256@1x.png", 256),
    ("mac-icon-256@2x.png", 512),
    ("mac-icon-512@1x.png", 512),
    ("mac-icon-512@2x.png", 1024),
]

EXT_SIZES = [16, 32, 48, 96, 128, 256, 512]

GRADIENT_TOP = (90, 170, 255, 255)    # lighter blue, light source from top
GRADIENT_BOTTOM = (6, 92, 210, 255)   # deeper blue
WHITE = (255, 255, 255, 255)
SQUIRCLE_RADIUS_RATIO = 0.2237  # Apple's approximate macOS icon corner ratio


def make_gradient_square(size, top, bottom):
    # Vectorized diagonal gradient (fast even at 1024px): blend factor is the
    # normalized position along the diagonal (x + y).
    import numpy as np

    t = (np.add.outer(np.arange(size), np.arange(size)).astype(np.float32)) / (2 * (size - 1))
    out = np.empty((size, size, 4), dtype=np.uint8)
    for i in range(4):
        out[..., i] = (top[i] + (bottom[i] - top[i]) * t).astype(np.uint8)
    return Image.fromarray(out, mode="RGBA")


def rounded_mask(size, radius_ratio):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    radius = size * radius_ratio
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def arrow_points(cx, cy, angle_deg, r):
    ang = math.radians(angle_deg)
    outer = r * 0.62
    inner = r * 0.30
    half = r * 0.16
    perp = ang + math.pi / 2
    tip = (cx + outer * math.cos(ang), cy + outer * math.sin(ang))
    b1 = (cx + inner * math.cos(ang) + half * math.cos(perp), cy + inner * math.sin(ang) + half * math.sin(perp))
    b2 = (cx + inner * math.cos(ang) - half * math.cos(perp), cy + inner * math.sin(ang) - half * math.sin(perp))
    return [tip, b1, b2]


def draw_glyph(draw, cx, cy, r, color):
    ring_w = r * 0.16
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=int(ring_w))
    for deg in (-90, 0, 90, 180):
        draw.polygon(arrow_points(cx, cy, deg, r * 0.86), fill=color)
    dot_r = r * 0.15
    draw.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=color)


def render(size, squircle):
    scale = 4  # supersample for crisp edges, then downsize
    s = size * scale
    bg = make_gradient_square(s, GRADIENT_TOP, GRADIENT_BOTTOM)

    if squircle:
        mask = rounded_mask(s, SQUIRCLE_RADIUS_RATIO)
        canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        canvas.paste(bg, (0, 0), mask)
    else:
        canvas = bg

    draw = ImageDraw.Draw(canvas)
    glyph_r = s * 0.30
    draw_glyph(draw, s / 2, s / 2, glyph_r, WHITE)

    return canvas.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(EXT_OUTDIR, exist_ok=True)
    for sz in EXT_SIZES:
        render(sz, squircle=True).save(os.path.join(EXT_OUTDIR, f"icon-{sz}.png"))
    print(f"Wrote {len(EXT_SIZES)} extension icons to {EXT_OUTDIR}")

    if os.path.isdir(APPICON_DIR):
        for filename, sz in MAC_ICON_FILES:
            render(sz, squircle=True).save(os.path.join(APPICON_DIR, filename))
        print(f"Wrote {len(MAC_ICON_FILES)} macOS app icons to {APPICON_DIR}")
    else:
        print(f"Skipped macOS app icons — {APPICON_DIR} not found")


if __name__ == "__main__":
    main()
