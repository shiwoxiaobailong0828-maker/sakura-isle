# -*- coding: utf-8 -*-
import io
p = r"E:\AIGC\html\sakura\src\app_part2.js"
s = io.open(p, encoding="utf-8").read()

pairs = [
    ("d.x = ( uWindDir.x * gk * 0.55 + s1 * 0.72 + s2 * 0.24 ) * 0.100 * wgt * uWind;",
     "d.x = ( uWindDir.x * gk * 0.55 + s1 * 0.72 + s2 * 0.24 ) * 0.168 * wgt * uWind;"),
    ("d.z = ( uWindDir.y * gk * 0.55 + s1 * 0.48 - s2 * 0.22 ) * 0.084 * wgt * uWind;",
     "d.z = ( uWindDir.y * gk * 0.55 + s1 * 0.48 - s2 * 0.22 ) * 0.140 * wgt * uWind;"),
    ("d.y = s1 * 0.016 * wgt * uWind;",
     "d.y = s1 * 0.030 * wgt * uWind;"),
]
for a, b in pairs:
    assert a in s, a
    s = s.replace(a, b, 1)
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("amplitude up")
