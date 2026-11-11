# -*- coding: utf-8 -*-
import io
p = r"E:\AIGC\html\sakura\src\app_part2.js"
s = io.open(p, encoding="utf-8").read()

start = s.index("    // 统一树风场：枝干与花朵共用同一套位移场")
end = s.index("    const barkMat = new T.MeshStandardMaterial({")
block = s[start:end]
s = s[:start] + s[end:]

# 放到模块作用域（blossomUniforms 之前）
anchor = "  /* ---------------- 花朵实例化 + 材质 ---------------- */"
assert anchor in s
s = s.replace(anchor, block + anchor, 1)
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("moved to module scope")
print("TREE_WIND count:", s.count("const TREE_WIND"))
