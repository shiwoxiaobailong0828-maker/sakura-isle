"""
程序化贴图生成（Blender 5.x + numpy）
产出：
  bark_albedo.png  1024  树皮漫反射
  bark_normal.png  1024  树皮法线
  bark_ao.png      1024  树皮 AO
  bark_rough.png   1024  树皮粗糙度
  sunset_hdri.jpg  2048x1024  黄昏全景环境贴图
用法： blender --background --python gen_textures.py -- <outdir>
"""
import bpy
import numpy as np
import math
import sys
import os

argv = sys.argv
argv = argv[argv.index("--") + 1:] if "--" in argv else []
OUT = argv[0] if len(argv) > 0 else "E:/AIGC/html/sakura/textures"
os.makedirs(OUT, exist_ok=True)

# ---------------- 工具：无缝值噪声 ----------------
def value_noise(H, W, gx, gy, seed=0):
    """周期值噪声（无缝平铺），gx/gy 为网格数"""
    rng = np.random.default_rng(seed)
    grid = rng.random((gy, gx)).astype(np.float32)
    ys = np.linspace(0, gy, H, endpoint=False, dtype=np.float32)
    xs = np.linspace(0, gx, W, endpoint=False, dtype=np.float32)
    y0 = ys.astype(np.int32); x0 = xs.astype(np.int32)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    # smooth
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    g00 = grid[np.ix_(y0 % gy, x0 % gx)]
    g10 = grid[np.ix_(y0 % gy, (x0 + 1) % gx)]
    g01 = grid[np.ix_((y0 + 1) % gy, x0 % gx)]
    g11 = grid[np.ix_((y0 + 1) % gy, (x0 + 1) % gx)]
    a = g00 * (1 - fx) + g10 * fx
    b = g01 * (1 - fx) + g11 * fx
    return (a * (1 - fy) + b * fy).astype(np.float32)


def fbm(H, W, base, oct=4, seed=0):
    s = np.zeros((H, W), np.float32)
    amp = 0.5; f = base
    for o in range(oct):
        s += value_noise(H, W, max(2, int(f)), max(2, int(f * 1.0)), seed + o) * amp
        amp *= 0.5; f *= 2
    return s


# ---------------- 1. 树皮 ----------------
def gen_bark(W=1024, H=1024):
    """樱花树皮：灰褐偏红底 + 横向皮孔细线 + 轻微竖向裂纹 + 剥落斑块"""
    xs = np.linspace(0, 1, W, endpoint=False, dtype=np.float32)
    ys = np.linspace(0, 1, H, endpoint=False, dtype=np.float32)
    X = xs[None, :]; Y = ys[:, None]

    # 底：低频大块起伏（树皮整体凹凸，缓慢）
    broad = fbm(H, W, 3, 3, 11)
    # 大块斑驳（明暗不匀，打破规则感）
    mottle = fbm(H, W, 5, 4, 71)

    # 横向皮孔线：稀疏断续的短横线（樱花树皮标志）
    wob = (fbm(H, W, 3, 3, 21) - 0.5) * 1.1
    lines1 = np.sin((Y * 21.0 + wob * 2.2) * 2 * math.pi)
    lines2 = np.sin((Y * 49.0 + wob * 3.4) * 2 * math.pi + 1.7)
    # 门控：只有部分横向区域出现皮孔，且断续
    gate_a = np.clip((value_noise(H, W, 9, 2, 55) - 0.40) * 2.2, 0, 1)
    gate_b = np.clip((value_noise(H, W, 34, 4, 57) - 0.45) * 2.6, 0, 1)
    lenticel = ((0.5 + 0.5 * lines1) * 0.75 + (0.5 + 0.5 * lines2) * 0.25)
    lenticel = lenticel * gate_a * (0.35 + 0.65 * gate_b)

    # 竖向细裂纹（稀疏、短）
    vcrack_n = fbm(H, W, 8, 3, 31)
    vcrack = np.clip((vcrack_n - 0.66) * 3.4, 0, 1)
    # 剥落斑块（低频）
    peel = np.clip((fbm(H, W, 4, 3, 41) - 0.58) * 3.0, 0, 1)

    height = 0.42 * broad + 0.22 * mottle + 0.60 * lenticel - 0.26 * vcrack - 0.14 * peel
    height = (height - height.min()) / (height.max() - height.min() + 1e-6)

    # ---- Albedo：暖灰褐，皮孔略深，剥落处偏浅灰 ----
    base = np.array([0.300, 0.225, 0.190], np.float32)    # 暖灰褐
    light = np.array([0.430, 0.345, 0.300], np.float32)   # 受光浅色
    dark = np.array([0.150, 0.115, 0.105], np.float32)    # 皮孔/裂纹深色
    t = (0.65 * broad + 0.35 * mottle)[:, :, None]
    alb = base[None, None, :] * (1 - t) + light[None, None, :] * t
    # 皮孔加深
    alb = alb * (1 - lenticel[:, :, None] * 0.45)
    # 裂纹更深
    alb = alb * (1 - vcrack[:, :, None] * 0.55) + dark[None, None, :] * (vcrack[:, :, None] * 0.55)
    # 剥落处偏灰白
    peel_col = np.array([0.52, 0.47, 0.42], np.float32)
    alb = alb * (1 - peel[:, :, None] * 0.45) + peel_col[None, None, :] * (peel[:, :, None] * 0.45)
    # 极细颗粒
    grain = (np.random.default_rng(7).random((H, W, 1)).astype(np.float32) - 0.5) * 0.035
    alb = np.clip(alb + grain, 0, 1)

    # ---- Normal：从高度场求梯度 ----
    dx = np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)
    dy = np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)
    strength = 5.0
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(nx)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx /= ln; ny /= ln; nz /= ln
    normal = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5], axis=2)

    # ---- AO：皮孔与裂纹凹陷更暗 ----
    ao = 0.50 + 0.50 * np.clip(height, 0, 1)
    ao *= (1.0 - vcrack * 0.40) * (1.0 - lenticel * 0.10)
    ao = np.clip(ao, 0, 1)

    # ---- Roughness：凹凸起伏 ----
    rough = 0.70 + 0.22 * (1.0 - height) + vcrack * 0.10
    rough = np.clip(rough, 0, 1)

    return alb, normal, np.repeat(ao[:, :, None], 3, 2), np.repeat(rough[:, :, None], 3, 2)


