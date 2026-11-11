# -*- coding: utf-8 -*-
import io
p = r"E:\AIGC\html\sakura\src\app_part1.js"
s = io.open(p, encoding="utf-8").read()
orig = s

# 1) 数量大幅减少：9000 → 2800
s = s.replace("  function buildSeaPetals() {\n    const N = 9000;",
              "  function buildSeaPetals() {\n    const N = 2800;", 1)

# 2) 分布更外扩、更疏（原来贴着岛堆一圈）
s = s.replace("      const rr = 3.1 + Math.pow(R(), 0.90) * 40.0;",
              "      const rr = 5.2 + Math.pow(R(), 1.35) * 38.0;", 1)

# 3) 单瓣变小一点，别像纸片
s = s.replace("      const s = 1.6 + R() * 2.2;",
              "      const s = 1.15 + R() * 1.45;", 1)

# 4) 水面着色器：颗粒噪声减弱，别像碎纸屑
s = s.replace("          float petals = pn1 * 0.44 + pn2 * 0.28 + pn3 * 0.18 + pn4 * 0.10;",
              "          float petals = pn1 * 0.52 + pn2 * 0.26 + pn3 * 0.14 + pn4 * 0.08;", 1)
s = s.replace("          col *= 0.76 + petals * 0.50;",
              "          col *= 0.88 + petals * 0.26;", 1)
s = s.replace("          col = mix(col, uDeep * 1.18, smoothstep(0.45, 0.92, pn1) * 0.22);",
              "          col = mix(col, uDeep * 1.14, smoothstep(0.50, 0.95, pn1) * 0.15);", 1)
s = s.replace("          float foam = smoothstep(0.60, 0.94, hh) * smoothstep(0.38, 0.86, petals);",
              "          float foam = smoothstep(0.68, 0.96, hh) * smoothstep(0.52, 0.92, petals);", 1)
s = s.replace("          col = mix(col, vec3(1.0, 0.972, 0.982), foam * 0.78);",
              "          col = mix(col, vec3(1.0, 0.972, 0.982), foam * 0.55);", 1)

assert s != orig
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("sea petals thinned")
