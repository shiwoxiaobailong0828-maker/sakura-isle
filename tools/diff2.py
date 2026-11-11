# -*- coding: utf-8 -*-
from PIL import Image
import sys
a = Image.open(r"E:\AIGC\html\_build\v1.png").convert("RGB")
b = Image.open(r"E:\AIGC\html\_build\v2.png").convert("RGB")
W, H = a.size
pa, pb = a.load(), b.load()

def region(x0, x1, y0, y1, tag, step=2):
    s = 0
    n = 0
    c = 0
    for y in range(y0, y1, step):
        for x in range(x0, x1, step):
            ca = pa[x, y]; cb = pb[x, y]
            d = abs(ca[0]-cb[0]) + abs(ca[1]-cb[1]) + abs(ca[2]-cb[2])
            s += d; n += 1
            if d > 90:
                c += 1
    print(f"{tag}: avgDiff={s/n:.1f} changedPx%={100*c/n:.1f}")

region(560, 860, 300, 620, "crown")
region(430, 520, 360, 560, "strandL")
region(880, 980, 360, 560, "strandR")
# 只含枝条+天空的区域（判断枝条本身有没有动）
region(520, 620, 300, 350, "branchTop")
