# -*- coding: utf-8 -*-
import io, sys
P = r"E:\AIGC\html\sakura\src\app_part1.js"
s = io.open(P, encoding="utf-8").read()

def rep(old, new, tag):
    global s
    if old not in s:
        print("MISS:", tag); sys.exit(1)
    s = s.replace(old, new, 1); print("ok:", tag)

# 1) 顶面边缘轮廓与侧壁用同一套起伏，消除接缝"嘴唇"
rep("""        // 边缘轻微不规则
        const edge = 1 + 0.018 * fbm(Math.cos(th) * 2.2, 0.7, Math.sin(th) * 2.2, 2);""",
    """        // 边缘轮廓（与侧壁同一套起伏，避免接缝错开）
        const edge = 1 + 0.018 * fbm(Math.cos(th) * 2.2, 0.7, Math.sin(th) * 2.2, 2)
                       + 0.038 * Math.sin(th * 7.0 + 1.3)
                       + 0.023 * Math.sin(th * 13.0 + 0.7);""",
    "top-edge-match")

# 2) 顶面露土减弱，避免深色圈
rep("cTmp.lerp(new T.Color(0.34, 0.25, 0.15), smoothstep(0.90, 1.0, t) * 0.60);",
    "cTmp.lerp(new T.Color(0.35, 0.27, 0.17), smoothstep(0.93, 1.0, t) * 0.38);",
    "top-soil-soft")

# 3) 侧壁最上层土色提亮
rep("cTmp.setRGB(0.20, 0.33, 0.13).lerp(new T.Color(0.28, 0.21, 0.12), t / 0.13);",
    "cTmp.setRGB(0.24, 0.36, 0.15).lerp(new T.Color(0.33, 0.25, 0.14), t / 0.13);",
    "side-top-color")

# 4) 接地阴影收小收淡，别把海面压浑
rep("""    const grd = g2.createRadialGradient(S / 2, S / 2, S * 0.16, S / 2, S / 2, S * 0.50);
    grd.addColorStop(0.00, 'rgba(22,26,24,0.58)');
    grd.addColorStop(0.50, 'rgba(22,26,24,0.30)');
    grd.addColorStop(1.00, 'rgba(22,26,24,0.00)');""",
    """    const grd = g2.createRadialGradient(S / 2, S / 2, S * 0.22, S / 2, S / 2, S * 0.50);
    grd.addColorStop(0.00, 'rgba(26,30,28,0.40)');
    grd.addColorStop(0.55, 'rgba(26,30,28,0.16)');
    grd.addColorStop(1.00, 'rgba(26,30,28,0.00)');""",
    "shadow-soft")
rep("const size = WORLD.islandR * 2.9;", "const size = WORLD.islandR * 2.15;", "shadow-size")

# 5) 岸边落花：收紧、提亮
rep("""    const N = 1600;
    const geo = makeSeaPetalGeo();
    const mat = new T.MeshStandardMaterial({
      color: 0xffd9e7,""",
    """    const N = 1200;
    const geo = makeSeaPetalGeo();
    const mat = new T.MeshStandardMaterial({
      color: 0xffe2ee,""",
    "shore-n-color")
rep("      emissiveIntensity: 0.10,", "      emissiveIntensity: 0.24,", "shore-emissive")
rep("const rr = WORLD.islandR * 1.01 + Math.pow(R(), 1.75) * 1.55;",
    "const rr = WORLD.islandR * 1.01 + Math.pow(R(), 1.85) * 1.05;", "shore-radius")

io.open(P, "w", encoding="utf-8", newline="\n").write(s)
print("written")