def save_img(name, arr, path, is_jpg=False, flip=True):
    H, W = arr.shape[:2]
    img = bpy.data.images.new(name, width=W, height=H, alpha=False)
    rgba = np.ones((H, W, 4), np.float32)
    rgba[:, :, :3] = arr
    if flip:
        # Blender 像素是 bottom-up，图像数组是 top-down
        rgba = np.flipud(rgba)
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = 'JPEG' if is_jpg else 'PNG'
    if is_jpg:
        img.filepath_raw = path
        img.save()
    else:
        img.filepath_raw = path
        img.save()
    print("saved", path)


# ---------------- 2. 黄昏 HDRI ----------------
def gen_hdri(W=2048, H=1024):
    u = np.linspace(0, 1, W, endpoint=False, dtype=np.float32)
    # 第 0 行 = 天顶（图像顶端 = 天顶），最后一行 = 天底
    v = np.linspace(1.0, 0.0, H, dtype=np.float32)
    U = u[None, :]; Vv = v[:, None]
    el = Vv  # 0 天底 .. 1 天顶

    # 天空渐变：地平线暖橙 → 高空紫蓝
    horizon = np.array([1.00, 0.52, 0.20], np.float32)
    mid = np.array([0.78, 0.42, 0.36], np.float32)
    zenith = np.array([0.16, 0.20, 0.40], np.float32)
    t1 = np.clip(el / 0.35, 0, 1)[:, :, None]
    t2 = np.clip((el - 0.30) / 0.55, 0, 1)[:, :, None]
    sky = horizon[None, None, :] * (1 - t1) + mid[None, None, :] * t1
    sky = sky * (1 - t2) + zenith[None, None, :] * t2

    # 太阳（固定方位，略高于地平线）
    sun_az = 0.62          # 弧度方位
    sun_el = 0.16          # 归一化高度
    daz = np.abs(((U - sun_az / (2 * math.pi)) + 0.5) % 1.0 - 0.5) * 2 * math.pi  # 0..pi
    del_ = np.abs(Vv - sun_el)
    dist = np.sqrt((daz * 0.55) ** 2 + (del_ * 2.2) ** 2)
    sun = np.exp(-(dist ** 2) * 900.0)
    halo = np.exp(-dist * 9.0) * 0.55
    sun_col = np.array([1.0, 0.86, 0.62], np.float32)
    sky = sky + sun_col[None, None, :] * (sun * 3.4 + halo)[:, :, None]

    # 云：靠近地平线的带状云
    cn = fbm(H, W, 5, 4, 77)
    band = np.exp(-((Vv - 0.42) ** 2) / 0.03)          # 云带高度
    cn2 = np.clip((cn - 0.48) * 2.6, 0, 1)
    clouds = cn2 * band
    cloud_col = np.array([0.92, 0.55, 0.42], np.float32)      # 受夕照染色
    cloud_dark = np.array([0.42, 0.32, 0.38], np.float32)
    cc = cloud_col[None, None, :] * clouds[:, :, None] * (0.6 + 0.6 * Vv[:, :, None])
    cc += cloud_dark[None, None, :] * (clouds[:, :, None] * (1 - Vv[:, :, None]) * 0.5)
    sky = sky * (1 - clouds[:, :, None] * 0.72) + cc * 0.9

    # 地面以下压暗
    below = np.clip((0.06 - Vv) / 0.06, 0, 1)[:, :, None]
    sky = sky * (1 - below * 0.65)

    return np.clip(sky, 0, 1)


# ---------------- 执行 ----------------
alb, nor, ao, rough = gen_bark()
save_img("bark_albedo", alb, os.path.join(OUT, "bark_albedo.png"))
save_img("bark_normal", nor, os.path.join(OUT, "bark_normal.png"))
save_img("bark_ao", ao, os.path.join(OUT, "bark_ao.png"))
save_img("bark_rough", rough, os.path.join(OUT, "bark_rough.png"))

hdri = gen_hdri()
save_img("sunset_hdri", hdri, os.path.join(OUT, "sunset_hdri.jpg"), is_jpg=True, flip=False)
print("ALL DONE")
