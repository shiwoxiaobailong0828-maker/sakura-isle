# -*- coding: utf-8 -*-
import io
p = r"E:\AIGC\html\sakura\src\app_part1.js"
s = io.open(p, encoding="utf-8").read()
orig = s

old = """          // 掠射角泛起天光
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
          col = mix(col, uSky * 0.80, fres * 0.26);

          // 花瓣反光的碎亮光
          vec3 Hv = normalize(normalize(uSunDir) + V);
          float glint = pow(clamp(dot(Hv, vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 48.0);
          col += uSun * glint * (0.20 + petals * 0.40) * 0.34;
"""

new = """          // —— 用真实浪高梯度算水面法线，破掉"塑料平板"感 ——
          float eps = 0.42;
          float hL = seaWaveH(vP - vec2(eps, 0.0), uTime);
          float hR = seaWaveH(vP + vec2(eps, 0.0), uTime);
          float hD = seaWaveH(vP - vec2(0.0, eps), uTime);
          float hU = seaWaveH(vP + vec2(0.0, eps), uTime);
          vec3 N = normalize(vec3((hL - hR) / (2.0 * eps), 1.0, (hD - hU) / (2.0 * eps)));
          // 叠一层细碎涟漪，让它有"花毯"的颗粒起伏
          vec2 rip = vec2(
            n2(vP * 5.5 + vec2(uTime * 0.21, uTime * 0.17)) - 0.5,
            n2(vP * 5.5 + vec2(-uTime * 0.18, uTime * 0.24)) - 0.5
          );
          N = normalize(N + vec3(rip.x, 0.0, rip.y) * 0.55);

          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.5);
          col = mix(col, uSky * 0.82, fres * 0.30);
          // 朝光侧提亮、背光侧压暗，有体积感
          float ndl = dot(N, normalize(uSunDir));
          col *= 0.92 + clamp(ndl, 0.0, 1.0) * 0.20;

          // 花瓣反光的碎亮光（跟着法线走，才有细碎闪点）
          vec3 Hv = normalize(normalize(uSunDir) + V);
          float glint = pow(clamp(dot(N, Hv), 0.0, 1.0), 60.0);
          col += uSun * glint * (0.18 + petals * 0.45) * 0.55;
          // 近处一点点自发光散斑，模拟半透花瓣透光
          float sss = pow(clamp(dot(-N, V), 0.0, 1.0), 2.0) * 0.10;
          col += uCrest * sss;
"""

assert old in s
s = s.replace(old, new, 1)
assert s != orig
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("water normals in")
