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

  /* 沿枝条撒花：段内连续插值消除"串珠/糖葫芦感"，垂枝饱满连贯且末梢自然收尖 */
  function addBlossoms(pts, rFn, density, spread, power, scaleBase, bias, isStrand) {
    const steps = pts.length - 1;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // 垂枝全段保持丰满花量，仅在顶头与最末梢柔和收束；普通细枝保持向枝梢聚集
      const w = isStrand
        ? (0.54 + 0.58 * Math.sin(Math.PI * Math.pow(t, 0.65))) * (1.0 - 0.22 * smoothstep(0.85, 1.0, t))
        : Math.pow(t, power);
      if (w < 0.02) continue;
      // 成团：噪声决定这一簇浓不浓，制造疏密
      const clump = smoothstep(-0.5, 0.35,
        fbm(pts[i].x * 2.4 + 17, t * 2.2, pts[i].z * 2.4 - 5, 2));
      const localR = rFn(t);
      const n = Math.round(density * w * (0.35 + clump * 1.3) * bias);
      if (n <= 0) continue;
      // 垂枝半径在中段蓬松、末梢微收，避免底部结成大圆球
      const spreadEnv = isStrand
        ? spread * (0.56 + 0.46 * Math.sin(Math.PI * Math.pow(t, 0.68))) * (0.62 + clump * 0.66) * (1.0 - 0.28 * smoothstep(0.82, 1.0, t))
        : spread * (0.42 + t * 0.75) * (0.55 + clump * 0.75);
      const rr0 = localR * 1.35 + spreadEnv;
      const pPrev = pts[i - 1], pCurr = pts[i];
      for (let k = 0; k < n; k++) {
        const th = R() * TAU;
        const ph = Math.acos(2 * R() - 1);
        const rr = rr0 * Math.cbrt(R());
        // ★ 沿 [pts[i-1], pts[i]] 黄金分割分层插值，让花朵沿枝条连续铺开而非聚成离散圆球（不额外消耗 R()）
        const segU = (k + ((k * 0.6180339887) % 1)) / n;
        const bx = lerp(pPrev.x, pCurr.x, segU);
        const by = lerp(pPrev.y, pCurr.y, segU);
        const bz = lerp(pPrev.z, pCurr.z, segU);
        const hScale = isStrand ? 0.90 : 1.0;
        const vScale = isStrand ? 1.08 : 0.92;
        const tipScale = isStrand ? (1.04 - 0.24 * smoothstep(0.80, 1.0, t)) : (0.86 + t * 0.28);
        blossomSpots.push({
          p: new T.Vector3(
            bx + Math.sin(ph) * Math.cos(th) * rr * hScale,
            by + Math.cos(ph) * rr * vScale,
            bz + Math.sin(ph) * Math.sin(th) * rr * hScale
          ),
          rx: (R() - 0.5) * 1.7, ry: R() * TAU, rz: (R() - 0.5) * 1.7,   // 三轴随机，但不翻背
          scale: scaleBase * (0.5 + R() * 0.72) * tipScale,
          tint: R(),
        });
      }
    }
  }

  /* ---------------- 主构建 ---------------- */
  function buildSakura() {
    const base = new T.Vector3(TREE.x, 0, TREE.z);
    const TH = TREE.trunkH;

    /* ===== 1) 根盘：从土里拱起再没入 ===== */
    const N_ROOT = 6;
    for (let i = 0; i < N_ROOT; i++) {
      const a = (i / N_ROOT) * TAU + R() * 0.5;
      const pts = [];
      const len = 0.32 + R() * 0.17;
      for (let k = 0; k <= 7; k++) {
        const t = k / 7;
        const r = lerp(0.135, len, Math.pow(t, 0.75));
        const y = 0.055 * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (1 - t * 0.85) + 0.004;
        const wob = Math.sin(t * 2.2 + a * 2) * 0.024;
        pts.push(new T.Vector3(
          base.x + Math.cos(a) * r + Math.cos(a + 1.57) * wob,
          y,
          base.z + Math.sin(a) * r + Math.sin(a + 1.57) * wob
        ));
      }
      branchGeos.push(colored(tubeGeo(pts, (t) => lerp(0.078, 0.012, Math.pow(t, 0.62)), 10, true), 0x6b5340));
    }
/* ===== 2) 主干：贝塞尔 S 曲线 + 根部喇叭形加粗 ===== */
    const SN = 26;
    const trunkPts = [];
    const tp0 = new T.Vector3(base.x, 0, base.z);
    const tp1 = new T.Vector3(base.x + 0.075, TH * 0.36, base.z + 0.055);
    const tp2 = new T.Vector3(base.x - 0.055, TH * 0.72, base.z - 0.040);
    const tp3 = new T.Vector3(base.x + 0.030, TH, base.z + 0.015);
    for (let i = 0; i <= SN; i++) trunkPts.push(bezierPoint(tp0, tp1, tp2, tp3, i / SN));

    // 半径：底部喇叭 → 快速收细 → 梢部缓收（幂 <1 时前段掉得快，符合真树）
    const trunkR = (t) => lerp(0.172, 0.060, Math.pow(t, 0.58)) * (1 + 1.25 * Math.exp(-t * 8.5));
    branchGeos.push(colored(tubeGeo(trunkPts, trunkR, 26, false), 0x6d5541));

    // 主干切向缓存
    const trunkTan = [];
    for (let i = 0; i <= SN; i++) {
      const a = trunkPts[Math.max(0, i - 1)];
      const b = trunkPts[Math.min(SN, i + 1)];
      trunkTan.push(new T.Vector3().subVectors(b, a).normalize());
    }
    const rAt = (idx) => trunkR(idx / SN);

    /* ===== 3) 递归长枝（L-system 思路：黄金角 + 长度衰减 + 半径连续） ===== */
    function grow(start, parentDir, azimuth, len, depth, r0, bias) {
      // 垂枝伞形：主枝先上扬、再平展，末级枝条大幅下垂（垂枝樱的形态）
      const o = (depth === 0)
        ? { spreadH: 0.86 + R() * 0.12, spreadV: 0.92 + R() * 0.14, droop: 0.40 + R() * 0.12,
            inherit: 0.50, steps: 18 }
        : (depth === 1)
        ? { spreadH: 0.98 + R() * 0.12, spreadV: 0.60 + R() * 0.14, droop: 0.88 + R() * 0.18,
            inherit: 0.55, steps: 13 }
        : { spreadH: 1.00 + R() * 0.10, spreadV: 0.16 + R() * 0.10, droop: 1.12 + R() * 0.22,
            inherit: 0.62, steps: 9 };
      const isTwig = depth >= 2;
      const br = makeBranch(start, parentDir, azimuth, len, o);

      // 半径：父枝局部半径的 0.62~0.72 → 分叉处粗细连续
      const ratio = 0.62 + R() * 0.10;
      const rr0 = Math.max(0.0042, r0 * ratio);
      const rr1 = rr0 * (0.20 + R() * 0.12);
      const rFn = (t) => lerp(rr0, rr1, Math.pow(t, 0.68));
      const radial = depth === 0 ? 14 : (depth === 1 ? 10 : (depth === 2 ? 7 : 5));

      branchGeos.push(colored(
        tubeGeo(br.pts, rFn, radial, depth >= 2),
        depth === 0 ? 0x68513e : (depth === 1 ? 0x664f3c : 0x6e5743)
      ));

      // 花朵：只在 depth>=2 的细枝上，权重压在枝梢
      if (depth >= 2) {
        // 记录细枝采样点（用于外壳补花的"支撑判定"）
        for (let q = 0; q < br.pts.length; q += 1) twigPts.push(br.pts[q]);
        const dens = depth === 2 ? 22.0 : 17.0;
        addBlossoms(br.pts, rFn, dens, depth === 2 ? 0.085 : 0.072,
                    2.15, depth === 2 ? 1.02 : 0.96, bias);
      }

      // 继续分叉
      if (depth < 3) {
        const nChild = depth === 0 ? 6 : (depth === 1 ? 4 : 3);
        for (let c = 0; c < nChild; c++) {
          // 沿枝位置：偏中后段（真实树的侧枝不长在最基部）
          const tt = 0.30 + (c / nChild) * 0.66 + R() * 0.05;
          const idx = Math.min(br.steps, Math.max(1, Math.round(tt * br.steps)));
          const sp = br.pts[idx].clone();
          // 该处切向
          const sa = br.pts[Math.max(0, idx - 1)];
          const sb = br.pts[Math.min(br.steps, idx + 1)];
          const tan = new T.Vector3().subVectors(sb, sa).normalize();
          // 黄金角螺旋排布 + 抖动
          const az = azimuth + GOLDEN * (c + 1) + (R() - 0.5) * 0.55;
          const len2 = len * (depth === 0 ? 0.82 : (depth === 1 ? 0.72 : 0.60)) * (0.82 + R() * 0.34);
          grow(sp, tan, az, len2, depth + 1, rFn(idx / br.steps), bias * (0.74 + R() * 0.5));
        }
      }
    }

    // 主枝：从主干不同高度发出，方位按黄金角错开
    const N_MAIN = 5;
    for (let i = 0; i < N_MAIN; i++) {
      const hRatio = 0.56 + (i / (N_MAIN - 1)) * 0.34 + (R() - 0.5) * 0.03;
      const idx = clamp(Math.round(hRatio * SN), 2, SN);
      const start = trunkPts[idx].clone();
      // 起点往主干内部收一点，接头埋在干体里
      const a0 = i * GOLDEN + R() * 0.35;
      start.x -= Math.cos(a0) * 0.045;
      start.z -= Math.sin(a0) * 0.045;

      const len = 1.16 + R() * 0.22;
      grow(start, trunkTan[idx], a0, len, 0, rAt(idx) * 0.78, 0.90 + R() * 0.22);
    }

    // 顶梢：几根向上收拢的短枝，封顶
    for (let i = 0; i < 4; i++) {
      const az = i * GOLDEN + R() * 0.4;
      grow(trunkPts[SN].clone(), trunkTan[SN], az, 0.50 + R() * 0.18, 1, rAt(SN) * 0.75, 0.85);
    }

    /* ===== 3.5) 垂枝「帘幕」：从冠缘垂下、层层错落的花帘 ===== */
    {
      const NB = 26;          // 角度分桶
      const N_RING = 3;       // 每桶最多几条（层层错落）
      const N_STRAND = 66;   // 总上限
      const cand = [];
      for (const p of twigPts) {
        const rad = Math.hypot(p.x - base.x, p.z - base.z);
        if (rad > 0.82 && p.y > TH + 0.18) cand.push(p);
      }
      const buckets = [];
      for (let i = 0; i < NB; i++) buckets.push([]);
      for (const p of cand) {
        const a = Math.atan2(p.z - base.z, p.x - base.x);
        const bi = Math.floor(((a + Math.PI) / TAU) * NB) % NB;
        buckets[bi].push(p);
      }
      // 每层垂长不同：越往外圈越短、内圈越长，形成前后层次
      const ROUND_DROP = [1.30, 2.00, 2.60, 2.95];
      let made = 0;
      for (let round = 0; round < N_RING && made < N_STRAND; round++) {
        for (let bi = 0; bi < NB && made < N_STRAND; bi++) {
          const list = buckets[bi];
          if (list.length <= round) continue;
          list.sort((A, B) => B.y - A.y);
          const anchor = list[round];
          if (!anchor) continue;
          const dx = anchor.x - base.x, dz = anchor.z - base.z;
          const rad = Math.max(0.001, Math.hypot(dx, dz));
          const ox = dx / rad, oz = dz / rad;
          // 垂长：基础分层 + 抖动，且最低点不低于草地
          let dropL = ROUND_DROP[round] + (R() - 0.5) * 0.5;
          dropL = Math.min(dropL, anchor.y - 0.30);
          const outL = 0.16 + R() * 0.26 * (1 - round * 0.15);
          const p0 = anchor.clone();
          // 给垂枝加一点切向微弧度，避免像垂直铅垂线一样僵直
          const tx = -oz, tz = ox;
          const sway = Math.sin(bi * 1.73 + round * 2.1) * 0.065 * dropL;
          const p3 = new T.Vector3(
            anchor.x + ox * (outL + 0.12) + tx * sway,
            anchor.y - dropL,
            anchor.z + oz * (outL + 0.12) + tz * sway
          );
          const p1 = new T.Vector3(anchor.x + ox * outL * 0.95, anchor.y + 0.08 + R() * 0.06, anchor.z + oz * outL * 0.95);
          const p2 = new T.Vector3(p3.x - ox * 0.04 - tx * sway * 0.45, p3.y + dropL * 0.46, p3.z - oz * 0.04 - tz * sway * 0.45);
          const pts = [];
          const ST = 12;
          for (let s = 0; s <= ST; s++) pts.push(bezierPoint(p0, p1, p2, p3, s / ST));
          const r0 = 0.009 + R() * 0.004, r1 = 0.002 + R() * 0.0014;
          const rFn = (t) => lerp(r0, r1, Math.pow(t, 0.72));
          branchGeos.push(colored(tubeGeo(pts, rFn, 5, false), 0x6d5541));
          addBlossoms(pts, rFn, 44, 0.066, 1.10, 0.74, 1.0, true);
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
      color: barkAlb ? new T.Color(0xe8dcc8) : 0xffffff,
      map: barkAlb || barkTex,
      normalMap: barkNrm || null,
      roughnessMap: barkRgh || null,
      aoMap: barkAo || null,
      aoMapIntensity: 0.90,
      bumpMap: barkTex,
      bumpScale: 0.55,
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: 0.0,
      flatShading: false,
    });
    if (barkNrm) { barkMat.normalScale.set(3.2, 3.2); barkMat.bumpScale = 0.09; }
    // 枝干跟着风摆（与花朵同一风场，因此花不会被甩开）
    barkMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = TREE_WIND.uTime;
      sh.uniforms.uWind = TREE_WIND.uWind;
      sh.uniforms.uWindDir = TREE_WIND.uWindDir;
      sh.uniforms.uGust = TREE_WIND.uGust;
      sh.vertexShader = WIND_FIELD_GLSL + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed += sakuraWind( position );`
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
      rx: mX * 1.28, ry: mY * 0.82, rz: mZ * 1.28,
    };
    const TARGET_N = Math.round(blossomSpots.length * 0.96);

    // 细枝点空间网格：快速判断一个补花点附近有没有枝条
    const CELL = 0.22;
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
      const rrMax = 0.86 + bump * 0.12;
      const rr = 0.50 + Math.cbrt(R()) * (rrMax - 0.50);

      // ★ 成团：只在噪声高的方向堆花，低的方向留空
      const clumpF = smoothstep(-0.30, 0.42, bump);
      if (R() > 0.30 + clumpF * 0.70) continue;

      let x = CROWN.cx + ux * rr * CROWN.rx;
      let y = CROWN.cy + uy * rr * CROWN.ry;
      let z = CROWN.cz + uz * rr * CROWN.rz;
      if (y < TH * 0.62 || y > mTop * 1.02) continue;   // 限制在树冠高度内

      // 避让树干
      const dx = x - CROWN.cx, dz = z - CROWN.cz;
      const dT = Math.hypot(dx, dz);
      if (y < TH * 1.05 && dT < 0.24) continue;

      // ★ 支撑判定：离最近细枝超过阈值就不生成，避免"没有枝条托着的悬空花瓣"
      if (minDistToTwig(x, y, z) > 0.32) continue;

      blossomSpots.push({
        p: new T.Vector3(x, y, z),
        rx: (R() - 0.5) * 1.7, ry: R() * TAU, rz: (R() - 0.5) * 1.7,
        scale: 1.04 * (0.45 + R() * 0.85),
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

           // ★ 树冠体积光影 (Canopy AO + 花团云朵层次)：内层与底部压出暖紫粉暗部，外冠与顶部通透亮泽
           vec3 cRel = ( vBWPos - vec3( 0.20, 4.35, -0.55 ) ) / vec3( 3.45, 2.55, 3.45 );
           float cRad = length( cRel );
           float shellAO = smoothstep( 0.16, 0.88, cRad ) * ( 0.62 + 0.38 * smoothstep( -0.75, 0.65, cRel.y ) );
           // ~1.1m 尺度的花团云块起伏，让大树冠分出饱满的团块结构
           float clumpWave = 0.5 + 0.5 * (
             sin( vBWPos.x * 2.25 + vBWPos.y * 1.6 ) * cos( vBWPos.z * 2.25 - vBWPos.y * 1.4 ) * 0.65 +
             sin( vBWPos.x * 4.6 - vBWPos.z * 3.8 ) * 0.35
           );
           float occ = clamp( shellAO * ( 0.78 + 0.32 * clumpWave ), 0.0, 1.0 );
           vec3 innerTint = vec3( 0.83, 0.62, 0.74 );   // 树冠深处暖紫粉暗部
           vec3 outerTint = vec3( 1.06, 0.99, 0.98 );   // 树冠外缘柔亮粉白
           c *= mix( innerTint, outerTint, occ );

           diffuseColor.rgb *= c;
         }`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
         {
           // 次表面透光 (SSS) + 树冠迎光金粉镶边
           vec3 Nw = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
           vec3 Vw = normalize( cameraPosition - vBWPos );
           vec3 cRel = ( vBWPos - vec3( 0.20, 4.35, -0.55 ) ) / vec3( 3.45, 2.55, 3.45 );
           vec3 domeDir = normalize( cRel + vec3( 0.0, 0.35, 0.0 ) );
           float domeSun = pow( clamp( dot( domeDir, normalize( uSunDir ) ) * 0.5 + 0.5, 0.0, 1.0 ), 1.6 );
           float outerShell = smoothstep( 0.30, 0.95, length( cRel ) );
           float rim  = pow( clamp( 1.0 - abs( dot( Nw, Vw ) ), 0.0, 1.0 ), 1.8 );
           float back = pow( clamp( dot( -Nw, uSunDir ), 0.0, 1.0 ), 1.15 );
           vec3 sssCol = mix( uC1, vec3( 1.0, 0.92, 0.86 ), 0.55 * domeSun );
           float sss = ( rim * 0.055 + back * 0.065 + domeSun * outerShell * 0.048 ) * uSSS * ( 0.75 + 0.40 * vBRand );
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

  // 整体放大：以树根为中心等比缩放，底部保持在 y=0
  const TREE_SCALE = 1.98;
  treeGroup.scale.setScalar(TREE_SCALE);

  PROG(42, '生长枝干');
  await yieldFrame();

  buildBlossoms();          // 2 万多朵花的实例化（较重）
  regInst(blossomMesh, 'blossom');

  /* ---------- 8b. 树枝小灯笼（和纸圆润提灯 + 竹骨渐变 + 暖金吊绳 + 随风同摆） ---------- */
  const lanternMats = [];
  const lanternGroups = [];
  function buildLanterns() {
    // 挑选树冠中下层（局部 y ∈ [1.55, 2.48] 中偏下沿）的细枝采样点，让灯笼垂在枝干分叉下方的通透空间
    const pool = twigPts.filter(p => p.y > 1.55 && p.y < 2.48);
    pool.sort((a, b) => a.y - b.y);
    const cands = pool.slice(0, Math.max(40, Math.floor(pool.length * 0.55)));
    if (!cands.length) return;
    const picks = [];
    const MIN_D = 0.52;
    let guard = 0;
    while (picks.length < 9 && guard < 4000) {
      guard++;
      const p = cands[Math.floor(R() * cands.length)];
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
    // 吊绳加粗并带暖金受光感，远景也能清晰看出灯笼是挂在枝头的
    const cordMat = new T.MeshStandardMaterial({
      color: 0xd8a868, emissive: 0x8c5822, emissiveIntensity: 0.58, roughness: 0.75, metalness: 0,
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
      const drop = 0.28 + R() * 0.14;
      const R0 = 0.046 + R() * 0.012;
      const H = 0.102 + R() * 0.024;

      // 吊绳（上端直接连到枝条采样点）
      const cord = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, drop, 6), cordMat);
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