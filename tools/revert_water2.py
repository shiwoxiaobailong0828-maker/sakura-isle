# -*- coding: utf-8 -*-
import io
p = r"E:\AIGC\html\sakura\src\app_part1.js"
s = io.open(p, encoding="utf-8").read()

start_mark = "          // —— 用真实浪高梯度算水面法线"
end_mark = "          // 岛周围堆一层厚厚的花瓣（岸线）"
i = s.index(start_mark)
j = s.index(end_mark)

old = """          // 掠射角泛起天光
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
          col = mix(col, uSky * 0.80, fres * 0.26);

          // 花瓣反光的碎亮光
          vec3 Hv = normalize(normalize(uSunDir) + V);
          float glint = pow(clamp(dot(Hv, vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 48.0);
          col += uSun * glint * (0.20 + petals * 0.40) * 0.34;

"""
s = s[:i] + old + s[j:]
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("reverted ok; has old block:", "掠射角泛起天光" in s, "| has new block:", "用真实浪高梯度" in s)
