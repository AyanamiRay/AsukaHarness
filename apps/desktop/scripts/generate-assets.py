#!/usr/bin/env python3
"""Generate the bundled artwork: app icon, tray icon and the built-in skins.

The script is deterministic (fixed RNG seeds) so re-running it does not churn
the repository with different bytes. It needs Pillow and NumPy:

    python3 scripts/generate-assets.py
"""

from __future__ import annotations

import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WALL_W, WALL_H = 1920, 1080
RNG = np.random.default_rng(20261025)


def vertical_gradient(colors: list[tuple[int, int, int]]) -> np.ndarray:
    stops = np.linspace(0.0, 1.0, len(colors))
    ys = np.linspace(0.0, 1.0, WALL_H)
    columns = np.zeros((WALL_H, 3), dtype=np.float32)
    for channel in range(3):
        columns[:, channel] = np.interp(ys, stops, [color[channel] for color in colors])
    return np.repeat(columns[:, None, :], WALL_W, axis=1)


def glow(arr: np.ndarray, cx: float, cy: float, rx: float, ry: float,
         color: tuple[int, int, int], strength: float = 1.0) -> np.ndarray:
    yy, xx = np.mgrid[0:WALL_H, 0:WALL_W]
    distance = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
    mask = np.exp(-distance * 2.0)[..., None]
    return np.clip(arr + mask * np.asarray(color, dtype=np.float32) * strength, 0, 255)


def grain(arr: np.ndarray, amount: float) -> np.ndarray:
    noise = RNG.normal(0.0, amount, (WALL_H, WALL_W, 1)).astype(np.float32)
    return np.clip(arr + noise, 0, 255)


def vignette(arr: np.ndarray, strength: float = 0.45) -> np.ndarray:
    yy, xx = np.mgrid[0:WALL_H, 0:WALL_W]
    nx = (xx - WALL_W / 2) / (WALL_W / 2)
    ny = (yy - WALL_H / 2) / (WALL_H / 2)
    falloff = np.clip(1.0 - strength * (nx**2 + ny**2) / 2.0, 0.0, 1.0)[..., None]
    return arr * falloff


def stars(arr: np.ndarray, count: int) -> np.ndarray:
    xs = RNG.integers(0, WALL_W, count)
    ys = RNG.integers(0, int(WALL_H * 0.85), count)
    brightness = RNG.uniform(90, 255, count)
    radius = RNG.integers(0, 2, count)
    for x, y, value, r in zip(xs, ys, brightness, radius):
        if r == 0:
            arr[y, x] = np.maximum(arr[y, x], value)
        else:
            arr[max(0, y - 1):y + 2, max(0, x - 1):x + 2] = np.maximum(
                arr[max(0, y - 1):y + 2, max(0, x - 1):x + 2], value * 0.6
            )
    return arr


def save(arr: np.ndarray, path: str, quality: int = 86) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGB")
    image.save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    print(f"  {os.path.relpath(path, ROOT)}  ({os.path.getsize(path) // 1024} KB)")


def make_aurora(path: str) -> None:
    arr = vertical_gradient([(4, 6, 14), (8, 22, 40), (10, 46, 62)])
    arr = glow(arr, 0.22 * WALL_W, 0.18 * WALL_H, 0.55 * WALL_W, 0.38 * WALL_H, (46, 120, 255), 0.55)
    arr = glow(arr, 0.78 * WALL_W, 0.30 * WALL_H, 0.45 * WALL_W, 0.30 * WALL_H, (45, 212, 191), 0.5)
    arr = glow(arr, 0.55 * WALL_W, 0.95 * WALL_H, 0.8 * WALL_W, 0.35 * WALL_H, (124, 92, 255), 0.35)
    arr = vignette(arr, 0.55)
    arr = grain(arr, 2.0)
    save(arr, path)


def make_midnight(path: str) -> None:
    arr = vertical_gradient([(2, 3, 8), (6, 9, 22), (10, 14, 32)])
    arr = glow(arr, 0.72 * WALL_W, 0.22 * WALL_H, 0.4 * WALL_W, 0.28 * WALL_H, (86, 74, 200), 0.32)
    arr = glow(arr, 0.25 * WALL_W, 0.72 * WALL_H, 0.35 * WALL_W, 0.25 * WALL_H, (28, 70, 140), 0.28)
    arr = stars(arr, 1400)
    arr = vignette(arr, 0.5)
    arr = grain(arr, 1.4)
    save(arr, path)


def make_paper(path: str) -> None:
    base = np.asarray((231, 220, 201), dtype=np.float32)
    arr = np.ones((WALL_H, WALL_W, 3), dtype=np.float32) * base
    yy, xx = np.mgrid[0:WALL_H, 0:WALL_W]
    folds = (
        9.0 * np.sin(xx / 380.0)
        + 6.0 * np.sin(yy / 240.0 + 1.7)
        + 5.0 * np.sin((xx + yy) / 780.0)
        + 3.0 * np.cos((xx - yy) / 1200.0)
    )[..., None]
    arr = np.clip(arr + folds, 0, 255)
    arr = glow(arr, 0.12 * WALL_W, 0.08 * WALL_H, 0.5 * WALL_W, 0.4 * WALL_H, (255, 250, 238), 0.30)
    arr = glow(arr, 0.88 * WALL_W, 0.92 * WALL_H, 0.5 * WALL_W, 0.4 * WALL_H, (150, 128, 96), 0.28)
    arr = vignette(arr, 0.30)
    arr = grain(arr, 3.2)
    save(arr, path, quality=90)


