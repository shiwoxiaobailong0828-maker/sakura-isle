/* ---------- 8. 樱花树（贝塞尔分形 · 末端聚花 · 柔性材质） ---------- */
  const treeGroup = new T.Group();
  scene.add(treeGroup);
  const TREE = { x: 0.10, z: -0.28, trunkH: 1.98 };

  const GOLDEN = 2.399963229728653;   // 黄金角，L-system 里经典的叶序排布

  /* ---------------- 通用：带半径函数的管体 ---------------- */
  // radiusFn(t) 返回 t∈[0,1] 处的半径，可自由控制锥度曲线
  function tubeGeo(points, radiusFn, radial, capEnd) {
    const n = points.length;
    const pos = [], nor = [], uvs = [], idx = [];
    const frames = [];
    let prevN = new T.Vector3(1, 0, 0);
    for (let i = 0; i < n; i++) {
      const tangent = new T.Vector3();
      if (i === 0) tangent.subVectors(points[1], points[0]);
      else if (i === n - 1) tangent.subVectors(points[n - 1], points[n - 2]);
      else tangent.subVectors(points[i + 1], points[i - 1]);
      tangent.normalize();
      let nrm = prevN.clone().sub(tangent.clone().multiplyScalar(prevN.dot(tangent)));
      if (nrm.lengthSq() < 1e-6) {
        nrm.set(0, 1, 0);
        if (Math.abs(tangent.dot(nrm)) > 0.95) nrm.set(1, 0, 0);
        nrm.sub(tangent.clone().multiplyScalar(nrm.dot(tangent)));
      }
      nrm.normalize();
      const bin = new T.Vector3().crossVectors(tangent, nrm).normalize();
      frames.push({ t: tangent, n: nrm, b: bin });
      prevN = nrm;
    }
    // 世界尺度 UV：贴图每 TEX_SCALE 个世界单位重复一次，长枝短枝纹理密度一致
    const TEX_SCALE = 0.55;
    const cumLen = [0];
    for (let i = 1; i < n; i++) cumLen.push(cumLen[i - 1] + points[i].distanceTo(points[i - 1]));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const r = radiusFn(t);
      const P = points[i], F = frames[i];
      const vCoord = cumLen[i] / TEX_SCALE;
      const uScale = (TAU * Math.max(r, 0.02)) / TEX_SCALE;
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * TAU;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx = F.n.x * ca + F.b.x * sa;
        const ny = F.n.y * ca + F.b.y * sa;
        const nz = F.n.z * ca + F.b.z * sa;
        pos.push(P.x + nx * r, P.y + ny * r, P.z + nz * r);
        nor.push(nx, ny, nz);
        uvs.push((j / radial) * uScale, vCoord);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j;
        const b = a + 1;
        const c = (i + 1) * (radial + 1) + j;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    // 两端封口，避免露出空心断面
    const capAt = (idxPos, flip) => {
      const P = points[idxPos];
      const base = idxPos * (radial + 1) * 3;
      let nx = 0, ny = 0, nz = 0;
      for (let j = 0; j < radial; j++) {
        nx += nor[base + j * 3]; ny += nor[base + j * 3 + 1]; nz += nor[base + j * 3 + 2];
      }
      const ln = Math.hypot(nx, ny, nz) || 1;
      const ci = pos.length / 3;
      pos.push(P.x, P.y, P.z);
      nor.push(-nx / ln, -ny / ln, -nz / ln);
      uvs.push(0.5, idxPos === 0 ? 0 : 1);
      const off = idxPos * (radial + 1);
      for (let j = 0; j < radial; j++) {
        if (flip) idx.push(ci, off + j, off + j + 1);
        else idx.push(ci, off + j + 1, off + j);
      }
    };
    capAt(0, false);
    if (capEnd) capAt(n - 1, true);

    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    sanitize(geo);
    return geo;
  }

  // 兼容旧写法：线性锥度
  function taperedTube(points, r0, r1, radial, capEnd) {
    return tubeGeo(points, (t) => lerp(r0, r1, Math.pow(t, 0.72)), radial, capEnd);
  }

  /* ---------------- 三次贝塞尔 ---------------- */
  function bezierPoint(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    return new T.Vector3(
      p0.x * a + p1.x * b + p2.x * c + p3.x * d,
      p0.y * a + p1.y * b + p2.y * c + p3.y * d,
      p0.z * a + p1.z * b + p2.z * c + p3.z * d
    );
  }

  /* 生成一条枝：返回采样点 / 末端方向 / 末端位置
     - parentDir：父枝在该处的切向，用于消除折角
     - inherit：继承父向的比例（越靠枝尖越大，枝条走向更连贯） */
  function makeBranch(start, parentDir, azimuth, len, o) {
    const out = new T.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
    const up = new T.Vector3(0, 1, 0);

    const endP = start.clone()
      .addScaledVector(out, len * o.spreadH)
      .addScaledVector(up, len * o.spreadV);

    // 起点切向：父向与伸展方向的平滑混合 → 接头处切线连续
    const d0 = parentDir.clone().multiplyScalar(o.inherit)
      .addScaledVector(out, o.spreadH * 1.12)
      .addScaledVector(up, o.spreadV * 1.05);
    if (d0.lengthSq() < 1e-8) d0.copy(out);
    d0.normalize();

    // 末端切向：向外并自然下垂
    const d3 = out.clone().multiplyScalar(0.80)
      .addScaledVector(up, o.spreadV * 0.28 - o.droop);
    if (d3.lengthSq() < 1e-8) d3.copy(out);
    d3.normalize();

    const p0 = start.clone();
    const p1 = p0.clone().addScaledVector(d0, len * 0.36);
    const p2 = endP.clone().addScaledVector(d3, -len * 0.34);
    const p3 = endP.clone();

    const steps = o.steps;
    const pts = [];
    for (let i = 0; i <= steps; i++) pts.push(bezierPoint(p0, p1, p2, p3, i / steps));
    return { pts, endDir: d3, endP, steps };
  }

  /* ---------------- 数据容器 ---------------- */
  const blossomSpots = [];
  const branchGeos = [];
  const twigPts = [];          // 细枝采样点，用于判断补花"有没有枝条支撑"
  const boughPts = [];         // 中下层主/次枝采样点，用于全宽错落悬挂提灯

  /* 沿枝条撒花：段内连续插值 + 团簇蓬松包络，塑造吉野樱饱满云团感 */
  function addBlossoms(pts, rFn, density, spread, power, scaleBase, bias, isFeather) {
    const steps = pts.length - 1;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const w = isFeather
        ? (0.62 + 0.52 * Math.sin(Math.PI * Math.pow(t, 0.70))) * (1.0 - 0.18 * smoothstep(0.85, 1.0, t))
        : Math.pow(t, power);
      if (w < 0.02) continue;
      // 成团：噪声决定这一簇浓不浓，制造疏密云朵团块
      const clump = smoothstep(-0.48, 0.36,
        fbm(pts[i].x * 2.1 + 17, t * 2.0, pts[i].z * 2.1 - 5, 2));
      const localR = rFn(t);
      const n = Math.round(density * w * (0.38 + clump * 1.32) * bias);
      if (n <= 0) continue;
      const spreadEnv = isFeather
        ? spread * (0.68 + 0.52 * Math.sin(Math.PI * Math.pow(t, 0.72))) * (0.65 + clump * 0.68)
        : spread * (0.48 + t * 0.82) * (0.58 + clump * 0.78);
      const rr0 = localR * 1.35 + spreadEnv;
      const pPrev = pts[i - 1], pCurr = pts[i];
      for (let k = 0; k < n; k++) {
        const th = R() * TAU;
        const ph = Math.acos(2 * R() - 1);
        const rr = rr0 * Math.cbrt(R());
        const segU = (k + ((k * 0.6180339887) % 1)) / n;
        const bx = lerp(pPrev.x, pCurr.x, segU);
        const by = lerp(pPrev.y, pCurr.y, segU);
        const bz = lerp(pPrev.z, pCurr.z, segU);
        const hScale = isFeather ? 1.05 : 1.08;
        const vScale = isFeather ? 0.92 : 0.88;
        const tipScale = isFeather ? (1.06 - 0.20 * smoothstep(0.82, 1.0, t)) : (0.90 + t * 0.30);
        blossomSpots.push({
          p: new T.Vector3(
            bx + Math.sin(ph) * Math.cos(th) * rr * hScale,
            by + Math.cos(ph) * rr * vScale,
            bz + Math.sin(ph) * Math.sin(th) * rr * hScale
          ),
          rx: (R() - 0.5) * 1.7, ry: R() * TAU, rz: (R() - 0.5) * 1.7,
          scale: scaleBase * (0.54 + R() * 0.76) * tipScale,
          tint: R(),
        });
      }
    }
  }

  /* ---------------- 主构建 ---------------- */
  function buildSakura() {
    const base = new T.Vector3(TREE.x, 0, TREE.z);
    const TH = TREE.trunkH;

    /* ===== 1) 苍劲抓地粗根（Chunky Stylized Roots Grabbing the Earth）：9 条浑圆主板根 + 分叉抓地侧根趾 ===== */
    const N_ROOT = 9;
    for (let i = 0; i < N_ROOT; i++) {
      const a = (i / N_ROOT) * TAU + 0.35 + (R() - 0.5) * 0.22;
      const pts = [];
      const len = 0.52 + R() * 0.22;
      const hStart = 0.34 + (i % 3) * 0.055;
      const knuckleH = 0.095 + R() * 0.035;
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        const r = lerp(0.085, len, Math.pow(t, 0.78));
        // 从树干中下部浑厚隆起 -> 中段拱起抓地骨节(knuckle) -> 末端深深扎入泥土(y = -0.028)，彻底杜绝悬浮树根
        const trunkBlend = Math.pow(1.0 - t, 2.3) * hStart;
        const arch = Math.sin(Math.PI * Math.pow(t, 0.72)) * knuckleH * (1.0 - 0.35 * t);
        const plunge = -0.032 * Math.pow(t, 2.4);
        const y = trunkBlend + arch + plunge;
        const wob = Math.sin(t * 2.6 + i * 1.7) * 0.026 * t;
        pts.push(new T.Vector3(
          base.x + Math.cos(a) * r + Math.cos(a + 1.57) * wob,
          y,
          base.z + Math.sin(a) * r + Math.sin(a + 1.57) * wob
        ));
      }
      // 浑圆饱满的 Pixar 风格化粗根截面：根部粗壮(0.148)，中段骨节饱满，入土端收束
      const rootRFn = (t) => lerp(0.148, 0.022, Math.pow(t, 0.68)) * (1.0 + 0.22 * Math.sin(t * Math.PI));
      branchGeos.push(colored(tubeGeo(pts, rootRFn, 12, true), 0x6b5340));

      // 每条主根在中外段分叉出一条抓地侧根趾（Root Toe），增强抓地力量感与根间藏草凹槽
      const forkIdx = 4 + (i % 2);
      const fp0 = pts[forkIdx].clone();
      const sideSign = (i % 2 === 0) ? 1 : -1;
      const aToe = a + sideSign * (0.34 + R() * 0.18);
      const toeLen = 0.22 + R() * 0.12;
      const toePts = [];
      for (let k = 0; k <= 6; k++) {
        const u = k / 6;
        const tr = u * toeLen;
        const ty = lerp(fp0.y * 0.92, -0.026, Math.pow(u, 1.25)) + Math.sin(u * Math.PI) * 0.022;
        toePts.push(new T.Vector3(
          fp0.x + Math.cos(aToe) * tr,
          ty,
          fp0.z + Math.sin(aToe) * tr
        ));
      }
      const rToe0 = rootRFn(forkIdx / 10) * 0.68;
      branchGeos.push(colored(tubeGeo(toePts, (u) => lerp(rToe0, 0.015, Math.pow(u, 0.72)), 8, true), 0x634b39));
    }

    /* ===== 2) 主干：粗壮古木 S 曲线 + 纵向盘旋树筋，复刻参考图主干体量与肌理 ===== */
    const SN = 26;
    const trunkPts = [];
    const tp0 = new T.Vector3(base.x, -0.03, base.z);
    const tp1 = new T.Vector3(base.x - 0.045, TH * 0.35, base.z + 0.035);
    const tp2 = new T.Vector3(base.x + 0.055, TH * 0.70, base.z - 0.030);
    const tp3 = new T.Vector3(base.x + 0.015, TH, base.z + 0.010);
    for (let i = 0; i <= SN; i++) trunkPts.push(bezierPoint(tp0, tp1, tp2, tp3, i / SN));

    // 加粗古树干半径：基部喇叭状宽厚抓地，中段苍劲，向上分入各大主枝
    const trunkR = (t) => lerp(0.255, 0.108, Math.pow(t, 0.55)) * (1 + 1.15 * Math.exp(-t * 6.8));
    branchGeos.push(colored(tubeGeo(trunkPts, trunkR, 28, false), 0x6d5541));

    // 5 股沿主干盘旋上升的苍劲树筋（从盘根顺畅延入主干，强化古树雕塑感棱线与凹槽 AO）
    for (let m = 0; m < 5; m++) {
      const mPts = [];
      const aBase = (m / 5) * TAU + 0.35;
      for (let i = 0; i <= 18; i++) {
        const u = i / 18;
        const idxF = u * SN;
        const i0 = Math.min(SN - 1, Math.floor(idxF));
        const cp = trunkPts[i0].clone().lerp(trunkPts[i0 + 1], idxF - i0);
        const rLocal = trunkR(u) * 0.74;
        const ang = aBase + u * 1.10;
        cp.x += Math.cos(ang) * rLocal;
        cp.z += Math.sin(ang) * rLocal;
        mPts.push(cp);
      }
      branchGeos.push(colored(tubeGeo(mPts, (t) => lerp(0.098, 0.032, Math.pow(t, 0.65)), 10, false), 0x68503d));
    }

    // 主干切向缓存
    const trunkTan = [];
    for (let i = 0; i <= SN; i++) {
      const a = trunkPts[Math.max(0, i - 1)];
      const b = trunkPts[Math.min(SN, i + 1)];
      trunkTan.push(new T.Vector3().subVectors(b, a).normalize());
    }
    const rAt = (idx) => trunkR(idx / SN);

    /* ===== 3) 递归长枝（巨型伞冠古樱：低层横展苍枝 + 中层宽幅肩冠 + 顶部饱满穹顶） ===== */
    function grow(start, parentDir, azimuth, len, depth, r0, bias, branchMode = 0) {
      // branchMode: 0=常规主冠, 1=中心高耸穹顶(填满正上方), 2=低层横展苍枝(展现伞下横枝与悬挂提灯)
      const o = (branchMode === 1)
        ? (depth === 0
            ? { spreadH: 0.32 + R() * 0.24, spreadV: 1.08 + R() * 0.16, droop: 0.04 + R() * 0.05, inherit: 0.62, steps: 16 }
            : depth === 1
            ? { spreadH: 0.58 + R() * 0.18, spreadV: 0.78 + R() * 0.16, droop: 0.10 + R() * 0.08, inherit: 0.58, steps: 13 }
            : { spreadH: 0.82 + R() * 0.16, spreadV: 0.44 + R() * 0.14, droop: 0.20 + R() * 0.10, inherit: 0.62, steps: 9 })
        : (branchMode === 2)
        ? (depth === 0
            ? { spreadH: 1.24 + R() * 0.14, spreadV: 0.46 + R() * 0.12, droop: 0.12 + R() * 0.08, inherit: 0.42, steps: 18 }
            : depth === 1
            ? { spreadH: 1.18 + R() * 0.14, spreadV: 0.38 + R() * 0.14, droop: 0.18 + R() * 0.10, inherit: 0.54, steps: 13 }
            : { spreadH: 1.10 + R() * 0.12, spreadV: 0.24 + R() * 0.12, droop: 0.26 + R() * 0.12, inherit: 0.64, steps: 9 })
        : (depth === 0)
        ? { spreadH: 1.10 + R() * 0.15, spreadV: 0.74 + R() * 0.15, droop: 0.09 + R() * 0.09,
            inherit: 0.48, steps: 18 }
        : (depth === 1)
        ? { spreadH: 1.12 + R() * 0.14, spreadV: 0.52 + R() * 0.16, droop: 0.18 + R() * 0.12,
            inherit: 0.56, steps: 13 }
        : { spreadH: 1.06 + R() * 0.12, spreadV: 0.28 + R() * 0.14, droop: 0.28 + R() * 0.14,
            inherit: 0.64, steps: 9 };
      const br = makeBranch(start, parentDir, azimuth, len, o);

      // 半径：主枝更加粗壮有力，在花冠下方形成清晰的深色放射状枝干剪影
      const ratio = depth === 0 ? (0.68 + R() * 0.10) : (0.64 + R() * 0.10);
      const rr0 = Math.max(0.0055, r0 * ratio);
      const rr1 = rr0 * (0.26 + R() * 0.12);
      const rFn = (t) => lerp(rr0, rr1, Math.pow(t, 0.66));
      const radial = depth === 0 ? 14 : (depth === 1 ? 10 : (depth === 2 ? 7 : 5));

      branchGeos.push(colored(
        tubeGeo(br.pts, rFn, radial, depth >= 2),
        depth === 0 ? 0x5c4635 : (depth === 1 ? 0x624b39 : 0x6a5340)
      ));

      // 记录中下层横展主/次枝采样点（供提灯在树冠全宽范围悬挂）
      if (depth === 0 || depth === 1) {
        for (let q = 3; q < br.pts.length; q++) boughPts.push(br.pts[q]);
      }

      // 花朵：低层横枝(branchMode===2)前中段保持裸露苍枝剪影，不让花球下垂掩埋提灯与主干分叉
      if (depth === 0) {
        addBlossoms(br.pts, rFn, branchMode === 2 ? 6.5 : 9.5, 0.15, branchMode === 2 ? 2.6 : 1.95, 1.12, bias * 0.78, false);
      } else if (depth === 1) {
        for (let q = 2; q < br.pts.length; q += 2) twigPts.push(br.pts[q]);
        addBlossoms(br.pts, rFn, 16.0, 0.155, branchMode === 2 ? 1.55 : 1.20, 1.16, bias * 0.92, false);
      } else if (depth >= 2) {
        for (let q = 0; q < br.pts.length; q += 1) twigPts.push(br.pts[q]);
        const dens = depth === 2 ? 23.0 : 18.0;
        addBlossoms(br.pts, rFn, dens, depth === 2 ? 0.135 : 0.110,
                    1.55, depth === 2 ? 1.16 : 1.08, bias, false);
      }

      // 继续分叉
      if (depth < 3) {
        const nChild = depth === 0 ? 6 : (depth === 1 ? 4 : 3);
        for (let c = 0; c < nChild; c++) {
          const tt = 0.26 + (c / nChild) * 0.68 + R() * 0.05;
          const idx = Math.min(br.steps, Math.max(1, Math.round(tt * br.steps)));
          const sp = br.pts[idx].clone();
          const sa = br.pts[Math.max(0, idx - 1)];
          const sb = br.pts[Math.min(br.steps, idx + 1)];
          const tan = new T.Vector3().subVectors(sb, sa).normalize();
          const az = azimuth + GOLDEN * (c + 1) + (R() - 0.5) * 0.52;
          const len2 = len * (depth === 0 ? 0.84 : (depth === 1 ? 0.74 : 0.64)) * (0.84 + R() * 0.32);
          grow(sp, tan, az, len2, depth + 1, rFn(idx / br.steps), bias * (0.76 + R() * 0.46), branchMode);
        }
      }
    }

    // 主枝：8 根粗壮大主枝，底层 3 根横向舒展露出苍劲树骨，中上层 5 根宽扇形斜上托起巨冠
    const N_MAIN = 8;
    for (let i = 0; i < N_MAIN; i++) {
      const hRatio = 0.44 + (i / (N_MAIN - 1)) * 0.44 + (R() - 0.5) * 0.025;
      const idx = clamp(Math.round(hRatio * SN), 2, SN);
      const start = trunkPts[idx].clone();
      const a0 = (i / N_MAIN) * TAU + (R() - 0.5) * 0.24;
      start.x -= Math.cos(a0) * 0.055;
      start.z -= Math.sin(a0) * 0.055;

      const sideBoost = 1.0 + 0.18 * Math.abs(Math.cos(a0));
      const len = (1.36 + R() * 0.24) * sideBoost;
      const mode = i < 3 ? 2 : 0;
      grow(start, trunkTan[idx], a0, len, 0, rAt(idx) * 0.80, 0.90 + R() * 0.20, mode);
    }

    // 顶冠：7 根中心高耸穹顶主枝（使用纯垂直向上导引，填满树冠正中与右上方，形成浑圆伞状巨冠）
    const upDir = new T.Vector3(0, 1, 0);
    for (let i = 0; i < 7; i++) {
      const az = (i / 7) * TAU + (R() - 0.5) * 0.22;
      const topIdx = i < 4 ? SN : (SN - 1);
      grow(trunkPts[topIdx].clone(), upDir, az, 1.24 + R() * 0.22, 0, rAt(topIdx) * 0.72, 0.98, 1);
    }

    /* ===== 3.5) 外冠迎光羽状探枝：替代原先僵直的长垂柳条，还原参考图外缘轻盈伸出的碎花枝 ===== */
    {
      const NB = 28;
      const N_FEATHER = 48;
      const cand = [];
      for (const p of twigPts) {
        const rad = Math.hypot(p.x - base.x, p.z - base.z);
        if (rad > 1.25 && p.y > TH * 0.72) cand.push(p);
      }
      const buckets = [];
      for (let i = 0; i < NB; i++) buckets.push([]);
      for (const p of cand) {
        const a = Math.atan2(p.z - base.z, p.x - base.x);
        const bi = Math.floor(((a + Math.PI) / TAU) * NB) % NB;
        buckets[bi].push(p);
      }
      let made = 0;
      for (let round = 0; round < 2 && made < N_FEATHER; round++) {
        for (let bi = 0; bi < NB && made < N_FEATHER; bi++) {
          const list = buckets[bi];
          if (list.length <= round) continue;
          // 按外展半径排序，从最外缘长出轻盈斜伸的迎光花枝
          list.sort((A, B) => Math.hypot(B.x - base.x, B.z - base.z) - Math.hypot(A.x - base.x, A.z - base.z));
          const anchor = list[round];
          if (!anchor) continue;
          const dx = anchor.x - base.x, dz = anchor.z - base.z;
          const rad = Math.max(0.001, Math.hypot(dx, dz));
          const ox = dx / rad, oz = dz / rad;
          const outL = 0.32 + R() * 0.28;
          const liftY = (R() - 0.42) * 0.28;
          const tx = -oz, tz = ox;
          const sway = (R() - 0.5) * 0.16;
          const p0 = anchor.clone();
          const p1 = new T.Vector3(anchor.x + ox * outL * 0.38, anchor.y + liftY * 0.4 + 0.05, anchor.z + oz * outL * 0.38);
          const p2 = new T.Vector3(anchor.x + ox * outL * 0.74 + tx * sway * 0.5, anchor.y + liftY * 0.8, anchor.z + oz * outL * 0.74 + tz * sway * 0.5);
          const p3 = new T.Vector3(anchor.x + ox * outL + tx * sway, anchor.y + liftY, anchor.z + oz * outL + tz * sway);
          const pts = [];
          const ST = 8;
          for (let s = 0; s <= ST; s++) pts.push(bezierPoint(p0, p1, p2, p3, s / ST));
          const r0 = 0.008 + R() * 0.003, r1 = 0.002 + R() * 0.001;
          const rFn = (t) => lerp(r0, r1, Math.pow(t, 0.70));
          branchGeos.push(colored(tubeGeo(pts, rFn, 5, false), 0x664f3c));
          addBlossoms(pts, rFn, 22, 0.085, 0.95, 0.86, 1.0, true);
          made++;
        }
      }
    }

    /* ===== 4) 合并 & 树皮 ===== */
    const trunkMerged = mergeGeos(branchGeos);

    function makeBarkTexture() {
      const S = 192;
      const data = new Uint8Array(S * S * 4);
      function barkAt(x, y) {
        let v = 0.76;
        // 纵向深裂纹（多频）
        v += Math.sin(x * 0.37 + Math.sin(y * 0.014) * 3.1) * 0.150;
        v += Math.sin(x * 0.95 + y * 0.007 + 1.3) * 0.075;
        // 噪声起伏
        v += fbm(x * 0.055, y * 0.018, 0.5, 3) * 0.50;
        // 沟壑
        const crack = Math.sin(x * 0.48 + Math.sin(y * 0.011 + 2.0) * 3.4);
        if (crack < -0.52) v *= (1.0 - smoothstep(-0.52, -0.98, crack) * 0.74);
        // 鳞片斑
        const plate = Math.sin(x * 0.14 + 3.1) * Math.sin(y * 0.09 + 1.7);
        v += Math.max(0, plate - 0.34) * 0.20;
        return clamp(v, 0.06, 1.08);
      }
      let p = 0;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const g8 = Math.round(barkAt(x, y) * 255);
          data[p] = g8; data[p + 1] = g8; data[p + 2] = g8; data[p + 3] = 255;
          p += 4;
        }
      }
      const tex = new T.DataTexture(data, S, S, T.RGBAFormat);
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.repeat.set(3.0, 2.2);
      tex.colorSpace = T.SRGBColorSpace;
      tex.minFilter = T.LinearFilter;
      tex.magFilter = T.LinearFilter;
      tex.generateMipmaps = false;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      return tex;
    }

    /* ---- Blender 烘的树皮四件套（base64 由 build.ps1 注入，缺省回退程序化） ---- */
    // @tex-inject-start
    const TEX_BARK_ALBEDO = "__BARK_ALBEDO__";
    const TEX_BARK_NORMAL = "__BARK_NORMAL__";
    const TEX_BARK_ROUGH = "__BARK_ROUGH__";
    const TEX_BARK_AO = "__BARK_AO__";
    // @tex-inject-end
    function texB64(b64, srgb) {
      if (!b64 || b64.length < 64 || b64.charAt(0) === '_') return null;
      const img = new Image();
      const tex = new T.Texture();
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.repeat.set(1.0, 1.0);
      tex.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
      tex.anisotropy = 8;
      tex.minFilter = T.LinearMipmapLinearFilter;
      tex.magFilter = T.LinearFilter;
      img.onload = () => { tex.image = img; tex.needsUpdate = true; };
      img.src = 'data:image/jpeg;base64,' + b64;
      return tex;
    }
    const barkAlb = texB64(TEX_BARK_ALBEDO, true);
    const barkNrm = texB64(TEX_BARK_NORMAL, false);
    const barkRgh = texB64(TEX_BARK_ROUGH, false);
    const barkAo = texB64(TEX_BARK_AO, false);
    for (const tx of [barkAlb, barkNrm, barkRgh, barkAo]) { if (tx) tx.repeat.set(2.2, 1.35); }
    const barkTex = makeBarkTexture();   // 兜底 / 仅无贴图时生效

    const barkMat = new T.MeshStandardMaterial({
      vertexColors: !barkAlb,
      color: barkAlb ? new T.Color(0xf6e6d4) : 0xffffff,
      map: barkAlb || barkTex,
      normalMap: barkNrm || null,
      roughnessMap: barkRgh || null,
      aoMap: barkAo || null,
      aoMapIntensity: 0.72,
      bumpMap: barkTex,
      bumpScale: 0.55,
      roughness: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.45,
      flatShading: false,
    });
    if (barkNrm) { barkMat.normalScale.set(3.2, 3.2); barkMat.bumpScale = 0.09; }
    // 枝干跟着风摆（与花朵同一风场，因此花不会被甩开）+ 夕阳金边与暖光漫反射提亮树皮纹理
    barkMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = TREE_WIND.uTime;
      sh.uniforms.uWind = TREE_WIND.uWind;
      sh.uniforms.uWindDir = TREE_WIND.uWindDir;
      sh.uniforms.uGust = TREE_WIND.uGust;
      sh.vertexShader = WIND_FIELD_GLSL + 'varying vec3 vBarkPos;\nvarying vec3 vBarkWorldN;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vBarkPos = position;
         vBarkWorldN = normalize( mat3( modelMatrix ) * objectNormal );
         transformed += sakuraWind( position );`
      );
      sh.fragmentShader = 'varying vec3 vBarkPos;\nvarying vec3 vBarkWorldN;\n' + sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        `{
           vec3 N = normalize( vBarkWorldN );
           // 1) Pixar/Octane 风格树皮微雕纹理 + 树干正面暖色环境补光 + 右侧落日逆光金边
           float trunkMask = smoothstep( 2.6, 0.08, vBarkPos.y );
           float angB = atan( vBarkPos.z, vBarkPos.x );
           float barkRidge = 0.5 + 0.5 * sin( angB * 18.0 + vBarkPos.y * 7.5 + sin( vBarkPos.y * 4.2 + angB * 5.0 ) * 1.4 );
           float barkFine  = 0.5 + 0.5 * sin( angB * 42.0 - vBarkPos.y * 16.0 );
           float relief = mix( 0.68, 1.28, smoothstep( 0.22, 0.82, barkRidge * 0.72 + barkFine * 0.28 ) );

           float sunRim = pow( clamp( dot( N, normalize( vec3( 0.72, 0.26, 0.48 ) ) ), 0.0, 1.0 ), 1.45 );
           float frontFill = clamp( dot( N, normalize( vec3( -0.18, 0.32, 0.93 ) ) ), 0.0, 1.0 );
           float lanternGlow = smoothstep( 0.35, 1.75, vBarkPos.y ) * smoothstep( 2.65, 1.35, vBarkPos.y ) * clamp( N.z * 0.6 + 0.5, 0.0, 1.0 );
           float grassBounce = clamp( -N.y * 0.45 + 0.55, 0.0, 1.0 ) * smoothstep( 0.95, -0.02, vBarkPos.y );

           vec3 warmBark = mix( vec3( 0.20, 0.12, 0.09 ), vec3( 0.48, 0.31, 0.21 ), smoothstep( 0.25, 0.85, barkRidge ) );
           gl_FragColor.rgb *= relief;
           gl_FragColor.rgb += (
             warmBark * frontFill * 0.58 +
             vec3( 0.82, 0.45, 0.20 ) * sunRim * 0.52 * relief +
             vec3( 0.55, 0.32, 0.16 ) * lanternGlow * 0.34 +
             vec3( 0.16, 0.26, 0.09 ) * grassBounce * 0.32
           ) * trunkMask;

           // 2) 粗壮树根抓地处：顶部鲜活青苔融合 + 根缝与底部深度接触阴影（Contact Shadows & Root AO）
           float rootBase = 1.0 - smoothstep( -0.02, 0.26, vBarkPos.y );
           float mossTop = clamp( N.y, 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.02, 0.32, vBarkPos.y ) );
           gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.26, 0.46, 0.16 ), mossTop * 0.52 );
           float creviceAO = ( 1.0 - smoothstep( 0.18, 0.55, barkRidge ) ) * 0.28;
           float underRootAO = clamp( 1.0 - N.y * 0.85, 0.0, 1.0 ) * rootBase;
           gl_FragColor.rgb *= ( 1.0 - underRootAO * 0.54 - creviceAO * trunkMask );
         }
         #include <dithering_fragment>`
      );
    };
    const barkMesh = new T.Mesh(trunkMerged, barkMat);
    barkMesh.castShadow = true;
    barkMesh.receiveShadow = true;
    treeGroup.add(barkMesh);

    /* ===== 5) 树冠外壳补花：只补轮廓，不铺满内部 ===== */
    // ★ 先量出细枝花簇的真实范围，外壳补花必须落在同一包络内，
    //    否则会形成一圈悬在外面的"飞花"
    let mX = 0.4, mY = 0.4, mZ = 0.4, mTop = 0;
    let sumY = 0;
    for (const b of blossomSpots) sumY += b.p.y;
    const cyMean = blossomSpots.length ? sumY / blossomSpots.length : (TH + 0.55);
    for (const b of blossomSpots) {
      mX = Math.max(mX, Math.abs(b.p.x - base.x));
      mZ = Math.max(mZ, Math.abs(b.p.z - base.z));
      mY = Math.max(mY, Math.abs(b.p.y - cyMean));
      mTop = Math.max(mTop, b.p.y);
    }
    const CROWN = {
      cx: base.x, cz: base.z,
      cy: cyMean,
      rx: mX * 1.15, ry: mY * 0.88, rz: mZ * 1.15,
    };
    const TARGET_N = Math.round(blossomSpots.length * 1.24);

    // 细枝点空间网格：快速判断一个补花点附近有没有枝条
    const CELL = 0.24;
    const grid = new Map();
    const gkey = (ix, iy, iz) => ix + ',' + iy + ',' + iz;
    for (const p of twigPts) {
      const k = gkey(Math.floor(p.x / CELL), Math.floor(p.y / CELL), Math.floor(p.z / CELL));
      let a = grid.get(k); if (!a) { a = []; grid.set(k, a); }
      a.push(p);
    }
    function minDistToTwig(x, y, z) {
      const ix = Math.floor(x / CELL), iy = Math.floor(y / CELL), iz = Math.floor(z / CELL);
      let best = 1e9;
      for (let ddx = -1; ddx <= 1; ddx++)
        for (let ddy = -1; ddy <= 1; ddy++)
          for (let ddz = -1; ddz <= 1; ddz++) {
            const a = grid.get(gkey(ix + ddx, iy + ddy, iz + ddz));
            if (!a) continue;
            for (let i = 0; i < a.length; i++) {
              const p = a[i];
              const ax = p.x - x, ay = p.y - y, az = p.z - z;
              const d2 = ax * ax + ay * ay + az * az;
              if (d2 < best) best = d2;
            }
          }
      return Math.sqrt(best);
    }

    let guard = 0;
    while (blossomSpots.length < TARGET_N && guard < TARGET_N * 40) {
      guard++;
      const th = R() * TAU;
      const ph = Math.acos(2 * R() - 1);

      // 球面方向
      const ux = Math.sin(ph) * Math.cos(th);
      const uy = Math.cos(ph);
      const uz = Math.sin(ph) * Math.sin(th);

      // ★ 方向噪声：让外壳起伏不平，破坏"完美球"
      const bump = fbm(ux * 2.1 + 11.3, uy * 2.1 - 4.7, uz * 2.1 + 8.1, 3);

      // 半径：外壳为主，被噪声推拉
      const rrMax = 0.88 + bump * 0.14;
      const rr = 0.45 + Math.cbrt(R()) * (rrMax - 0.45);

      // ★ 成团：只在噪声高的方向堆花，低的方向留空
      const clumpF = smoothstep(-0.28, 0.40, bump);
      if (R() > 0.32 + clumpF * 0.68) continue;

      let x = CROWN.cx + ux * rr * CROWN.rx;
      let y = CROWN.cy + uy * rr * CROWN.ry;
      let z = CROWN.cz + uz * rr * CROWN.rz;
      if (y < TH * 0.68 || y > mTop * 1.04) continue;   // 限制在树冠高度内

      // 避让树干
      const dx = x - CROWN.cx, dz = z - CROWN.cz;
      const dT = Math.hypot(dx, dz);
      if (y < TH * 1.05 && dT < 0.28) continue;

      // ★ 支撑判定：离最近细枝超过阈值就不生成，避免"没有枝条托着的悬空花瓣"
      if (minDistToTwig(x, y, z) > 0.36) continue;

      blossomSpots.push({
        p: new T.Vector3(x, y, z),
        rx: (R() - 0.5) * 1.7, ry: R() * TAU, rz: (R() - 0.5) * 1.7,
        scale: 1.15 * (0.48 + R() * 0.85),
        tint: R(),
      });
    }

    // 花朵实例化较慢，放到外层分帧执行（见文件末尾），便于进度条反馈
  }

  /* ---------------- 花瓣：参数化曲面（圆头、有弧度） ---------------- */
  const PET_NU = 4;   // 沿瓣长分段
  const PET_NV = 2;   // 横向分段

  function makeBlossomGeo() {
    const pos = [], nor = [], uvs = [], idx = [];
    const PETALS = 5;
    const r0 = 0.0045, rTip = 0.0375, maxW = 0.0225;
    let vo = 0;

    for (let p = 0; p < PETALS; p++) {
      const a = (p / PETALS) * TAU + 0.28;
      const ca = Math.cos(a), sa = Math.sin(a);
      const tx = -sa, tz = ca;                    // 横向单位向量

      for (let iu = 0; iu <= PET_NU; iu++) {
        const u = iu / PET_NU;
        const r = lerp(r0, rTip, u);
        // 宽度：中段最宽，两端收拢 → 圆润花瓣（不是尖三角）
        const uu = Math.pow(u, 0.70);
        const halfW = maxW * Math.sin(Math.PI * uu) * (0.40 + 0.60 * u);
        // 纵向：杯状上翻，花心微凹
        const yBase = 0.0185 * Math.pow(u, 2.05) - 0.0042;

        for (let iv = 0; iv <= PET_NV; iv++) {
          const v = (iv / PET_NV) * 2 - 1;
          // 横向内凹：中间低、两侧翘，形成碗形
          const cupY = -0.0062 * (1 - Math.pow(Math.abs(v), 1.7)) * Math.sin(Math.PI * u);
          const edgeY = 0.0026 * v * v * u;
          pos.push(
            ca * r + tx * halfW * v,
            yBase + cupY + edgeY,
            sa * r + tz * halfW * v
          );
          nor.push(0, 1, 0);
          uvs.push(u, v * 0.5 + 0.5);             // u: 花心→瓣尖
        }
      }
      for (let iu = 0; iu < PET_NU; iu++) {
        for (let iv = 0; iv < PET_NV; iv++) {
          const A = vo + iu * (PET_NV + 1) + iv;
          const B = A + 1;
          const C = A + (PET_NV + 1);
          const D = C + 1;
          idx.push(A, C, B, B, C, D);
        }
      }
      vo += (PET_NU + 1) * (PET_NV + 1);
    }

    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    sanitize(g);
    return g;
  }

    // 统一树风场：枝干与花朵共用同一套位移场，花才会跟着枝条一起摆
    const TREE_WIND = {
      uTime: { value: 0 },
      uWind: { value: 1.0 },
      uWindDir: windUniforms.uWindDir,
      uGust: windUniforms.uGust,
    };
    const WIND_FIELD_GLSL = `
      uniform float uTime; uniform float uWind; uniform float uGust;
      uniform vec2 uWindDir;
      vec3 sakuraWind( vec3 p ) {
        float r = distance( p.xz, vec2( 0.10, -0.28 ) );
        float wgt = smoothstep( 0.12, 1.75, r ) * smoothstep( 0.02, 1.20, p.y );
        float ph = p.x * 0.42 + p.z * 0.33;
        float s1 = sin( uTime * 0.85 + ph );
        float s2 = sin( uTime * 0.47 + ph * 0.6 + 1.7 );
        float gk = 0.55 + uGust * 0.85;
        vec3 d;
        d.x = ( uWindDir.x * gk * 0.55 + s1 * 0.72 + s2 * 0.24 ) * 0.168 * wgt * uWind;
        d.z = ( uWindDir.y * gk * 0.55 + s1 * 0.48 - s2 * 0.22 ) * 0.140 * wgt * uWind;
        d.y = s1 * 0.030 * wgt * uWind;
        return d;
      }
    `;

  /* ---------------- 花朵实例化 + 材质 ---------------- */
  let blossomMesh = null;
  const blossomUniforms = {
    uTime: TREE_WIND.uTime,
    uWind: TREE_WIND.uWind,
    uWindDir: windUniforms.uWindDir,
    uGust: windUniforms.uGust,
    uC1: { value: new T.Color(0xffdde6) },   // 浅粉（贴近海面花瓣）
    uC2: { value: new T.Color(0xfab6c6) },   // 中粉（花心）
    uC3: { value: new T.Color(0xfff7f6) },   // 近白（瓣尖）
    uSunDir: { value: new T.Vector3(0.4, 0.7, 0.5).normalize() },
    uSSS: { value: 0.62 },
  };

  function buildBlossoms() {
    const geo = makeBlossomGeo();
    const N = blossomSpots.length;
    // 打乱顺序：降画质时按 count 截断，也能保持各枝条均匀，不会整根变秃
    for (let i = N - 1; i > 0; i--) {
      const j = Math.floor(R() * (i + 1));
      const t = blossomSpots[i]; blossomSpots[i] = blossomSpots[j]; blossomSpots[j] = t;
    }

    // 每朵一个随机数（色相/亮度扰动）
    const randArr = new Float32Array(N);
    for (let i = 0; i < N; i++) randArr[i] = R();
    geo.setAttribute('aRand', new T.InstancedBufferAttribute(randArr, 1));

    const mat = new T.MeshStandardMaterial({
      side: T.DoubleSide,
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.10,
      transparent: false,
      flatShading: false,
      emissive: 0xffd8e6,
      emissiveIntensity: 0.20,
    });

    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = blossomUniforms.uTime;
      sh.uniforms.uWind = blossomUniforms.uWind;
      sh.uniforms.uWindDir = blossomUniforms.uWindDir;
      sh.uniforms.uGust = blossomUniforms.uGust;
      sh.uniforms.uC1 = blossomUniforms.uC1;
      sh.uniforms.uC2 = blossomUniforms.uC2;
      sh.uniforms.uC3 = blossomUniforms.uC3;
      sh.uniforms.uSunDir = blossomUniforms.uSunDir;
      sh.uniforms.uSSS = blossomUniforms.uSSS;

      /* ---- vertex：风摆 + 树冠球面法线柔化（消除碎屑噪点感） + 世界坐标传递 ---- */
      sh.vertexShader = WIND_FIELD_GLSL + `
        attribute float aRand;
        varying vec2 vBUv;
        varying vec3 vBWPos;
        varying float vBRand;
        ` + sh.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
           #ifdef USE_INSTANCING
           {
             vec3 ipN = ( instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
             // 树冠球面外向法线与花团局部起伏结合，让每簇花呈饱满云团受光，不再是乱朝向的碎三角
             vec3 domeN = normalize( ipN - vec3( 0.10, 1.75, -0.28 ) );
             mat3 im3N = mat3( instanceMatrix );
             float scN = max( length( im3N[ 0 ] ), 1e-4 );
             vec3 localDomeN = transpose( im3N ) * domeN / scN;
             objectNormal = normalize( mix( objectNormal, localDomeN, 0.58 ) );
           }
           #endif`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           {
             vBUv = uv;
             vBRand = aRand;
             vec3 ip = vec3( 0.0 );
             #ifdef USE_INSTANCING
               ip = ( instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
             #endif
             // 与枝条完全相同的位移量 → 整朵花跟着枝条走，不会自己乱抖
             vec3 wDisp = sakuraWind( ip );
             #ifdef USE_INSTANCING
               // 把树内位移换算回实例局部空间，方向才和枝条一致
               mat3 im3 = mat3( instanceMatrix );
               float sc2 = dot( im3[ 0 ], im3[ 0 ] );
               transformed += transpose( im3 ) * wDisp / max( sc2, 1e-4 );
             #else
               transformed += wDisp;
             #endif
             vBWPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
           }`
        );

      /* ---- fragment：粉白渐变 + 树冠体积光影(Canopy AO) + 次表面透光 ---- */
      sh.fragmentShader = `
        uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
        uniform vec3 uSunDir; uniform float uSSS;
        varying vec2 vBUv;
        varying vec3 vBWPos;
        varying float vBRand;
        ` + sh.fragmentShader
          .replace('#include <color_fragment>', `#include <color_fragment>
         {
           float u = vBUv.x;                      // 0 花心 → 1 瓣尖
           float edge = abs( vBUv.y * 2.0 - 1.0 );// 0 中间 → 1 瓣缘
           // 花心偏樱粉、瓣尖近暖白
           vec3 c = mix( uC2, uC1, smoothstep( 0.0, 0.50, u ) );
           c = mix( c, uC3, smoothstep( 0.38, 1.0, u ) * ( 0.52 + 0.48 * vBRand ) );
           c *= 0.93 + 0.11 * vBRand;
           c = mix( c, uC3, pow( edge, 2.6 ) * 0.28 );

           // ★ 树冠体积光影 (Canopy AO + 花团云朵层次)：适配巨型伞冠尺寸，底部花荫深邃、外冠通透亮泽
           vec3 cRel = ( vBWPos - vec3( 0.18, 5.95, -0.45 ) ) / vec3( 5.65, 3.65, 5.65 );
           float cRad = length( cRel );
           float shellAO = smoothstep( 0.12, 0.86, cRad ) * ( 0.54 + 0.46 * smoothstep( -0.78, 0.62, cRel.y ) );
           // 花团云块起伏，让巨型树冠分出饱满的立体团块结构
           float clumpWave = 0.5 + 0.5 * (
             sin( vBWPos.x * 1.75 + vBWPos.y * 1.35 ) * cos( vBWPos.z * 1.75 - vBWPos.y * 1.25 ) * 0.65 +
             sin( vBWPos.x * 3.6 - vBWPos.z * 3.1 ) * 0.35
           );
           float occ = clamp( shellAO * ( 0.74 + 0.36 * clumpWave ), 0.0, 1.0 );
           vec3 innerTint = vec3( 0.74, 0.51, 0.67 );   // 树冠深处与横枝上方浓郁紫粉花荫
           vec3 outerTint = vec3( 1.07, 0.99, 0.98 );   // 树冠外缘柔亮粉白
           c *= mix( innerTint, outerTint, occ );

           diffuseColor.rgb *= c;
         }`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
         {
           // 次表面透光 (SSS) + 夕阳穿透树冠的金粉暖光
           vec3 Nw = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
           vec3 Vw = normalize( cameraPosition - vBWPos );
           vec3 cRel = ( vBWPos - vec3( 0.18, 5.95, -0.45 ) ) / vec3( 5.65, 3.65, 5.65 );
           vec3 domeDir = normalize( cRel + vec3( 0.0, 0.32, 0.0 ) );
           float domeSun = pow( clamp( dot( domeDir, normalize( uSunDir ) ) * 0.5 + 0.5, 0.0, 1.0 ), 1.5 );
           // 右侧与外冠迎向夕阳处的穿透金辉
           float sunSide = smoothstep( -0.2, 0.75, cRel.x ) * smoothstep( -0.45, 0.45, cRel.y );
           float outerShell = smoothstep( 0.25, 0.92, length( cRel ) );
           float rim  = pow( clamp( 1.0 - abs( dot( Nw, Vw ) ), 0.0, 1.0 ), 1.8 );
           float back = pow( clamp( dot( -Nw, uSunDir ), 0.0, 1.0 ), 1.15 );
           vec3 sssCol = mix( uC1, vec3( 1.04, 0.88, 0.76 ), clamp( 0.50 * domeSun + 0.38 * sunSide, 0.0, 1.0 ) );
           float sss = ( rim * 0.058 + back * 0.068 + ( domeSun * outerShell + sunSide * 0.55 ) * 0.055 ) * uSSS * ( 0.75 + 0.40 * vBRand );
           totalEmissiveRadiance += sssCol * sss;
         }`);
    };

    const inst = new T.InstancedMesh(geo, mat, N);
    inst.castShadow = true;
    inst.receiveShadow = false;
    inst.frustumCulled = false;

    const dummy = new T.Object3D();
    const col = new T.Color();
    for (let i = 0; i < N; i++) {
      const b = blossomSpots[i];
      dummy.position.copy(b.p);
      dummy.rotation.set(b.rx, b.ry, b.rz);       // 三维随机朝向
      dummy.scale.setScalar(b.scale);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      const t = b.tint;
      col.setRGB(lerp(1.0, 0.95, t), lerp(0.95, 0.90, t), lerp(0.97, 0.93, t));
      inst.setColorAt(i, col);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    blossomMesh = inst;
    treeGroup.add(inst);
  }

  buildSakura();

  // ★ 整体放大至 2.24（配合宽幅放射主枝，让巨型樱花树冠像参考图一样横跨小岛两侧且左右完整入画）
  const TREE_SCALE = 2.24;
  treeGroup.scale.setScalar(TREE_SCALE);

  PROG(42, '生长枝干');
  await yieldFrame();

  buildBlossoms();          // 花朵实例化
  regInst(blossomMesh, 'blossom');

  /* ---------- 8b. 树枝小灯笼（全宽横枝错落悬挂 + 和纸圆润提灯 + 竹骨暖芯渐变） ---------- */
  const lanternMats = [];
  const lanternGroups = [];
  function buildLanterns() {
    // 从向左右两侧宽幅伸展的中下层主/次枝中，按横向分区挑选 8 处正侧方挂点，重现参考图全宽垂挂提灯的剪影
    const allPts = boughPts.concat(twigPts);
    const pool = allPts.filter(p => {
      const r = Math.hypot(p.x - TREE.x, p.z - TREE.z);
      // 优先选择朝向镜头或左右两侧（z >= TREE.z - 0.30）的中低层横枝，避免被树干或后方花冠遮挡
      return p.y > 1.18 && p.y < 2.05 && r > 0.38 && r < 2.05 && Math.abs(p.x - TREE.x) > 0.24 && p.z >= TREE.z - 0.30;
    });
    if (!pool.length) return;

    // 分成左远、左中、左近、左内、右内、右近、右中、右远 8 个横向区间，保证左右两侧横枝下都有错落分布的灯笼
    const picks = [];
    const MIN_D = 0.38;
    const xBins = [-1.95, -1.35, -0.95, -0.58, -0.22, 0.24, 0.62, 1.02, 1.45, 1.95];
    for (let bi = 0; bi < xBins.length - 1; bi++) {
      if (bi === 4) continue; // 跳过树干正中区间
      const x0 = TREE.x + xBins[bi], x1 = TREE.x + xBins[bi + 1];
      const sub = pool.filter(p => p.x >= x0 && p.x < x1);
      if (!sub.length) continue;
      sub.sort((a, b) => a.y - b.y);
      const lowSub = sub.slice(0, Math.max(5, Math.floor(sub.length * 0.40)));
      for (let k = 0; k < 40; k++) {
        const p = lowSub[Math.floor(R() * lowSub.length)];
        let ok = true;
        for (const q of picks) if (p.distanceTo(q) < MIN_D) { ok = false; break; }
        if (ok) { picks.push(p); break; }
      }
    }
    let guard = 0;
    while (picks.length < 9 && guard < 3000) {
      guard++;
      const p = pool[Math.floor(R() * pool.length)];
      let ok = true;
      for (const q of picks) if (p.distanceTo(q) < MIN_D) { ok = false; break; }
      if (ok) picks.push(p);
    }

    // 和纸灯身材质：中心暖白高亮 → 上下琥珀橙渐变 + 细微横骨暗纹，消除"橙色便利贴"平面感
    const bodyMat = new T.MeshStandardMaterial({
      color: 0xffe8c2, emissive: 0xff8e3c, emissiveIntensity: 1.85,
      roughness: 0.55, metalness: 0.0, envMapIntensity: 0.1,
    });
    const attachWind = (mat, isBody) => {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = TREE_WIND.uTime;
        sh.uniforms.uWind = TREE_WIND.uWind;
        sh.uniforms.uWindDir = TREE_WIND.uWindDir;
        sh.uniforms.uGust = TREE_WIND.uGust;
        sh.vertexShader = WIND_FIELD_GLSL + (isBody ? 'varying float vLY;\n' : '') + sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           ${isBody ? 'vLY = clamp(position.y * 8.5 + 0.5, 0.0, 1.0);' : ''}
           {
             vec3 wpL = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz / ${TREE_SCALE.toFixed(2)};
             transformed += sakuraWind( wpL );
           }`
        );
        if (isBody) {
          sh.fragmentShader = 'varying float vLY;\n' + sh.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
             {
               // 纵向中心亮芯 + 横向竹骨纹理
               float cy = 1.0 - abs( vLY * 2.0 - 1.0 );
               float core = smoothstep( 0.0, 0.88, cy );
               float ribs = 0.88 + 0.12 * cos( vLY * 31.4159 );
               vec3 coreGlow = mix( vec3( 0.96, 0.42, 0.14 ), vec3( 1.42, 1.12, 0.74 ), pow( core, 1.4 ) );
               totalEmissiveRadiance *= coreGlow * ribs;
             }`
          );
        }
      };
    };
    attachWind(bodyMat, true);
    lanternMats.push(bodyMat);

    const capMat = new T.MeshStandardMaterial({ color: 0x2c1d14, roughness: 0.82, metalness: 0.08 });
    attachWind(capMat, false);
    // 纤细深色吊线（不再像粗木棍），贴合参考图精致垂线
    const cordMat = new T.MeshStandardMaterial({
      color: 0x3b281c, emissive: 0x4a2c16, emissiveIntensity: 0.25, roughness: 0.85, metalness: 0,
    });
    attachWind(cordMat, false);
    const tasselMat = new T.MeshStandardMaterial({
      color: 0xd94830, emissive: 0x9e2a18, emissiveIntensity: 0.42, roughness: 0.8, metalness: 0,
    });
    attachWind(tasselMat, false);

    // 构造圆润提灯几何（中段鼓起的和纸提灯廓形，替代生硬直筒）
    function makeChochinGeo(rBase, h) {
      const geo = new T.CylinderGeometry(rBase * 0.72, rBase * 0.72, h, 16, 10);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const u = clamp(y / h + 0.5, 0, 1);
        const bulge = 1.0 + 0.42 * Math.sin(u * Math.PI);
        pos.setX(i, pos.getX(i) * bulge);
        pos.setZ(i, pos.getZ(i) * bulge);
      }
      geo.computeVertexNormals();
      return geo;
    }

    for (const p of picks) {
      const g = new T.Group();
      const outSpan = Math.abs(p.x - TREE.x);
      // 自动检测挂点正下方的花簇最低高度，让吊绳自然垂落至花丛下沿之外，绝不半截埋在花里
      let minBlossomY = p.y;
      for (let bi = 0; bi < blossomSpots.length; bi += 3) {
        const bp = blossomSpots[bi].p;
        if (Math.abs(bp.x - p.x) < 0.18 && Math.abs(bp.z - p.z) < 0.22 && bp.y < minBlossomY) {
          minBlossomY = bp.y;
        }
      }
      const clearDrop = Math.max(0.18, (p.y - minBlossomY) + 0.04 + R() * 0.08);
      const drop = clamp(clearDrop, 0.18 + 0.04 * outSpan, 0.56);
      const R0 = 0.046 + R() * 0.010;
      const H = 0.104 + R() * 0.020;

      // 纤细吊绳（上端直接连到枝条采样点）
      const cord = new T.Mesh(new T.CylinderGeometry(0.0038, 0.0038, drop, 6), cordMat);
      cord.position.set(p.x, p.y - drop / 2, p.z);
      g.add(cord);

      // 圆润灯身
      const body = new T.Mesh(makeChochinGeo(R0, H), bodyMat);
      body.position.set(p.x, p.y - drop - H / 2, p.z);
      g.add(body);

      // 上下深木箍盖
      const capT = new T.Mesh(new T.CylinderGeometry(R0 * 0.66, R0 * 0.76, 0.018, 12), capMat);
      capT.position.set(p.x, p.y - drop - 0.003, p.z);
      g.add(capT);
      const capB = new T.Mesh(new T.CylinderGeometry(R0 * 0.76, R0 * 0.64, 0.018, 12), capMat);
      capB.position.set(p.x, p.y - drop - H + 0.003, p.z);
      g.add(capB);

      // 底部垂穗（流苏），增加剪影细节
      const tasselH = 0.042;
      const tassel = new T.Mesh(new T.CylinderGeometry(0.005, 0.011, tasselH, 6), tasselMat);
      tassel.position.set(p.x, p.y - drop - H - tasselH / 2 + 0.002, p.z);
      g.add(tassel);

      g.userData.isLantern = true;
      lanternGroups.push(g);
      treeGroup.add(g);
    }
  }
  buildLanterns();

  PROG(66, '绽放花朵');
  await yieldFrame();