def make_forest(path: str) -> None:
    arr = vertical_gradient([(3, 10, 8), (6, 24, 18), (8, 40, 28)])
    arr = glow(arr, 0.30 * WALL_W, 0.35 * WALL_H, 0.5 * WALL_W, 0.35 * WALL_H, (34, 120, 84), 0.35)
    arr = glow(arr, 0.85 * WALL_W, 0.15 * WALL_H, 0.35 * WALL_W, 0.22 * WALL_H, (120, 200, 140), 0.22)
    for index, (y, alpha) in enumerate(((0.55, 0.35), (0.68, 0.45), (0.82, 0.55))):
        band = np.exp(-(((np.arange(WALL_H) / WALL_H) - y) ** 2) / 0.0035)[:, None, None]
        arr = np.clip(arr + band * alpha * np.asarray((120, 170, 150)), 0, 255)
    arr = vignette(arr, 0.5)
    arr = grain(arr, 2.2)
    save(arr, path)


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def make_icon(path: str, size: int = 512, glyph: bool = True) -> Image.Image:
    gradient = Image.new("RGB", (size, size))
    top, bottom = (124, 92, 255), (45, 212, 191)
    for y in range(size):
        ratio = y / (size - 1)
        color = tuple(int(top[i] * (1 - ratio) + bottom[i] * ratio) for i in range(3))
        ImageDraw.Draw(gradient).line([(0, y), (size, y)], fill=color)

    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    icon.paste(gradient, (0, 0), rounded_mask(size, int(size * 0.235)))

    if glyph:
        draw = ImageDraw.Draw(icon)
        stroke = max(2, size // 22)
        white = (255, 255, 255, 235)
        # ">" chevron
        draw.line(
            [(size * 0.30, size * 0.32), (size * 0.48, size * 0.50), (size * 0.30, size * 0.68)],
            fill=white,
            width=stroke,
            joint="curve",
        )
        # "_" prompt underline
        draw.line(
            [(size * 0.56, size * 0.68), (size * 0.74, size * 0.68)],
            fill=white,
            width=stroke,
        )

    icon.save(path, "PNG", optimize=True)
    print(f"  {os.path.relpath(path, ROOT)}  ({os.path.getsize(path) // 1024} KB)")
    return icon


def make_tray(path: str, size: int = 64) -> None:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    stroke = max(3, size // 9)
    white = (255, 255, 255, 255)
    shadow = (0, 0, 0, 120)
    points = [(size * 0.28, size * 0.30), (size * 0.50, size * 0.50), (size * 0.28, size * 0.70)]
    draw.line(points, fill=shadow, width=stroke + 2, joint="curve")
    draw.line(points, fill=white, width=stroke, joint="curve")
    draw.line([(size * 0.56, size * 0.70), (size * 0.76, size * 0.70)], fill=shadow, width=stroke + 2)
    draw.line([(size * 0.56, size * 0.70), (size * 0.76, size * 0.70)], fill=white, width=stroke)
    image.save(path, "PNG", optimize=True)
    print(f"  {os.path.relpath(path, ROOT)}  ({os.path.getsize(path) // 1024} KB)")


SKINS = [
    ("aurora", "极光", "深蓝到青绿的极光渐变，适合夜间长时间使用", "cover", 0.28, "#05070f", make_aurora),
    ("midnight", "午夜星空", "近乎黑色的底图与细碎星点，最不打扰阅读", "cover", 0.38, "#000000", make_midnight),
    ("paper", "纸感", "暖白纸张纹理，浅色壁纸搭配深色界面", "cover", 0.10, "#f6efe3", make_paper),
    ("forest", "雾林", "低饱和的墨绿与雾带，安静而克制", "cover", 0.34, "#04120c", make_forest),
]


def write_skin(skin_id: str, name: str, description: str, size: str, dim: float, tint: str) -> None:
    skin_dir = os.path.join(ROOT, "skins", skin_id)
    os.makedirs(skin_dir, exist_ok=True)
    manifest = {
        "name": name,
        "description": description,
        "image": "background.jpg",
        "size": size,
        "position": "center",
        "blur": 0,
        "dim": dim,
        "tint": tint,
        "transparentRoot": True,
    }
    with open(os.path.join(skin_dir, "skin.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main() -> None:
    print("icons:")
    make_icon(os.path.join(ROOT, "assets", "icon.png"))
    make_tray(os.path.join(ROOT, "assets", "tray.png"))

    print("skins:")
    for skin_id, name, description, size, dim, tint, painter in SKINS:
        write_skin(skin_id, name, description, size, dim, tint)
        painter(os.path.join(ROOT, "skins", skin_id, "background.jpg"))


if __name__ == "__main__":
    main()
