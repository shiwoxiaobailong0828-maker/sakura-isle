
  /* ---------- 9. 簇状多段弧面风格化草坪（Pixar/Blender 团簇生长 + 草根深邃 AO + 护根草丛） ---------- */
  const grassUniforms = { uTime: { value: 0 }, uWind: { value: 1.0 }, uWindDir: windUniforms.uWindDir, uGust: windUniforms.uGust };
  function buildGrass() {
    // 一簇丰满的 3D 弧面草丛：8 片多段弯曲宽叶片（每片 3 段 7 顶点 + 横向微折立体脊线，饱满厚实告别稀疏针刺感）
    const pos = [], col = [], idx = [], nor = [];
    const BLADES = 8;
    const SEGS = 3;
    let vo = 0;
    for (let b = 0; b < BLADES; b++) {
      const isCenter = b < 3;
      const a = (b / BLADES) * TAU + (b % 2) * 0.24 + (isCenter ? 0.12 : 0);
      const ca = Math.cos(a), sa = Math.sin(a);
      // 加宽叶片与簇幅，让相邻草簇自然交叠成丰茂的 Pixar 绒感草坪
      const wBase = isCenter ? 0.0225 : 0.0205;
      const hBlade = isCenter ? (0.165 + 0.026 * (b % 3)) : (0.125 + 0.024 * (b % 3));
      const leanMax = isCenter ? (0.032 + 0.014 * b) : (0.062 + 0.020 * (b % 3));
      const v0 = 0.88 + 0.12 * (b / BLADES);

      for (let s = 0; s <= SEGS; s++) {
        const u = s / SEGS; // 0=草根, 1=叶尖
        // 弧线生长：下部挺立，中上部自然向外弯曲下垂
        const rOut = leanMax * Math.pow(u, 1.55);
        const y = hBlade * (u - 0.10 * Math.pow(u, 2.4));
        const cx = ca * rOut;
        const cz = sa * rOut;
        // 叶片沿高度收窄，横向带轻微立体拱脊
        const w = wBase * (1.0 - 0.72 * Math.pow(u, 1.35));
        const ridge = w * 0.22 * (1.0 - u * 0.5);

        // 草根深翠(内置 Ground AO) -> 草腰鲜活春绿 -> 叶尖迎光暖黄绿(Pixar 色彩层次)
        let cr, cg, cb;
        if (u < 0.45) {
          const k = u / 0.45;
          cr = lerp(0.20, 0.44, k) * v0;
          cg = lerp(0.36, 0.72, k) * v0;
          cb = lerp(0.13, 0.24, k) * v0;
        } else {
          const k = (u - 0.45) / 0.55;
          cr = lerp(0.44, 0.96, k) * v0;
          cg = lerp(0.72, 1.16, k) * v0;
          cb = lerp(0.24, 0.48, k) * v0;
        }

        // 切向法线：随叶片弯曲自然上仰，捕捉柔和天光与夕阳透射
        const nx = ca * (0.22 + 0.35 * u);
        const ny = 0.92 - 0.18 * u;
        const nz = sa * (0.22 + 0.35 * u);

        if (s < SEGS) {
          // 左右双顶点
          pos.push(cx - w * sa + ca * ridge, y, cz + w * ca + sa * ridge);
          pos.push(cx + w * sa + ca * ridge, y, cz - w * ca + sa * ridge);
          col.push(cr, cg, cb, cr, cg, cb);
          nor.push(nx, ny, nz, nx, ny, nz);
        } else {
          // 柔和收束的叶尖顶点
          pos.push(cx + ca * ridge, y, cz + sa * ridge);
          col.push(cr, cg, cb);
          nor.push(nx, ny, nz);
        }
      }
      // 组装 3 段叶片网格（前 2 段为四边形，顶段为收尖三角形）
      for (let s = 0; s < SEGS - 1; s++) {
        const r0 = vo + s * 2;
        const r1 = r0 + 2;
        idx.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1);
      }
      const rLast = vo + (SEGS - 1) * 2;
      const rTip = vo + (SEGS - 1) * 2 + 2;
      idx.push(rLast, rLast + 1, rTip);
      vo += (SEGS - 1) * 2 + 3;
    }

    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    sanitize(geo);

    const COUNT = 15200;
    const mat = new T.MeshStandardMaterial({
      vertexColors: true, side: T.DoubleSide, roughness: 0.76, metalness: 0, envMapIntensity: 0.38,
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = grassUniforms.uTime;
      sh.uniforms.uWind = grassUniforms.uWind;
      sh.uniforms.uWindDir = grassUniforms.uWindDir;
      sh.uniforms.uGust = grassUniforms.uGust;
      sh.vertexShader = `uniform float uTime; uniform float uWind; uniform float uGust;\n        uniform vec2 uWindDir;\n        varying float vGrassH;\n        varying vec3 vGrassWPos;\n` +
        sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           {
             vec4 wp = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
             float hh = clamp(position.y / 0.15, 0.0, 1.0);
             vGrassH = hh;
             // 二次曲线柔顺风摆：草根稳固抓地，叶梢随风柔波起伏
             float bendCurve = hh * hh;
             float wave = sin(uTime * 1.15 + wp.x * 0.9 + wp.z * 0.7) * 0.5 + 0.5;
             float gust = sin(uTime * 0.55 + wp.x * 0.35) * 0.5 + 0.5;
             float bend = (wave * 0.45 + gust * 0.55) * (0.078 + uGust * 0.055) * bendCurve * uWind;
             transformed.x += uWindDir.x * bend - uWindDir.y * bend * 0.18;
             transformed.z += uWindDir.y * bend + uWindDir.x * bend * 0.18;
             transformed.y -= abs(bend) * 0.28 * bendCurve;
             vGrassWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
           }`
        );
      sh.fragmentShader = `varying float vGrassH;\n        varying vec3 vGrassWPos;\n` +
        sh.fragmentShader.replace(
          '#include <dithering_fragment>',
          `{
             // 草根接触阴影 AO 与叶尖温暖夕阳透光感 (Pixar Subsurface Glow)
             float rootAO = mix(0.62, 1.0, smoothstep(0.0, 0.38, vGrassH));
             gl_FragColor.rgb *= rootAO;
             float tipGlow = smoothstep(0.45, 1.0, vGrassH);
             gl_FragColor.rgb += vec3(0.08, 0.07, 0.02) * tipGlow;
           }
           #include <dithering_fragment>`
        );
    };
    const inst = new T.InstancedMesh(geo, mat, COUNT);
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.frustumCulled = false;

    // 预生成自然草簇核心点（包含：1. 树根凹槽护根草簇 2. 长椅脚与景石伴生草簇 3. 草坪宽幅有机团簇）
    const srG = rng(40821);
    const clumpCenters = [];
    // 1) 环绕 9 条粗壮树根凹槽的护根丰茂草簇（让树根与草地无缝咬合）
    for (let k = 0; k < 24; k++) {
      const ang = (k / 24) * TAU + 0.18 + (srG() - 0.5) * 0.12;
      const rad = 0.48 + (k % 3) * 0.28 + srG() * 0.22;
      clumpCenters.push({
        x: TREE_BASE_XZ.x + Math.cos(ang) * rad,
        z: TREE_BASE_XZ.z + Math.sin(ang) * rrFrom(rad),
        r: 0.48 + srG() * 0.28,
        hBoost: 1.22 + srG() * 0.26,
      });
    }
    function rrFrom(v) { return v; }
    // 2) 环绕长椅四周与支脚的温馨伴生草簇
    const benchOffsets = [
      [-0.82, 0.22], [0.82, 0.22], [-0.85, -0.22], [0.85, -0.22],
      [-0.45, -0.32], [0.45, -0.32], [-0.95, 0.0], [0.95, 0.0],
    ];
    for (const bo of benchOffsets) {
      clumpCenters.push({
        x: -0.56 + bo[0],
        z: 0.62 + bo[1],
        r: 0.45 + srG() * 0.22,
        hBoost: 1.12 + srG() * 0.20,
      });
    }
    // 3) 全岛自然分布的宽幅草簇群落（半径 0.65~1.25m，彼此柔和交叠，消除秃斑）
    let cGuard = 0;
    while (clumpCenters.length < 110 && cGuard < 900) {
      cGuard++;
      const a = srG() * TAU;
      const rr = 0.65 + Math.sqrt(srG()) * (WORLD.islandR - 0.75);
      const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
      if (Math.hypot(cx - 1.25, cz - 1.75) < 0.65) continue;
      clumpCenters.push({
        x: cx, z: cz,
        r: 0.68 + srG() * 0.55,
        hBoost: 1.12 + srG() * 0.36,
      });
    }

    const dummy = new T.Object3D();
    const c = new T.Color();
    let i = 0, guard = 0;
    while (i < COUNT && guard < COUNT * 14) {
      guard++;
      let x, z, clumpBoost = 1.0;
      // 45% 采样自宽幅草簇群落，55% 全岛满铺基底并受 islandClumpField 起伏调制（既保证全岛丰满绿茵，又具成簇高低起伏层次）
      if (R() < 0.45 && clumpCenters.length > 0) {
        const cc = clumpCenters[Math.floor(R() * clumpCenters.length)];
        const ca = R() * TAU;
        const uRad = Math.sqrt(R());
        const cr = uRad * cc.r;
        x = cc.x + Math.cos(ca) * cr;
        z = cc.z + Math.sin(ca) * cr;
        clumpBoost = lerp(cc.hBoost, 0.82, uRad);
      } else {
        const a = R() * TAU;
        const rr = Math.sqrt(R()) * (WORLD.islandR - 0.06);
        x = Math.cos(a) * rr;
        z = Math.sin(a) * rr;
        const cf = islandClumpField(x, z);
        clumpBoost = 0.78 + cf * 0.56;
      }

      const rr = Math.hypot(x, z);
      const th = Math.atan2(z, x);
      const edge = 1 + 0.018 * fbm(Math.cos(th) * 2.2, 0.7, Math.sin(th) * 2.2, 2)
                     + 0.038 * Math.sin(th * 7.0 + 1.3)
                     + 0.023 * Math.sin(th * 13.0 + 0.7);
      if (rr > WORLD.islandR * edge - 0.08) continue;

      // 树干正中心留空，但允许丰茂草簇深入到树根分叉凹槽中（dTree >= 0.34）
      const dxT = x - TREE_BASE_XZ.x, dzT = z - TREE_BASE_XZ.z;
      const dTree = Math.hypot(dxT, dzT);
      const angT = Math.atan2(dzT, dxT);
      const inRootHollow = Math.cos(angT * 9.0 + 0.35) < 0.22;
      if (dTree < (inRootHollow ? 0.34 : 0.48)) continue;

      // 木长椅正下方留出柔和腐殖土与接触阴影，长椅正前方压低草叶高度以避免遮挡长椅支脚与下沿
      const bx = x - (-0.56), bz = z - 0.62;
      const lbx = bx * Math.cos(-0.15) - bz * Math.sin(-0.15);
      const lbz = bx * Math.sin(-0.15) + bz * Math.cos(-0.15);
      if (Math.abs(lbx) < 0.50 && Math.abs(lbz) < 0.20) continue;
      if (Math.abs(lbx) < 0.72 && lbz >= -0.22 && lbz < 0.62) {
        clumpBoost *= 0.45;
      }

      // 野餐垫区域留空（计入草簇半径 0.14m，确保草叶紧贴野餐垫滚边生长而不刺穿布面）
      const px = x - 1.25, pz = z - 1.75;
      const lpx = px * Math.cos(-0.32) - pz * Math.sin(-0.32);
      const lpz = px * Math.sin(-0.32) + pz * Math.cos(-0.32);
      if (Math.abs(lpx) < 0.60 && Math.abs(lpz) < 0.46) continue;
      // 野餐垫四周与前方视线缓冲带压低草高，让圆角格纹野餐垫、樱饼托盘与藤篮清晰呈现
      if (Math.abs(lpx) < 0.92 && lpz > -0.55 && lpz < 0.95) {
        clumpBoost *= 0.44;
      }

      // 严格采样包含树根土丘的真实地表高度，彻底杜绝草叶浮空或下陷
      const y = islandHeightAt(x, z);
      const s = (0.82 + R() * 0.62) * clumpBoost;
      dummy.position.set(x, y - 0.008, z);
      dummy.rotation.set((R() - 0.5) * 0.26, R() * TAU, (R() - 0.5) * 0.26);
      dummy.scale.set(s * (0.95 + R() * 0.32), s * (0.85 + R() * 0.48), s * (0.95 + R() * 0.32));
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);

      // 鲜亮柔和的 Pixar 春日草坪色板：团簇中心微偏翠绿，迎光处偏暖黄绿
      const k = fbm(x * 2.0 + 9, 0.5, z * 2.0, 2);
      c.setHSL(0.258 + k * 0.034, 0.48 + k * 0.12, 0.47 + R() * 0.13);
      inst.setColorAt(i, c);
      i++;
    }
    inst.count = i;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    islandGroup.add(inst);
    return inst;
  }
  const grassMesh = buildGrass();
  regInst(grassMesh, 'grass');

  /* ---------- 10. 结实厚木倒角公园长椅（Thick Beveled Planks + 阳光倒角高光 + 铆钉细节 + 深度接地阴影） ---------- */
  function buildBench() {
    const g = new T.Group();

    // 构造带精致四边倒角(Bevels)与微拱弧度的厚实木板几何体：倒角切面能自然捕捉夕阳温暖高光边
    function makeBeveledPlankGeo(w, h, d, bev, topArchY = 0) {
      const NX = 14;
      const hx = w * 0.5, hy = h * 0.5, hz = d * 0.5;
      const b = Math.min(bev, hy * 0.45, hz * 0.45);
      // 截面 8 点倒角轮廓（逆时针）
      const prof = [
        { y:  hy,     z: -hz + b, ny:  1.0,   nz:  0.0 },
        { y:  hy,     z:  hz - b, ny:  1.0,   nz:  0.0 },
        { y:  hy - b, z:  hz,     ny:  0.707, nz:  0.707 },
        { y: -hy + b, z:  hz,     ny:  0.0,   nz:  1.0 },
        { y: -hy,     z:  hz - b, ny: -0.707, nz:  0.707 },
        { y: -hy,     z: -hz + b, ny: -1.0,   nz:  0.0 },
        { y: -hy + b, z: -hz,     ny: -0.707, nz: -0.707 },
        { y:  hy - b, z: -hz,     ny:  0.0,   nz: -1.0 },
        { y:  hy,     z: -hz + b, ny:  0.707, nz: -0.707 },
      ];
      const NP = prof.length;
      const pos = [], nor = [], col = [], idx = [];
      for (let ix = 0; ix <= NX; ix++) {
        const u = ix / NX;
        const s = u * 2.0 - 1.0; // -1 .. +1
        // 两端也做微倒角收束
        const endTap = (ix === 0 || ix === NX) ? 0.86 : 1.0;
        const x = s * hx;
        const arch = (1.0 - s * s) * topArchY;
        // 木纹明暗微变化与两端轻微环境光遮蔽
        const grain = 0.94 + 0.06 * Math.sin(u * Math.PI * 5.0);
        const endAO = lerp(0.84, 1.0, Math.sin(u * Math.PI));
        for (let ip = 0; ip < NP; ip++) {
          const P = prof[ip];
          const py = P.y * endTap + (P.y > 0 ? arch : arch * 0.35);
          const pz = P.z * endTap;
          pos.push(x, py, pz);
          const nx = (ix === 0) ? -0.35 : (ix === NX ? 0.35 : 0.0);
          const len = Math.hypot(nx, P.ny, P.nz) || 1;
          nor.push(nx / len, P.ny / len, P.nz / len);
          // 倒角高光边略亮、底面内置接触 AO
          const bevBoost = (P.ny > 0.5 && Math.abs(P.nz) > 0.3) ? 1.12 : (P.ny < -0.5 ? 0.72 : 1.0);
          const v = grain * endAO * bevBoost;
          col.push(v, v, v);
        }
      }
      for (let ix = 0; ix < NX; ix++) {
        for (let ip = 0; ip < NP - 1; ip++) {
          const a = ix * NP + ip;
          const b0 = a + 1;
          const c = (ix + 1) * NP + ip;
          const d0 = c + 1;
          idx.push(a, c, b0, b0, c, d0);
        }
      }
      // 左右端盖封口
      for (const isRight of [false, true]) {
        const baseOff = isRight ? NX * NP : 0;
        const centerIdx = pos.length / 3;
        pos.push(isRight ? hx : -hx, 0, 0);
        nor.push(isRight ? 1 : -1, 0, 0);
        col.push(0.82, 0.82, 0.82);
        for (let ip = 0; ip < NP - 1; ip++) {
          if (isRight) idx.push(centerIdx, baseOff + ip, baseOff + ip + 1);
          else idx.push(centerIdx, baseOff + ip + 1, baseOff + ip);
        }
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
      geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      return geo;
    }

    // 温暖厚实的胡桃/柚木色板（带倒角高光反射，捕捉夕阳暖金边缘光）
    const makeWoodMat = (hex, rgh) => {
      const m = new T.MeshStandardMaterial({
        color: hex, vertexColors: true, roughness: rgh, metalness: 0.04, envMapIntensity: 0.46,
      });
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = 'varying vec3 vWoodWPos;\nvarying vec3 vWoodWNor;\n' + sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vWoodWPos = (modelMatrix * vec4(position, 1.0)).xyz;
           vWoodWNor = normalize(mat3(modelMatrix) * objectNormal);`
        );
        sh.fragmentShader = 'varying vec3 vWoodWPos;\nvarying vec3 vWoodWNor;\n' + sh.fragmentShader.replace(
          '#include <dithering_fragment>',
          `{
             // 细腻纵向木纹肌理 + 倒角边缘捕捉温暖夕阳高光 (Warm Bevel Rim Catch)
             float grain = sin(vWoodWPos.x * 42.0 + sin(vWoodWPos.z * 18.0) * 2.5) * 0.045;
             vec3 N = normalize(vWoodWNor);
             vec3 sunL = normalize(vec3(0.55, 0.65, 0.52));
             float bevelCatch = pow(clamp(dot(N, sunL), 0.0, 1.0), 3.2) * smoothstep(0.2, 0.9, N.y);
             gl_FragColor.rgb *= (1.0 + grain);
             gl_FragColor.rgb += vec3(0.26, 0.16, 0.08) * bevelCatch;
           }
           #include <dithering_fragment>`
        );
      };
      return m;
    };
    const woodMats = [
      makeWoodMat(0x845c3f, 0.56),
      makeWoodMat(0x916748, 0.52),
      makeWoodMat(0x765137, 0.60),
    ];
    const ironMat  = new T.MeshStandardMaterial({ color: 0x22262b, roughness: 0.38, metalness: 0.78, envMapIntensity: 0.52 });
    const ironMat2 = new T.MeshStandardMaterial({ color: 0x2c3238, roughness: 0.34, metalness: 0.82, envMapIntensity: 0.55 });
    const boltMat  = new T.MeshStandardMaterial({ color: 0xb8864b, roughness: 0.32, metalness: 0.85 });

    const W = 1.24;          // 座宽
    const D = 0.38;          // 座深
    const SEAT_Y = 0.29;

    const box = (w, h, d, mat) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    };

    // ---- 座面：5 根厚实带倒角的实木长条（Thick Beveled Planks），消除单薄纸片感 ----
    const slatN = 5;
    const slatStep = (D - 0.012) / slatN;
    const seatPlankGeo = makeBeveledPlankGeo(W, 0.028, slatStep * 0.86, 0.0055, 0.0);
    const boltGeo = new T.CylinderGeometry(0.0055, 0.0055, 0.006, 8);
    for (let i = 0; i < slatN; i++) {
      const u = i / (slatN - 1);
      const zz = -D / 2 + slatStep * (i + 0.5);
      const curveY = -0.011 * Math.sin(u * Math.PI * 0.85) + (u > 0.78 ? -0.007 : 0);
      const tiltX = (u - 0.35) * 0.15;
      const s = new T.Mesh(seatPlankGeo, woodMats[i % 3]);
      s.position.set(0, SEAT_Y + curveY, zz);
      s.rotation.x = tiltX;
      s.castShadow = true; s.receiveShadow = true;
      g.add(s);

      // 每块厚木板与铸铁龙骨连接处的黄铜圆头铆钉细节
      for (const sx of [-1, 0, 1]) {
        const bMesh = new T.Mesh(boltGeo, boltMat);
        bMesh.position.set(sx * (W / 2 - 0.075), SEAT_Y + curveY + 0.014, zz);
        bMesh.rotation.x = tiltX;
        g.add(bMesh);
      }
    }

    // 座面下方的三道厚重弧形铸铁承托梁（左、中、右）
    for (const sx of [-1, 0, 1]) {
      const xPos = sx * (W / 2 - 0.075);
      const rail = box(0.028, 0.030, D - 0.02, ironMat);
      rail.position.set(xPos, SEAT_Y - 0.022, 0);
      g.add(rail);
    }

    // ---- 靠背：三根铸铁后倾肋柱 + 4 根厚实带倒角横木板（顶板微拱冠木） ----
    const BACK_TILT = 0.19;
    const backH = 0.45;
    for (const sx of [-1, 0, 1]) {
      const xPos = sx * (W / 2 - 0.075);
      const post = new T.Mesh(new T.CylinderGeometry(0.015, 0.019, backH, 10), ironMat);
      post.position.set(xPos, SEAT_Y + backH / 2 - 0.01, -D / 2 - 0.020 - Math.sin(BACK_TILT) * (backH * 0.45));
      post.rotation.x = BACK_TILT;
      post.castShadow = true;
      g.add(post);
      if (sx !== 0) {
        const finial = new T.Mesh(new T.SphereGeometry(0.022, 10, 8), ironMat2);
        finial.position.set(xPos, SEAT_Y + backH - 0.004, -D / 2 - 0.020 - Math.sin(BACK_TILT) * (backH * 0.92));
        g.add(finial);
      }
    }

    const backSlatN = 4;
    const backPlankGeo = makeBeveledPlankGeo(W - 0.02, 0.062, 0.028, 0.0055, 0.0);
    const topPlankGeo  = makeBeveledPlankGeo(W + 0.01, 0.072, 0.032, 0.0065, 0.024);
    for (let i = 0; i < backSlatN; i++) {
      const yy = SEAT_Y + 0.095 + i * 0.102;
      const zz = -D / 2 - 0.016 - Math.sin(BACK_TILT) * (yy - SEAT_Y);
      const isTop = (i === backSlatN - 1);
      const slat = new T.Mesh(isTop ? topPlankGeo : backPlankGeo, woodMats[(i + 1) % 3]);
      slat.position.set(0, yy, zz);
      slat.rotation.x = BACK_TILT;
      slat.castShadow = true; slat.receiveShadow = true;
      g.add(slat);

      for (const sx of [-1, 0, 1]) {
        const bMesh = new T.Mesh(boltGeo, boltMat);
        bMesh.position.set(sx * (W / 2 - 0.075), yy, zz + 0.015);
        bMesh.rotation.x = BACK_TILT + Math.PI / 2;
        g.add(bMesh);
      }
    }

    // ---- 两侧厚重卷曲铸铁扶手 + 厚实倒角木质护手板 ----
    const armPadGeo = makeBeveledPlankGeo(0.048, 0.024, D * 0.72, 0.0045, 0.0);
    armPadGeo.rotateY(Math.PI / 2);
    for (const sx of [-1, 1]) {
      const xArm = sx * (W / 2 - 0.055);
      const armY = SEAT_Y + 0.195;
      const p0 = new T.Vector3(xArm, armY + 0.02, -D / 2 - 0.04);
      const p1 = new T.Vector3(xArm + sx * 0.014, armY + 0.026, -0.02);
      const p2 = new T.Vector3(xArm + sx * 0.012, armY + 0.006, D / 2 - 0.01);
      const p3 = new T.Vector3(xArm, SEAT_Y - 0.01, D / 2 - 0.050);
      const armPts = [];
      for (let s = 0; s <= 18; s++) armPts.push(bezierPoint(p0, p1, p2, p3, s / 18));
      const armMesh = new T.Mesh(tubeGeo(armPts, () => 0.0155, 10, true), ironMat2);
      armMesh.castShadow = true;
      g.add(armMesh);

      const woodPad = new T.Mesh(armPadGeo, woodMats[0]);
      woodPad.position.set(xArm + sx * 0.008, armY + 0.020, -0.02);
      woodPad.rotation.x = 0.04;
      woodPad.castShadow = true; woodPad.receiveShadow = true;
      g.add(woodPad);
    }

    // ---- 六条结实外撇弧形铸铁支腿（左、中、右三组） + 宽厚抓地圆盘脚垫 ----
    const legH = SEAT_Y - 0.012;
    for (const sx of [-1, 0, 1]) {
      for (const sz of [-1, 1]) {
        const lx = sx * (W / 2 - 0.075);
        const lz = sz * (D / 2 - 0.055);
        const lp0 = new T.Vector3(lx, SEAT_Y - 0.012, lz);
        const lp1 = new T.Vector3(lx, legH * 0.55, lz + sz * 0.012);
        const lp2 = new T.Vector3(lx + sx * 0.014, legH * 0.22, lz + sz * 0.026);
        const lp3 = new T.Vector3(lx + sx * 0.020, -0.012, lz + sz * 0.036);
        const legPts = [];
        for (let s = 0; s <= 10; s++) legPts.push(bezierPoint(lp0, lp1, lp2, lp3, s / 10));
        const rBase = sx === 0 ? 0.015 : 0.0185;
        const leg = new T.Mesh(tubeGeo(legPts, (t) => lerp(rBase, rBase * 0.78, t), 10, true), ironMat);
        leg.castShadow = true;
        g.add(leg);
        const foot = new T.Mesh(new T.CylinderGeometry(0.026, 0.032, 0.016, 12), ironMat2);
        foot.position.set(lp3.x, -0.006, lp3.z);
        g.add(foot);
      }
      if (sx !== 0) {
        const br = box(0.018, 0.018, D - 0.09, ironMat2);
        br.position.set(sx * (W / 2 - 0.075), 0.11, 0);
        g.add(br);
      }
    }
    const longBr = box(W - 0.12, 0.018, 0.020, ironMat2);
    longBr.position.set(0, 0.10, -0.02);
    g.add(longBr);

    // ---- 长椅底部软接触阴影层（Contact Shadow Pad，强化与草地泥土的深度 AO 融合） ----
    {
      const shGeo = new T.PlaneGeometry(W * 1.18, D * 1.55, 16, 12);
      shGeo.rotateX(-Math.PI / 2);
      const sp = shGeo.attributes.position;
      const sc = new Float32Array(sp.count * 4);
      for (let i = 0; i < sp.count; i++) {
        const x = sp.getX(i) / (W * 0.59);
        const z = sp.getZ(i) / (D * 0.775);
        const d = Math.hypot(Math.max(0, Math.abs(x) - 0.65) / 0.35, Math.max(0, Math.abs(z) - 0.45) / 0.55);
        const a = Math.pow(clamp(1.0 - d, 0, 1), 1.8) * 0.58;
        sc[i * 4] = 0.08; sc[i * 4 + 1] = 0.06; sc[i * 4 + 2] = 0.05; sc[i * 4 + 3] = a;
      }
      shGeo.setAttribute('color', new T.BufferAttribute(sc, 4));
      const shMat = new T.MeshBasicMaterial({
        vertexColors: true, transparent: true, depthWrite: false,
      });
      const shMesh = new T.Mesh(shGeo, shMat);
      shMesh.position.set(0, 0.003, 0);
      g.add(shMesh);
    }

    // ★ 摆位：直接采样长椅所在位置的真实地表高度，让六只脚垫稳稳扎根在泥土草坪中，绝不悬空
    const BX = -0.56, BZ = 0.62;
    const groundY = islandHeightAt(BX, BZ);
    g.position.set(BX, groundY, BZ);
    g.rotation.y = 0.15;
    g.scale.setScalar(1.36);
    islandGroup.add(g);
    return g;
  }
  const benchObj = buildBench();

  /* ---------- 11. 猫和狗 ---------- */
  // 通用：加一点毛色渐变（背深腹浅）
  function furMat(base, dark, rough) {
    const m = new T.MeshStandardMaterial({ color: base, roughness: rough === undefined ? 0.88 : rough });
    return m;
  }

  function makeCat() {
    const g = new T.Group();
    const fur   = new T.MeshStandardMaterial({ color: 0xd9813f, roughness: 0.90 });        // 橘
    const furD  = new T.MeshStandardMaterial({ color: 0xb8652c, roughness: 0.90 });        // 深橘（背脊）
    const cream = new T.MeshStandardMaterial({ color: 0xf7ecd9, roughness: 0.88 });        // 米白
    const pink  = new T.MeshStandardMaterial({ color: 0xe89aa4, roughness: 0.70 });
    const dark  = new T.MeshStandardMaterial({ color: 0x241d16, roughness: 0.42 });
    const white = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.20 });

    // 身体：胶囊横放，略微下沉
    const body = new T.Mesh(new T.CapsuleGeometry(0.088, 0.085, 6, 18), fur);
    body.rotation.x = Math.PI / 2;
    body.position.set(0, 0.088, 0);
    body.scale.set(1.0, 1.0, 0.92);
    body.castShadow = true; g.add(body);

    // 背脊深色
    const back = new T.Mesh(new T.SphereGeometry(0.081, 16, 12), furD);
    back.scale.set(0.92, 0.55, 1.35);
    back.position.set(0, 0.132, -0.006);
    back.castShadow = true; g.add(back);

    // 胸腹米白
    const chest = new T.Mesh(new T.SphereGeometry(0.062, 14, 12), cream);
    chest.scale.set(0.92, 0.90, 0.85);
    chest.position.set(0, 0.072, 0.082);
    g.add(chest);

    // 头：略扁的球
    const head = new T.Mesh(new T.SphereGeometry(0.070, 24, 18), fur);
    head.scale.set(1.10, 1.00, 0.96);
    head.position.set(0, 0.176, 0.098);
    head.castShadow = true; g.add(head);

    // 两侧脸颊（让脸圆润）
    for (const sx of [-1, 1]) {
      const cheek = new T.Mesh(new T.SphereGeometry(0.036, 14, 12), fur);
      cheek.scale.set(1.0, 0.88, 0.80);
      cheek.position.set(sx * 0.038, 0.158, 0.130);
      cheek.castShadow = true; g.add(cheek);
    }
    // 口鼻米白
    const muzzle = new T.Mesh(new T.SphereGeometry(0.033, 14, 12), cream);
    muzzle.scale.set(1.18, 0.80, 0.95);
    muzzle.position.set(0, 0.154, 0.150);
    g.add(muzzle);

    // 耳朵（三角锥，稍圆）
    for (const sx of [-1, 1]) {
      const ear = new T.Mesh(new T.ConeGeometry(0.030, 0.055, 5), fur);
      ear.position.set(sx * 0.045, 0.234, 0.092);
      ear.rotation.z = sx * 0.26;
      ear.rotation.x = -0.12;
      ear.castShadow = true; g.add(ear);
      // 耳内粉
      const inner = new T.Mesh(new T.ConeGeometry(0.018, 0.036, 5), pink);
      inner.position.set(sx * 0.046, 0.232, 0.100);
      inner.rotation.z = sx * 0.26;
      inner.rotation.x = -0.12;
      g.add(inner);
    }

    // 眼睛：黑球 + 白高光
    for (const sx of [-1, 1]) {
      const eye = new T.Mesh(new T.SphereGeometry(0.0125, 12, 10), dark);
      eye.position.set(sx * 0.028, 0.184, 0.158);
      g.add(eye);
      const hi = new T.Mesh(new T.SphereGeometry(0.0042, 6, 6), white);
      hi.position.set(sx * 0.024, 0.189, 0.168);
      g.add(hi);
    }
    // 鼻子
    const nose = new T.Mesh(new T.SphereGeometry(0.0078, 8, 6), pink);
    nose.scale.set(1.25, 0.9, 1.0);
    nose.position.set(0, 0.163, 0.176);
    g.add(nose);

    // 四条腿（胶囊）
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new T.Mesh(new T.CapsuleGeometry(0.017, 0.040, 4, 10), fur);
      leg.position.set(sx * 0.043, 0.038, sz * 0.055);
      leg.castShadow = true; g.add(leg);
      const paw = new T.Mesh(new T.SphereGeometry(0.019, 10, 8), cream);
      paw.scale.set(1.0, 0.72, 1.25);
      paw.position.set(sx * 0.043, 0.010, sz * 0.062);
      g.add(paw);
    }

    // 尾巴：向上弯的管
    const tc = new T.CatmullRomCurve3([
      new T.Vector3(0, 0.105, -0.115),
      new T.Vector3(0.012, 0.150, -0.185),
      new T.Vector3(0.045, 0.215, -0.205),
      new T.Vector3(0.075, 0.275, -0.170),
      new T.Vector3(0.070, 0.300, -0.120),
    ]);
    const tail = new T.Mesh(new T.TubeGeometry(tc, 20, 0.0165, 8, false), fur);
    tail.castShadow = true; g.add(tail);

    return g;
  }

  function makeDog() {
    const g = new T.Group();
    const fur   = new T.MeshStandardMaterial({ color: 0xdca862, roughness: 0.90 });        // 柴黄
    const furD  = new T.MeshStandardMaterial({ color: 0xbe8746, roughness: 0.90 });
    const cream = new T.MeshStandardMaterial({ color: 0xf9f0df, roughness: 0.88 });
    const dark  = new T.MeshStandardMaterial({ color: 0x201913, roughness: 0.42 });
    const white = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.20 });

    // 身体：略方一点的胶囊
    const body = new T.Mesh(new T.CapsuleGeometry(0.098, 0.100, 6, 18), fur);
    body.rotation.x = Math.PI / 2;
    body.position.set(0, 0.100, 0);
    body.scale.set(1.0, 1.0, 0.94);
    body.castShadow = true; g.add(body);

    // 背脊
    const back = new T.Mesh(new T.SphereGeometry(0.090, 16, 12), furD);
    back.scale.set(0.92, 0.55, 1.30);
    back.position.set(0, 0.148, -0.008);
    back.castShadow = true; g.add(back);

    // 胸腹米白
    const chest = new T.Mesh(new T.SphereGeometry(0.070, 14, 12), cream);
    chest.scale.set(0.92, 0.92, 0.82);
    chest.position.set(0, 0.082, 0.090);
    g.add(chest);

    // 头
    const head = new T.Mesh(new T.SphereGeometry(0.078, 24, 18), fur);
    head.scale.set(1.05, 1.00, 0.96);
    head.position.set(0, 0.202, 0.108);
    head.castShadow = true; g.add(head);

    // 脸颊
    for (const sx of [-1, 1]) {
      const cheek = new T.Mesh(new T.SphereGeometry(0.040, 14, 12), fur);
      cheek.scale.set(1.0, 0.90, 0.85);
      cheek.position.set(sx * 0.042, 0.186, 0.140);
      cheek.castShadow = true; g.add(cheek);
    }

    // 嘴套（米白，突出）
    const snout = new T.Mesh(new T.SphereGeometry(0.044, 16, 12), cream);
    snout.scale.set(1.10, 0.82, 1.18);
    snout.position.set(0, 0.178, 0.176);
    g.add(snout);
    // 鼻头
    const nose = new T.Mesh(new T.SphereGeometry(0.0105, 10, 8), dark);
    nose.scale.set(1.25, 0.95, 1.0);
    nose.position.set(0, 0.192, 0.212);
    g.add(nose);

    // 尖耳（直立三角）
    for (const sx of [-1, 1]) {
      const ear = new T.Mesh(new T.ConeGeometry(0.031, 0.066, 5), fur);
      ear.position.set(sx * 0.048, 0.274, 0.096);
      ear.rotation.z = sx * 0.12;
      ear.rotation.x = -0.10;
      ear.castShadow = true; g.add(ear);
      const inner = new T.Mesh(new T.ConeGeometry(0.017, 0.040, 5), cream);
      inner.position.set(sx * 0.048, 0.272, 0.104);
      inner.rotation.z = sx * 0.12;
      inner.rotation.x = -0.10;
      g.add(inner);
    }

    // 眼睛 + 高光
    for (const sx of [-1, 1]) {
      const eye = new T.Mesh(new T.SphereGeometry(0.0118, 12, 10), dark);
      eye.position.set(sx * 0.031, 0.212, 0.172);
      g.add(eye);
      const hi = new T.Mesh(new T.SphereGeometry(0.0040, 6, 6), white);
      hi.position.set(sx * 0.027, 0.217, 0.182);
      g.add(hi);
    }

    // 腿
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new T.Mesh(new T.CapsuleGeometry(0.020, 0.046, 4, 10), fur);
      leg.position.set(sx * 0.048, 0.042, sz * 0.060);
      leg.castShadow = true; g.add(leg);
      const paw = new T.Mesh(new T.SphereGeometry(0.022, 10, 8), cream);
      paw.scale.set(1.0, 0.72, 1.25);
      paw.position.set(sx * 0.048, 0.011, sz * 0.068);
      g.add(paw);
    }

    // 卷尾（柴犬招牌）
    const tc = new T.CatmullRomCurve3([
      new T.Vector3(0, 0.125, -0.120),
      new T.Vector3(0.010, 0.180, -0.195),
      new T.Vector3(0.048, 0.260, -0.190),
      new T.Vector3(0.082, 0.290, -0.135),
      new T.Vector3(0.062, 0.292, -0.078),
    ]);
    const tail = new T.Mesh(new T.TubeGeometry(tc, 22, 0.021, 8, false), fur);
    tail.castShadow = true; g.add(tail);
    const tip = new T.Mesh(new T.SphereGeometry(0.021, 10, 8), cream);
    tip.position.set(0.062, 0.292, -0.078);
    g.add(tip);

    return g;
  }

  // 猫狗已移除（用户要求），保留空数组以兼容动画循环
  const animals = [];
  /* ---------- 12. 飘落花瓣 ---------- */
  const petalUniforms = { uTime: { value: 0 } };
  let petalMesh = null;
  const PETAL_N = 520;
  const PETAL_R = 7.80;   // 与巨型树冠半径一致
  const PETAL_TOP = 14.20; // 巨型树冠顶部高度
  const petalData = [];
  function buildPetals() {
    const geo = new T.CircleGeometry(0.021, 5, 0, Math.PI * 1.35);
    // 让花瓣略带弧度
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      p.setZ(i, (x * x + y * y) * 2.2);
    }
    geo.computeVertexNormals();
    const mat = new T.MeshStandardMaterial({
      color: 0xffd8e6,
      roughness: 0.90,          // 花瓣是漫反射材质，不能有镜面高光
      metalness: 0.0,
      envMapIntensity: 0.14,    // 环境反射压到最低，避免反射天空变成青色亮斑
      side: T.DoubleSide,
      emissive: 0xffb8d2,
      emissiveIntensity: 0.32,  // 增强逆光透光感，飘落花瓣不发灰暗
    });
    const inst = new T.InstancedMesh(geo, mat, PETAL_N);
    inst.instanceMatrix.setUsage(T.DynamicDrawUsage);
    inst.frustumCulled = false;
    scene.add(inst);

    for (let i = 0; i < PETAL_N; i++) {
      const a0 = R() * TAU;
      const r0 = Math.sqrt(R()) * PETAL_R;
      petalData.push({
        x: TREE.x + Math.cos(a0) * r0,
        y: R() * PETAL_TOP + 0.3,
        z: TREE.z + Math.sin(a0) * r0,
        vy: 0.16 + R() * 0.26, sw: 0.7 + R() * 1.5, ph: R() * TAU,
        rs: 0.8 + R() * 2.2, sc: 0.55 + R() * 0.65,
      });
    }
    petalMesh = inst;
    return inst;
  }
  buildPetals();
  regInst(petalMesh, 'petal');
  const dummyP = new T.Object3D();
  function updatePetals(t, dt) {
    if (!petalMesh) return;
    for (let i = 0; i < PETAL_N; i++) {
      const d = petalData[i];
      d.y -= d.vy * dt;
      // 统一风场：整体随风漂移 + 自身飘摆
      const wv = WIND.strength * 0.55;
      d.x += (WIND.vec.x * wv + Math.sin(t * d.sw + d.ph) * 0.24) * dt;
      d.z += (WIND.vec.y * wv + Math.cos(t * d.sw * 0.8 + d.ph) * 0.16) * dt;
      if (d.y < 0.02) {
        // 回收时落在树冠范围内（圆形分布）
        const ang = R() * TAU;
        const rr = Math.sqrt(R()) * PETAL_R;
        d.y = PETAL_TOP + R() * 0.9;
        d.x = TREE.x + Math.cos(ang) * rr;
        d.z = TREE.z + Math.sin(ang) * rr;
      }
      dummyP.position.set(d.x, d.y, d.z);
      dummyP.rotation.set(t * d.rs + d.ph, d.ph + t * 0.6, Math.sin(t * d.sw) * 0.8);
      dummyP.scale.setScalar(d.sc);
      dummyP.updateMatrix();
      petalMesh.setMatrixAt(i, dummyP.matrix);
    }
    petalMesh.instanceMatrix.needsUpdate = true;
  }

  /* ---------- 12b. 岛面点缀：蓬松灌木 / 3D 五瓣野花 / 树根草坪落樱 / 圆润青苔景石 ---------- */
  function buildIslandDeco() {
    const group = new T.Group();
    group.name = 'islandDeco';
    const IR = WORLD.islandR;

    // 排除区：树干中心、长椅及前方视野、野餐垫及前方视野留空，避免灌木遮挡长椅或野餐垫
    function blocked(x, z) {
      if (Math.hypot(x - TREE_BASE_XZ.x, z - TREE_BASE_XZ.z) < 0.86) return true;
      if (Math.hypot(x + 0.56, z - 0.82) < 1.15) return true;   // 长椅及前方视野留空
      if (Math.hypot(x - 1.25, z - 1.92) < 1.22) return true;   // 野餐垫及前方相机视线留空
      return false;
    }

    // ---- 1) 蓬松云朵灌木：Pixar 风格底部深翠 AO + 顶部迎光暖嫩绿 ----
    {
      const leafGeo = new T.CircleGeometry(0.115, 6);
      leafGeo.scale(0.64, 1.0, 1.0);
      {
        const p = leafGeo.attributes.position;
        for (let vi = 0; vi < p.count; vi++) {
          const lx = p.getX(vi), ly = p.getY(vi);
          p.setZ(vi, (lx * lx + ly * ly) * 5.2);
        }
        leafGeo.computeVertexNormals();
      }
      const leafMat = new T.MeshStandardMaterial({
        side: T.DoubleSide, roughness: 0.88, metalness: 0, envMapIntensity: 0.24,
      });
      const N_BUSH = 13;
      const PER = 230;
      const inst = new T.InstancedMesh(leafGeo, leafMat, N_BUSH * PER);
      inst.castShadow = true; inst.receiveShadow = true;
      const dummy = new T.Object3D();
      const col = new T.Color();
      let idx = 0;
      for (let b = 0; b < N_BUSH; b++) {
        let x, z, ok = false;
        for (let k = 0; k < 40; k++) {
          const a = R() * TAU, rr = 0.65 + Math.sqrt(R()) * (IR - 1.05);
          x = Math.cos(a) * rr; z = Math.sin(a) * rr;
          if (!blocked(x, z)) { ok = true; break; }
        }
        if (!ok) continue;
        const baseY = islandHeightAt(x, z);
        const R0 = 0.25 + R() * 0.16;
        const H0 = 0.22 + R() * 0.15;
        for (let l = 0; l < PER; l++) {
          const th = R() * TAU, ph = Math.acos(2 * R() - 1);
          const rr = Math.pow(R(), 0.45);
          const px = Math.sin(ph) * Math.cos(th) * rr * R0;
          const py = Math.cos(ph) * rr * H0 * 0.92 + H0 * 0.78;
          const pz = Math.sin(ph) * Math.sin(th) * rr * R0;
          dummy.position.set(x + px, baseY + Math.max(0.035, py), z + pz);
          dummy.rotation.set(R() * TAU, R() * TAU, R() * TAU);
          const sc = 0.78 + R() * 0.82;
          dummy.scale.set(sc, sc, sc);
          dummy.updateMatrix();
          inst.setMatrixAt(idx, dummy.matrix);
          // 底部深浓环境光遮蔽(AO) -> 顶部鲜活嫩春绿
          const up = clamp(py / (H0 * 1.65), 0, 1);
          const ao = lerp(0.38, 1.15, Math.pow(up, 0.85));
          const v = (0.16 + R() * 0.08) * ao;
          col.setRGB(v * (0.58 + 0.28 * up), v * 1.52, v * (0.38 + 0.12 * up));
          inst.setColorAt(idx, col);
          idx++;
        }
      }
      inst.count = idx;
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      regInst(inst, 'bushLeaf');
      group.add(inst);
    }

    // ---- 2) 3D 立体五瓣小野花（带微仰杯状花冠与金黄花蕊，告别扁平圆片） ----
    {
      function make3DWildflowerGeo() {
        const pos = [], col = [], idx = [];
        const PETALS = 5;
        let vo = 0;
        // 五片向上微仰的立体花瓣
        for (let p = 0; p < PETALS; p++) {
          const a0 = (p / PETALS) * TAU;
          const ca = Math.cos(a0), sa = Math.sin(a0);
          const tx = -sa, tz = ca;
          const rIn = 0.005, rMid = 0.022, rOut = 0.036;
          const wMid = 0.015, wOut = 0.011;
          // 0: 瓣根, 1: 左腰, 2: 右腰, 3: 左尖, 4: 右尖
          pos.push(ca * rIn, 0.002, sa * rIn);
          pos.push(ca * rMid - tx * wMid, 0.009, sa * rMid - tz * wMid);
          pos.push(ca * rMid + tx * wMid, 0.009, sa * rMid + tz * wMid);
          pos.push(ca * rOut - tx * wOut, 0.015, sa * rOut - tz * wOut);
          pos.push(ca * rOut + tx * wOut, 0.015, sa * rOut + tz * wOut);
          col.push(0.92, 0.92, 0.92, 1, 1, 1, 1, 1, 1, 1.05, 1.05, 1.05, 1.05, 1.05, 1.05);
          idx.push(vo, vo + 1, vo + 2, vo + 1, vo + 3, vo + 4, vo + 1, vo + 4, vo + 2);
          vo += 5;
        }
        // 中央饱满暖黄花蕊小丘
        const cTop = vo;
        pos.push(0, 0.014, 0);
        col.push(1.15, 0.92, 0.28);
        vo++;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU;
          pos.push(Math.cos(a) * 0.0085, 0.006, Math.sin(a) * 0.0085);
          col.push(1.05, 0.78, 0.18);
        }
        for (let k = 0; k < 6; k++) {
          idx.push(cTop, vo + k, vo + ((k + 1) % 6));
        }
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        return g;
      }

      const N = 860;
      const geo = make3DWildflowerGeo();
      const mat = new T.MeshStandardMaterial({
        vertexColors: true, side: T.DoubleSide, roughness: 0.78, metalness: 0,
        envMapIntensity: 0.24, emissive: 0xffeef4, emissiveIntensity: 0.10,
      });
      const inst = new T.InstancedMesh(geo, mat, N);
      inst.frustumCulled = false;
      const dummy = new T.Object3D();
      const palette = [
        0xfff6f0, 0xffc8dc, 0xffdfea, 0xffe898,
        0xd8c2ff, 0xaed8ff, 0xffb3cc, 0xfff0c2,
      ];
      const col = new T.Color();
      let placed = 0, guard = 0;
      while (placed < N && guard < N * 12) {
        guard++;
        const a = R() * TAU, rr = Math.sqrt(R()) * (IR - 0.30);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (blocked(x, z)) continue;
        const cl = fbm(x * 2.4 + 5, 0.7, z * 2.4 - 3, 2);
        if (cl < -0.05 && R() < 0.82) continue;
        const groundY = islandHeightAt(x, z);
        dummy.position.set(x, groundY + 0.068 + R() * 0.042, z);
        dummy.rotation.set((R() - 0.5) * 0.35, R() * TAU, (R() - 0.5) * 0.35);
        const sc = 0.72 + R() * 0.78;
        dummy.scale.set(sc, sc, sc);
        dummy.updateMatrix();
        inst.setMatrixAt(placed, dummy.matrix);
        col.setHex(palette[Math.floor(R() * palette.length)]);
        inst.setColorAt(placed, col);
        placed++;
      }
      inst.count = placed;
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      regInst(inst, 'wildflower');
      group.add(inst);
    }

    // ---- 3) 树根凹槽、草丛间与长椅座板上的小巧点缀落樱（精致小瓣，不掩盖鲜亮绿草坪） ----
    {
      const srP = rng(55109);
      const N_GP = 96;
      const pGeo = makeSeaPetalGeo();
      const pMat = new T.MeshStandardMaterial({
        color: 0xffe2ee, roughness: 0.78, metalness: 0.0,
        side: T.DoubleSide, envMapIntensity: 0.22,
        emissive: 0xffb8d2, emissiveIntensity: 0.22,
      });
      const pInst = new T.InstancedMesh(pGeo, pMat, N_GP);
      pInst.receiveShadow = true;
      const dummy = new T.Object3D();
      const col = new T.Color();
      let pi = 0;

      // a) 5 片落在厚木长椅座板上的小巧花瓣
      const benchGroundY = islandHeightAt(-0.56, 0.62);
      const benchPetalSpots = [
        [-0.38, 0.04], [-0.22, -0.05], [0.18, 0.06], [0.42, -0.02], [0.52, 0.05],
      ];
      for (const bp of benchPetalSpots) {
        const lx = bp[0] * 1.36, lz = bp[1] * 1.36;
        const cB = Math.cos(0.15), sB = Math.sin(0.15);
        const wx = -0.56 + lx * cB + lz * sB;
        const wz = 0.62 - lx * sB + lz * cB;
        const wy = benchGroundY + (0.29 + 0.015) * 1.36;
        dummy.position.set(wx, wy, wz);
        dummy.rotation.set((srP() - 0.5) * 0.18, srP() * TAU, (srP() - 0.5) * 0.18);
        dummy.scale.setScalar(0.22 + srP() * 0.10);
        dummy.updateMatrix();
        pInst.setMatrixAt(pi, dummy.matrix);
        col.setHex(0xffeaf2);
        pInst.setColorAt(pi, col);
        pi++;
      }

      // b) 树根凹槽与树下草坪边缘的精致小落瓣（小尺寸点缀，保持绿草如茵）
      while (pi < N_GP) {
        const a = srP() * TAU;
        const uR = Math.pow(srP(), 1.45);
        const rr = 0.42 + uR * (IR - 1.25);
        const x = TREE_BASE_XZ.x * (1.0 - uR * 0.5) + Math.cos(a) * rr;
        const z = TREE_BASE_XZ.z * (1.0 - uR * 0.5) + Math.sin(a) * rr;
        if (Math.hypot(x, z) > IR - 0.45) continue;
        const gy = islandHeightAt(x, z);
        dummy.position.set(x, gy + 0.022 + srP() * 0.025, z);
        dummy.rotation.set((srP() - 0.5) * 0.38, srP() * TAU, (srP() - 0.5) * 0.38);
        const sc = 0.18 + srP() * 0.14;
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        pInst.setMatrixAt(pi, dummy.matrix);
        const tint = srP();
        col.setRGB(1.0, 0.84 + tint * 0.12, 0.90 + tint * 0.08);
        pInst.setColorAt(pi, col);
        pi++;
      }
      pInst.instanceMatrix.needsUpdate = true;
      if (pInst.instanceColor) pInst.instanceColor.needsUpdate = true;
      group.add(pInst);
    }

    // ---- 4) 圆润 Pixar 风格青苔景石与岸线鹅卵石（高细分 + 顶面丰厚绒苔 + 底部深泥接触 AO） ----
    {
      function makeStylizedMossRockGeo(s, seedVal, flatScaleY = 0.66) {
        const g = new T.SphereGeometry(s, 16, 12);
        const p = g.attributes.position;
        for (let vi = 0; vi < p.count; vi++) {
          let vx = p.getX(vi), vy = p.getY(vi), vz = p.getZ(vi);
          const n = fbm(vx * 9.5 + seedVal * 3.7, vy * 9.5, vz * 9.5 - seedVal * 2.1, 2) * 0.24;
          // 底部压平深入泥土，顶部圆润饱满带柔和切面
          const bottomFlat = vy < 0 ? lerp(1.0, 0.42, clamp(-vy / s, 0, 1)) : 1.0;
          vx *= (1.16 + n);
          vy *= flatScaleY * bottomFlat * (1.0 + n * 0.45);
          vz *= (1.08 + n);
          p.setXYZ(vi, vx, vy, vz);
        }
        g.computeVertexNormals();
        const nor = g.attributes.normal;
        const cnt = p.count;
        const cols = new Float32Array(cnt * 3);
        for (let vi = 0; vi < cnt; vi++) {
          const vy = p.getY(vi);
          const ny = nor.getY(vi);
          // 顶部厚青苔覆盖 -> 中腰暖灰褐岩面 -> 底部深邃泥土接触阴影 AO
          const mossMask = smoothstep(0.15, 0.68, ny + vy / (s * 1.4));
          const groundAO = smoothstep(-s * 0.38, s * 0.12, vy);
          const stoneR = 0.42 * groundAO;
          const stoneG = 0.39 * groundAO;
          const stoneB = 0.35 * groundAO;
          const mossR = 0.24 * (0.75 + 0.25 * ny);
          const mossG = 0.50 * (0.75 + 0.25 * ny);
          const mossB = 0.18 * (0.75 + 0.25 * ny);
          cols[vi * 3]     = lerp(stoneR, mossR, mossMask);
          cols[vi * 3 + 1] = lerp(stoneG, mossG, mossMask);
          cols[vi * 3 + 2] = lerp(stoneB, mossB, mossMask);
        }
        g.setAttribute('color', new T.BufferAttribute(cols, 3));
        return g;
      }

      const rockGeos = [];
      const N_ROCK = 7;
      for (let i = 0; i < N_ROCK; i++) {
        let x, z, ok = false;
        for (let k = 0; k < 30; k++) {
          const a = R() * TAU, rr = 0.9 + R() * (IR - 1.5);
          x = Math.cos(a) * rr; z = Math.sin(a) * rr;
          if (!blocked(x, z)) { ok = true; break; }
        }
        if (!ok) continue;
        const s = 0.15 + R() * 0.16;
        const gy = islandHeightAt(x, z);
        const g = makeStylizedMossRockGeo(s, i + 1, 0.68);
        rockGeos.push(g.translate(x, gy + s * 0.22, z));
      }
      // 岸线圆润青苔叠石：压住岛沿过渡，柔化水岸轮廓
      const sr = rng(8821);
      const shoreAngles = [0.38, 1.15, 1.95, 2.72, 3.65, 4.48, 5.38];
      for (let i = 0; i < shoreAngles.length; i++) {
        const a = shoreAngles[i] + (sr() - 0.5) * 0.16;
        const lobe = 1 + 0.038 * Math.sin(a * 7 + 1.3) + 0.023 * Math.sin(a * 13 + 0.7);
        const rr = IR * lobe * (0.93 + sr() * 0.05);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        const s = 0.21 + sr() * 0.15;
        const gy = islandHeightAt(x, z);
        const g = makeStylizedMossRockGeo(s, i + 20, 0.60);
        rockGeos.push(g.translate(x, gy - 0.02, z));
      }
      if (rockGeos.length) {
        const rm = new T.Mesh(mergeGeos(rockGeos), new T.MeshStandardMaterial({
          vertexColors: true, roughness: 0.88, metalness: 0.02, envMapIntensity: 0.28,
        }));
        rm.castShadow = true; rm.receiveShadow = true;
        group.add(rm);
      }
    }

    scene.add(group);
    return group;
  }
  const islandDeco = buildIslandDeco();
  /* ---------- 12c. 飞鸟与蝴蝶 ---------- */
    const birdFlock = [];
  const butterflyGang = [];

  /* ---- 飞鸟：一体流线型 3D 雀燕躯干（含胸腹羽色/颊斑/鸟喙/点睛） + 双关节铰接曲面飞羽（内臂翼+外手翼） + 分叉燕尾 ---- */
  function makeBirdMesh(birdMat) {
    const g = new T.Group();

    const colBack   = new T.Color(0x282136); // 深黛紫青背羽
    const colCrown  = new T.Color(0x1f192b); // 顶冠深羽
    const colBreast = new T.Color(0xedd8ce); // 暖樱白胸腹
    const colCheek  = new T.Color(0xf6e7df); // 脸颊浅斑
    const colRust   = new T.Color(0xc97a63); // 喉下微暖栗色过渡
    const colBeak   = new T.Color(0x18131d); // 乌亮鸟喙
    const colWingTip = new T.Color(0x1c1626); // 飞羽深色翼尖
    const colTrail  = new T.Color(0xd8c2bc); // 次级飞羽浅色后缘

    // 1) 一体流线型身体（从尾基 z=-0.095 到喙尖 z=+0.138 连续放样，告别球体拼凑）
    function buildSculptedBodyGeo() {
      const NU = 22; // 纵向分段（尾基 -> 喙尖）
      const NV = 14; // 环向分段
      const pos = [], col = [], idx = [];
      for (let iu = 0; iu <= NU; iu++) {
        const u = iu / NU;
        const z = lerp(-0.095, 0.138, u);
        let rx, yTop, yBot;
        if (u < 0.18) {
          // 尾柄收束段
          const k = u / 0.18;
          rx = lerp(0.006, 0.022, Math.pow(k, 0.75));
          yTop = lerp(0.005, 0.016, k);
          yBot = lerp(-0.004, -0.015, k);
        } else if (u < 0.64) {
          // 饱满流线型胸腹与背部
          const k = (u - 0.18) / 0.46;
          const arch = Math.sin(k * Math.PI);
          rx = 0.022 + 0.016 * arch;
          yTop = 0.016 + 0.012 * Math.sin(Math.pow(k, 0.85) * Math.PI);
          // 雀鸟/春燕标志性饱满前胸弧线
          yBot = -0.015 - 0.021 * Math.sin(Math.pow(k, 1.1) * Math.PI);
        } else if (u < 0.85) {
          // 颈部微收 -> 圆润头部与头顶隆起
          const k = (u - 0.64) / 0.21;
          const headB = Math.sin(k * Math.PI);
          rx = lerp(0.023, 0.009, Math.pow(k, 1.7)) + 0.005 * headB;
          yTop = lerp(0.018, 0.013, k) + 0.011 * headB;
          yBot = lerp(-0.016, 0.001, Math.pow(k, 0.9)) - 0.003 * headB;
        } else {
          // 尖锐微弯的流线型鸟喙
          const k = (u - 0.85) / 0.15;
          const tap = 1.0 - Math.pow(k, 0.82);
          rx = 0.009 * tap + 0.0006;
          const beakDrop = -0.0035 * k * k;
          yTop = lerp(0.013, 0.0045, k) + beakDrop;
          yBot = lerp(0.001, 0.0035, k) + beakDrop;
        }
        const yMid = 0.5 * (yTop + yBot);
        const ry = Math.max(0.0006, 0.5 * (yTop - yBot));

        for (let iv = 0; iv <= NV; iv++) {
          const th = (iv / NV) * TAU;
          const nx = Math.sin(th);
          const ny = Math.cos(th);
          const x = nx * rx;
          const y = yMid + ny * ry;
          pos.push(x, y, z);

          // 羽色分区着色：乌喙 / 黛青背冠 / 暖栗喉斑 / 樱白胸腹与颊斑
          const c = new T.Color();
          if (u >= 0.84) {
            c.copy(colBeak);
          } else {
            const dorsal = smoothstep(-0.15, 0.35, ny);
            c.copy(colBreast).lerp(colBack, dorsal);
            if (u > 0.68 && ny > 0.2) c.lerp(colCrown, 0.65);
            // 咽喉下方暖栗色领斑（家燕/樱雀特征）
            const throatSpot = Math.exp(-Math.pow((u - 0.68) / 0.08, 2.0)) * smoothstep(0.1, -0.45, ny);
            c.lerp(colRust, throatSpot * 0.72);
            // 脸颊浅白斑
            const cheek = Math.exp(-Math.pow((u - 0.75) / 0.06, 2.0)) * smoothstep(0.35, 0.85, Math.abs(nx)) * (1.0 - Math.abs(ny));
            c.lerp(colCheek, cheek * 0.85);
          }
          col.push(c.r, c.g, c.b);
        }
      }
      for (let iu = 0; iu < NU; iu++) {
        for (let iv = 0; iv < NV; iv++) {
          const a = iu * (NV + 1) + iv;
          const b = a + 1;
          const c = (iu + 1) * (NV + 1) + iv;
          const d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    }

    const bodyMesh = new T.Mesh(buildSculptedBodyGeo(), birdMat);
    g.add(bodyMesh);

    // 乌亮眼珠点睛
    const eyeMat = new T.MeshStandardMaterial({ color: 0x0d0912, roughness: 0.2, metalness: 0.1 });
    for (const sx of [-1, 1]) {
      const eye = new T.Mesh(new T.SphereGeometry(0.0038, 6, 5), eyeMat);
      eye.position.set(sx * 0.0125, 0.015, 0.084);
      g.add(eye);
    }

    // 2) 分叉燕尾羽扇（带 5 根尾羽棱线与中央燕尾深叉，彻底替代原先 3 顶点三角形）
    function buildTailFanGeo() {
      const NU = 10; // 横向（左外尾羽 -> 右外尾羽）
      const NV = 6;  // 纵向（尾基 -> 尾尖）
      const pos = [], col = [], idx = [];
      for (let iu = 0; iu <= NU; iu++) {
        const u = iu / NU;
        const s = u * 2.0 - 1.0; // -1 .. +1
        const absS = Math.abs(s);
        for (let iv = 0; iv <= NV; iv++) {
          const v = iv / NV; // 0=尾根, 1=尾尖
          const halfW = lerp(0.009, 0.056, Math.pow(v, 0.85));
          // 燕尾分叉：外侧尾羽向后长探，中央内凹成优雅 V 字燕尾
          const forkLen = lerp(0.068, 0.132, Math.pow(absS, 1.35));
          const featherScallop = 1.0 + 0.045 * Math.cos(s * Math.PI * 5.0) * smoothstep(0.6, 1.0, v);
          const x = s * halfW;
          const z = -v * forkLen * featherScallop;
          // 尾羽微上翘弧度与横向拱面
          const y = 0.004 * (1.0 - absS * absS) * v + 0.008 * v * v + 0.0012 * Math.sin(s * Math.PI * 5.0) * v;
          pos.push(x, y, z);

          const c = new T.Color().copy(colBack).lerp(colWingTip, v * 0.65);
          // 尾羽中段浅白斑点缀
          const whiteWindow = Math.exp(-Math.pow((v - 0.62) / 0.14, 2.0)) * smoothstep(0.25, 0.75, absS);
          c.lerp(colCheek, whiteWindow * 0.48);
          col.push(c.r, c.g, c.b);
        }
      }
      for (let iu = 0; iu < NU; iu++) {
        for (let iv = 0; iv < NV; iv++) {
          const a = iu * (NV + 1) + iv;
          const b = a + 1;
          const c = (iu + 1) * (NV + 1) + iv;
          const d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    }

    const tail = new T.Mesh(buildTailFanGeo(), birdMat);
    tail.position.set(0, 0.003, -0.088);
    g.add(tail);

    // 3) 双关节三维翼型飞羽（彻底修复原先 PlaneGeometry 居中穿模问题，实现内臂翼 + 外手翼两段式铰接）
    function buildInnerWingGeo(side) {
      // 内臂翼（肩关节 u=0 -> 腕关节 u=1）：前掠至腕部 + 真实机翼上拱弧度(Camber) + 次级飞羽扇缘
      const NU = 7, NV = 6;
      const pos = [], col = [], idx = [];
      const SPAN = 0.112;
      for (let iu = 0; iu <= NU; iu++) {
        const u = iu / NU;
        const x = side * u * SPAN;
        const zLead = lerp(0.026, 0.044, Math.sin(u * Math.PI * 0.65));
        const zTrail = lerp(-0.046, -0.028, u) - 0.004 * Math.sin(u * Math.PI * 5.0);
        for (let iv = 0; iv <= NV; iv++) {
          const v = iv / NV; // 0=前缘, 1=后缘
          const z = lerp(zLead, zTrail, v);
          // 机翼剖面拱度（前缘之后约 v=0.32 处最高，后缘微弯）+ 展向海鸥翼微拱
          const airfoil = Math.sin(Math.pow(v, 0.72) * Math.PI) * 0.015 * (1.0 - 0.20 * u);
          const spanArch = Math.sin(u * Math.PI) * 0.010;
          const featherRib = Math.sin(u * Math.PI * 6.0) * 0.0014 * v;
          const y = airfoil + spanArch + featherRib;
          pos.push(x, y, z);

          const c = new T.Color().copy(colBack);
          // 覆羽至次级飞羽后缘的层次过渡
          c.lerp(colTrail, smoothstep(0.68, 1.0, v) * 0.55);
          col.push(c.r, c.g, c.b);
        }
      }
      for (let iu = 0; iu < NU; iu++) {
        for (let iv = 0; iv < NV; iv++) {
          const a = iu * (NV + 1) + iv;
          const b = a + 1;
          const c = (iu + 1) * (NV + 1) + iv;
          const d = c + 1;
          if (side > 0) idx.push(a, c, b, b, c, d);
          else idx.push(a, b, c, b, d, c);
        }
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    }

    function buildOuterWingGeo(side) {
      // 外手翼（腕关节 u=0 -> 镰刀形初级飞羽尖 u=1）：向后优雅掠出，还原飞燕/海鸥流线镰刀翼尖
      const NU = 9, NV = 6;
      const pos = [], col = [], idx = [];
      const SPAN = 0.158;
      for (let iu = 0; iu <= NU; iu++) {
        const u = iu / NU;
        const x = side * u * SPAN;
        // 前缘从腕部向后镰刀式弯掠，后缘收束成锐利飞羽尖並带初级飞羽齿槽
        const zLead = lerp(0.022, -0.068, Math.pow(u, 1.28));
        const slot = 0.005 * Math.sin(u * Math.PI * 6.0) * smoothstep(0.35, 0.95, u);
        const zTrail = lerp(-0.050, -0.074, Math.pow(u, 0.88)) + slot;
        for (let iv = 0; iv <= NV; iv++) {
          const v = iv / NV;
          const z = lerp(zLead, zTrail, v);
          const airfoil = Math.sin(Math.pow(v, 0.75) * Math.PI) * 0.011 * (1.0 - 0.65 * u);
          const tipUp = Math.pow(u, 2.2) * 0.008;
          const y = airfoil + tipUp;
          pos.push(x, y, z);

          const c = new T.Color().copy(colBack).lerp(colWingTip, smoothstep(0.25, 0.90, u));
          c.lerp(colTrail, smoothstep(0.75, 1.0, v) * (1.0 - 0.6 * u) * 0.42);
          col.push(c.r, c.g, c.b);
        }
      }
      for (let iu = 0; iu < NU; iu++) {
        for (let iv = 0; iv < NV; iv++) {
          const a = iu * (NV + 1) + iv;
          const b = a + 1;
          const c = (iu + 1) * (NV + 1) + iv;
          const d = c + 1;
          if (side > 0) idx.push(a, c, b, b, c, d);
          else idx.push(a, b, c, b, d, c);
        }
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    }

    function makeArticulatedWing(side) {
      // 肩关节容器（固定在鸟躯干两侧肩部，不再居中穿模）
      const innerGrp = new T.Group();
      innerGrp.position.set(side * 0.022, 0.009, 0.018);
      const innerMesh = new T.Mesh(buildInnerWingGeo(side), birdMat);
      innerGrp.add(innerMesh);

      // 腕关节容器（挂载于内臂翼末端，实现上下扑翼时的两段式折叠与滑翔海鸥拱弧）
      const outerGrp = new T.Group();
      outerGrp.position.set(side * 0.108, 0.002, 0.020);
      const outerMesh = new T.Mesh(buildOuterWingGeo(side), birdMat);
      outerGrp.add(outerMesh);
      innerGrp.add(outerGrp);

      return { innerGrp, outerGrp };
    }

    const wingL = makeArticulatedWing(1);
    const wingR = makeArticulatedWing(-1);
    g.add(wingL.innerGrp);
    g.add(wingR.innerGrp);

    return {
      g,
      wingL: wingL.innerGrp,
      wingR: wingR.innerGrp,
      outerL: wingL.outerGrp,
      outerR: wingR.outerGrp,
      tail,
    };
  }

  /* ---- 蝴蝶：3D 弧面双层凤蝶翼（含翅脉拱度/燕尾/斑纹顶点色） + 头胸腹分段体 + 曲弧触角 ---- */
  function makeButterflyMesh(colorHex) {
    const g = new T.Group();
    const baseCol = new T.Color(colorHex);
    const hsl = {};
    baseCol.getHSL(hsl);
    const innerCol = new T.Color().setHSL((hsl.h + 0.04) % 1.0, Math.min(1, hsl.s * 1.15), Math.min(0.92, hsl.l * 1.18));
    const tipCol = new T.Color().setHSL((hsl.h - 0.05 + 1.0) % 1.0, Math.min(1, hsl.s * 1.08), Math.max(0.38, hsl.l * 0.86));
    const darkBorder = new T.Color(0x231520);
    const spotCol = new T.Color(0xfff7ee);

    const wingMat = new T.MeshStandardMaterial({
      vertexColors: true, roughness: 0.48, metalness: 0.04,
      side: T.DoubleSide, envMapIntensity: 0.35,
      emissive: baseCol, emissiveIntensity: 0.24,
    });
    const bodyMat = new T.MeshStandardMaterial({ color: 0x261a1d, roughness: 0.72, metalness: 0.05 });

    // 构造带三维拱度(Camber)、翅脉起伏与斑纹顶点色的曲面蝶翼（side = 1 左翼 +X，side = -1 右翼 -X）
    function buildCurvedWingGeo(side, isFore) {
      const NU = 10; // 展向分段（根 → 尖）
      const NV = 8;  // 弦向分段（前缘 → 后缘）
      const pos = [], col = [], idx = [];
      for (let iu = 0; iu <= NU; iu++) {
        const u = iu / NU; // 0=翅根, 1=翅尖
        for (let iv = 0; iv <= NV; iv++) {
          const v = iv / NV; // 0=前缘, 1=后缘
          let span, zFront, zBack;
          if (isFore) {
            // 前翅：修长优雅的凤蝶前翼轮廓，外缘微具波状瓣感
            const scallop = 1.0 + 0.032 * Math.sin(v * Math.PI * 3.0) * smoothstep(0.55, 1.0, u);
            span = 0.125 * Math.pow(u, 0.82) * (1.0 - 0.14 * Math.pow(v, 1.6)) * scallop;
            zFront = 0.010 + 0.118 * Math.sin(u * Math.PI * 0.56) - 0.012 * u * u;
            zBack  = 0.002 - 0.018 * Math.sin(u * Math.PI * 0.85) + 0.022 * Math.pow(u, 1.7);
          } else {
            // 后翅：饱满圆瓣 + 外缘波浪 + 凤蝶标志性燕尾突起(tailLobe)
            const tailGate = Math.exp(-Math.pow((v - 0.68) / 0.13, 2.0)) * smoothstep(0.60, 1.0, u);
            const scallop = 1.0 + 0.045 * Math.sin(v * Math.PI * 4.0) * smoothstep(0.50, 1.0, u);
            span = (0.092 * Math.sin(u * Math.PI * 0.52) * (1.0 - 0.22 * v * v) * scallop) + tailGate * 0.018;
            zFront = -0.002 - 0.006 * u;
            zBack  = -0.012 - 0.095 * Math.sin(u * Math.PI * 0.62) - tailGate * 0.038;
          }
          const x = side * span;
          const z = lerp(zFront, zBack, v);

          // 三维立体拱面：中段隆起 + 前缘刚性支撑 + 翅脉微波纹 + 翼尖微翘，彻底告别扁平纸片
          const archU = Math.sin(u * Math.PI) * 0.022;
          const archV = Math.sin(v * Math.PI) * (isFore ? 0.014 : 0.012) * u;
          const veinRipple = Math.sin(v * Math.PI * (isFore ? 4.0 : 5.0)) * 0.0028 * u;
          const tipCurl = Math.pow(u, 2.6) * (isFore ? 0.010 : -0.006);
          const y = archU + archV + veinRipple + tipCurl;
          pos.push(x, y, z);

          // 翅膀花纹着色：翅根深绒黑 → 中心亮彩 → 翼缘黑框 + 珍珠亮斑
          const rootDark = smoothstep(0.0, 0.22, u);
          const edgeDark = smoothstep(0.76, 0.96, u) * 0.88 + smoothstep(0.84, 0.99, v) * 0.45;
          const c = new T.Color().copy(innerCol).lerp(tipCol, smoothstep(0.25, 0.85, u));
          // 翅脉细微深浅纹理
          const veinTone = 0.92 + 0.08 * Math.cos(v * Math.PI * 5.0);
          c.multiplyScalar(veinTone);
          // 翅根暗部与外缘深色镶边
          c.lerp(darkBorder, 1.0 - rootDark);
          c.lerp(darkBorder, clamp(edgeDark, 0, 0.88));
          // 外缘内侧珍珠亮斑点缀
          const spotU = Math.exp(-Math.pow((u - 0.84) / 0.065, 2.0));
          const spotV = Math.pow(Math.max(0, Math.sin(v * Math.PI * 4.0)), 3.0);
          c.lerp(spotCol, spotU * spotV * 0.78);
          col.push(c.r, c.g, c.b);
        }
      }
      for (let iu = 0; iu < NU; iu++) {
        for (let iv = 0; iv < NV; iv++) {
          const a = iu * (NV + 1) + iv;
          const b = a + 1;
          const c = (iu + 1) * (NV + 1) + iv;
          const d = c + 1;
          if (side > 0) idx.push(a, c, b, b, c, d);
          else idx.push(a, b, c, b, d, c);
        }
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    }

    function makeSideWings(side) {
      const grp = new T.Group();
      grp.position.set(side * 0.006, 0.004, 0.006);
      const fw = new T.Mesh(buildCurvedWingGeo(side, true), wingMat);
      const hw = new T.Mesh(buildCurvedWingGeo(side, false), wingMat);
      hw.position.y = -0.0025;
      // 自然静息时双翼呈微上扬 V 字立角，任何视角下都有立体纵深
      grp.add(fw);
      grp.add(hw);
      return { grp, fw, hw };
    }

    const leftW = makeSideWings(1);
    const rightW = makeSideWings(-1);
    g.add(leftW.grp);
    g.add(rightW.grp);

    // 立体躯干：头 + 胸 + 腹三段式，替代原先单根细棍
    const thorax = new T.Mesh(new T.SphereGeometry(0.0105, 8, 6), bodyMat);
    thorax.scale.set(0.85, 0.95, 1.65);
    thorax.position.set(0, 0.002, 0.010);
    g.add(thorax);

    const head = new T.Mesh(new T.SphereGeometry(0.0082, 8, 6), bodyMat);
    head.position.set(0, 0.006, 0.030);
    g.add(head);

    const abdomen = new T.Mesh(new T.CapsuleGeometry(0.0062, 0.044, 4, 8), bodyMat);
    abdomen.rotation.x = Math.PI / 2 - 0.14;
    abdomen.position.set(0, -0.003, -0.026);
    g.add(abdomen);

    // 向前上方自然弯曲的锤状触角
    for (const sx of [-1, 1]) {
      const antPts = [
        new T.Vector3(sx * 0.004, 0.009, 0.033),
        new T.Vector3(sx * 0.014, 0.022, 0.050),
        new T.Vector3(sx * 0.026, 0.030, 0.064),
      ];
      const antGeo = tubeGeo(antPts, (t) => lerp(0.0014, 0.0010, t), 5, true);
      g.add(new T.Mesh(antGeo, bodyMat));
      const tip = new T.Mesh(new T.SphereGeometry(0.0026, 6, 4), bodyMat);
      tip.position.copy(antPts[2]);
      g.add(tip);
    }

    return { g, wLeft: leftW.grp, wRight: rightW.grp, fwL: leftW.fw, hwL: leftW.hw, fwR: rightW.fw, hwR: rightW.hw };
  }

  function buildCreatures() {
    // ---- 飞鸟：带顶点羽色与落日金边透射的立体群鸟 ----
    const birdMat = new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.04,
      side: T.DoubleSide,
      envMapIntensity: 0.42,
      emissive: new T.Color(0x3a2434),
      emissiveIntensity: 0.18,
    });
    // 布置三群飞鸟：1) 右侧落日霞光区雁燕群（还原参考图树冠右侧夕阳下的飞鸟剪影） 2) 左侧远山天际群 3) 环岛近景巡游雀鸟
    const FLOCKS = [
      { cx: 12.8, cz: -19.5, rx: 7.2, rz: 5.5, y: 6.4, spd: -0.22, n: 9, scMin: 1.55, scMax: 2.35 },
      { cx: -14.2, cz: -22.0, rx: 8.2, rz: 6.2, y: 7.2, spd: 0.18, n: 6, scMin: 1.50, scMax: 2.25 },
      { cx: 0.5, cz: -3.5, rx: 9.2, rz: 7.4, y: 4.3, spd: 0.24, n: 5, scMin: 1.25, scMax: 1.65 },
    ];
    for (const F of FLOCKS) {
      for (let i = 0; i < F.n; i++) {
        const b = makeBirdMesh(birdMat);
        const sc = lerp(F.scMin, F.scMax, R());
        b.g.scale.setScalar(sc);
        scene.add(b.g);
        // 群内错落编队相位，让鸟群呈自然流线簇集而非散乱或机械排成圆圈
        const clusterPh = (i / F.n) * TAU * 0.55 + (R() - 0.5) * 0.35;
        birdFlock.push({
          g: b.g,
          wl: b.wingL, wr: b.wingR,
          ol: b.outerL, or: b.outerR,
          tail: b.tail,
          cx: F.cx + (R() - 0.5) * 3.6,
          cz: F.cz + (R() - 0.5) * 3.2,
          rx: F.rx * (0.82 + R() * 0.36),
          rz: F.rz * (0.82 + R() * 0.36),
          y: F.y + (R() - 0.5) * 2.2,
          spd: F.spd * (0.92 + R() * 0.16),
          ph: clusterPh,
          flap: 6.8 + R() * 2.4,
          glideFreq: 0.55 + R() * 0.35,
          sc,
        });
      }
    }

    // ---- 蝴蝶 ----
    const palette = [0xffb3d0, 0xffd27a, 0xb9a7ff, 0xff9e6e, 0xa8e2ff, 0xffe9a8, 0xff8fb0];
    for (let i = 0; i < 7; i++) {
      const b = makeButterflyMesh(palette[i % palette.length]);
      b.g.scale.setScalar(0.85 + R() * 0.45);
      scene.add(b.g);
      butterflyGang.push({
        g: b.g, wLeft: b.wLeft, wRight: b.wRight, hwL: b.hwL, hwR: b.hwR,
        cx: (R() - 0.5) * 4.2,
        cz: (R() - 0.5) * 4.2,
        cy: 1.15 + R() * 2.55,
        rad: 0.9 + R() * 1.5,
        spdA: 0.45 + R() * 0.65,
        spdB: 0.35 + R() * 0.55,
        ph: R() * TAU,
        flap: 9.5 + R() * 5.0,
        sc: 1.15 + R() * 0.55,
      });
    }
  }
  buildCreatures();

  function updateCreatures(t, dt) {
    // 飞鸟：椭圆盘旋切线对齐 + 间歇扑翼与海鸥拱翼滑翔交替 + 内外双关节翼折叠滞后
    for (const b of birdFlock) {
      const a = b.ph + t * b.spd;
      const waveY = Math.sin(t * 0.68 + b.ph * 1.9) * 0.65;
      const dyDt = Math.cos(t * 0.68 + b.ph * 1.9) * 0.65 * 0.68;

      // 扑翼-滑翔包络：连续鼓翼后自然衔接到优雅的弧形展翼滑翔（下坡滑翔、爬升鼓翼）
      const glideCycle = Math.sin(t * b.glideFreq + b.ph * 2.7);
      const flapAmp = smoothstep(-0.35, 0.42, glideCycle);
      const phFlap = t * b.flap + b.ph * 3.1;
      const sFlap = Math.sin(phFlap);
      const cFlap = Math.cos(phFlap);

      // 扑翼升力使鸟体轻微上下起伏
      const liftBob = -cFlap * 0.018 * flapAmp;
      const x = b.cx + Math.cos(a) * b.rx;
      const z = b.cz + Math.sin(a) * b.rz;
      const y = b.y + waveY + liftBob;
      b.g.position.set(x, y, z);

      // 严格按三维速度切向计算偏航角(Yaw)、俯仰角(Pitch)与盘旋滚转角(Bank)
      const vx = -Math.sin(a) * b.rx * b.spd;
      const vz = Math.cos(a) * b.rz * b.spd;
      const hSpd = Math.max(0.001, Math.hypot(vx, vz));
      b.g.rotation.order = 'YXZ';
      b.g.rotation.y = Math.atan2(vx, vz);
      b.g.rotation.x = clamp(-dyDt / (hSpd * 3.2), -0.28, 0.28) + cFlap * 0.05 * flapAmp;
      b.g.rotation.z = -Math.sign(b.spd) * 0.16 + Math.sin(t * 0.85 + b.ph) * 0.08;

      // 双关节翼姿态：
      // 滑翔时内翼微上扬(+0.22 rad)、外翼在腕部微下垂(-0.32 rad)，构成经典的海鸥/飞燕 M 型弧翼剪影；
      // 扑翼时内翼绕肩关节上下扇动，外翼滞后 0.78 rad 并在上扬时自然向内折叠、下扑时舒展鞭击
      const innerAng = lerp(0.22, 0.08 + sFlap * 0.56, flapAmp);
      const outerLag = Math.sin(phFlap - 0.78);
      const outerFold = Math.max(0, cFlap) * 0.34; // 上扬阶段腕关节折翼
      const outerAng = lerp(-0.32, -0.14 + outerLag * 0.52 - outerFold, flapAmp);
      const sweepAng = cFlap * 0.12 * flapAmp;

      b.wl.rotation.z = innerAng;
      b.wr.rotation.z = -innerAng;
      b.wl.rotation.y = sweepAng;
      b.wr.rotation.y = -sweepAng;
      if (b.ol && b.or) {
        b.ol.rotation.z = outerAng;
        b.or.rotation.z = -outerAng;
      }
      if (b.tail) {
        b.tail.rotation.x = -0.06 - cFlap * 0.08 * flapAmp;
      }
    }
    // 蝴蝶：三维上下扑翼（绕 Z 轴折叠）+ 前后翅相位差 + 扑翼升力起伏 + 真实航向对齐
    for (const b of butterflyGang) {
      const a1 = t * b.spdA + b.ph;
      const a2 = t * b.spdB + b.ph * 1.7;
      // 间歇滑翔调制：快速翩跹后偶有短暂微张滑翔，神态更逼真
      const flutterMod = 0.68 + 0.32 * Math.sin(t * 1.6 + b.ph * 2.3);
      const flapPhase = t * b.flap + b.ph;
      const wave = Math.sin(flapPhase);
      // 扑翼角：上扬合拢至 +1.18 rad (68°)，下扑展开至 -0.52 rad (-30°)
      const flapAngle = 0.34 + wave * 0.84 * flutterMod;
      // 下扑时身体获得升力微抬，上扬时微沉
      const bob = -Math.cos(flapPhase) * 0.022 * flutterMod;

      const x = b.cx + Math.cos(a1) * b.rad;
      const z = b.cz + Math.sin(a2) * b.rad * 0.85;
      const y = b.cy + Math.sin(t * 0.95 + b.ph) * 0.32 + bob;
      b.g.position.set(x, y, z);

      // 解析速度向量，让蝶身朝向真实切线方向并自然侧倾
      const vx = -Math.sin(a1) * b.rad * b.spdA;
      const vz = Math.cos(a2) * b.rad * 0.85 * b.spdB;
      b.g.rotation.order = 'YXZ';
      b.g.rotation.y = Math.atan2(vx, vz);
      b.g.rotation.x = -0.26 + Math.cos(flapPhase) * 0.10 * flutterMod;
      b.g.rotation.z = Math.sin(t * 1.4 + b.ph) * 0.22;
      b.g.scale.setScalar(b.sc);

      // ★ 绕 Z 轴上下扇动（修正原先绕 Y 轴水平剪刀式平转导致像扁平纸片的问题）
      b.wLeft.rotation.z = flapAngle;
      b.wRight.rotation.z = -flapAngle;
      // 扑翼伴随轻微前后掠角变化
      const sweep = Math.cos(flapPhase) * 0.14 * flutterMod;
      b.wLeft.rotation.y = sweep;
      b.wRight.rotation.y = -sweep;
      // 后翅滞后相位，形成柔韧波浪感
      if (b.hwL && b.hwR) {
        const lag = Math.cos(flapPhase) * 0.18 * flutterMod;
        b.hwL.rotation.z = -lag;
        b.hwR.rotation.z = lag;
      }
    }
  }

  /* ---------- 12d. 树下可爱圆角厚布野餐垫 / 茶具 / 编织藤篮 / 樱饼果盘（真实贴地不悬浮 + 深度接触阴影） ---------- */
  function buildPicnic() {
    const g = new T.Group();
    g.name = 'picnic';

    // 位置：小岛右前侧草地，与左侧长椅形成温馨平衡的微缩公园构图
    const PX = 1.25, PZ = 1.75, ROT = 0.32;
    const cosR = Math.cos(ROT), sinR = Math.sin(ROT);
    const toWorldXZ = (lx, lz) => ({
      x: PX + lx * cosR + lz * sinR,
      z: PZ - lx * sinR + lz * cosR,
    });
    const baseGroundY = islandHeightAt(PX, PZ);

    // ---- 1) 圆角厚包边格纹野餐垫（修复原先 y=0.155 悬空 Bug，逐顶点贴合地形并带立体滚边与柔和褶皱） ----
    {
      const W = 1.04, D = 0.78, SEG = 28;
      const geo = new T.PlaneGeometry(W, D, SEG, SEG);
      geo.rotateX(-Math.PI / 2);
      const p = geo.attributes.position;
      const cols = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        let lx = p.getX(i), lz = p.getZ(i);
        const u = lx / (W * 0.5), v = lz / (D * 0.5); // -1 .. +1
        // 超椭圆圆角映射：消除生硬尖锐的直角矩形边角
        const rInf = Math.max(Math.abs(u), Math.abs(v));
        const rSup = Math.pow(Math.pow(Math.abs(u), 4.2) + Math.pow(Math.abs(v), 4.2), 1 / 4.2);
        if (rSup > 1e-5) {
          const scaleCorner = lerp(1.0, rInf / rSup, 0.85);
          lx *= scaleCorner;
          lz *= scaleCorner;
        }
        const edgeDist = Math.min(1.0, Math.pow(Math.pow(Math.abs(lx / (W * 0.5)), 4.0) + Math.pow(Math.abs(lz / (D * 0.5)), 4.0), 0.25));
        // 边缘立体厚滚边(Rolled Hem) + 布面微褶皱 + 外缘贴地收落
        const hemArch = Math.exp(-Math.pow((edgeDist - 0.92) / 0.055, 2.0)) * 0.009;
        const dropEdge = smoothstep(0.94, 1.0, edgeDist) * 0.008;
        const ripple = (Math.sin(lx * 14.0 + lz * 6.0) + Math.cos(lz * 16.0 - lx * 5.0)) * 0.0022 * (1.0 - edgeDist * 0.6);

        const wpt = toWorldXZ(lx, lz);
        const wy = islandHeightAt(wpt.x, wpt.z) - baseGroundY + 0.011 + hemArch + ripple - dropEdge;
        p.setXYZ(i, lx, wy, lz);

        // 温馨野餐格纹（樱花粉白格纹 + 织物经纬细纹 + 滚边暖米色包边 + 器皿下方微 AO）
        const gx = (lx / W + 0.5) * 7.0;
        const gz = (lz / D + 0.5) * 5.0;
        const ix = Math.floor(gx), iz = Math.floor(gz);
        const weave = 0.96 + 0.04 * Math.sin(lx * 180.0) * Math.sin(lz * 180.0);
        let cr, cg, cb;
        if (edgeDist > 0.89) {
          // 柔和米白立体缝线包边
          cr = 0.96; cg = 0.88; cb = 0.84;
        } else if ((ix + iz) % 2 === 0) {
          cr = 0.94; cg = 0.58; cb = 0.69;
        } else if (ix % 2 === 0) {
          cr = 0.97; cg = 0.76; cb = 0.82;
        } else {
          cr = 0.99; cg = 0.95; cb = 0.91;
        }
        // 器皿摆放处压入柔和接触阴影 AO
        const dPot = Math.hypot(lx + 0.06, lz + 0.06);
        const dBsk = Math.hypot(lx - 0.25, lz + 0.12);
        const dPlt = Math.hypot(lx - 0.02, lz - 0.14);
        const itemAO = 1.0 - 0.32 * Math.exp(-dPot * dPot * 95.0)
                           - 0.36 * Math.exp(-dBsk * dBsk * 65.0)
                           - 0.28 * Math.exp(-dPlt * dPlt * 110.0)
                           - 0.22 * smoothstep(0.92, 1.0, edgeDist);
        cols[i * 3]     = cr * weave * itemAO;
        cols[i * 3 + 1] = cg * weave * itemAO;
        cols[i * 3 + 2] = cb * weave * itemAO;
      }
      geo.setAttribute('color', new T.BufferAttribute(cols, 3));
      geo.computeVertexNormals();
      const mat = new T.MeshStandardMaterial({
        vertexColors: true, roughness: 0.90, metalness: 0, side: T.DoubleSide,
        envMapIntensity: 0.18,
      });
      const cloth = new T.Mesh(geo, mat);
      cloth.position.set(PX, baseGroundY, PZ);
      cloth.rotation.y = ROT;
      cloth.castShadow = true;
      cloth.receiveShadow = true;
      g.add(cloth);
    }

    const surfaceYAt = (lx, lz) => {
      const wpt = toWorldXZ(lx, lz);
      return islandHeightAt(wpt.x, wpt.z) + 0.012;
    };

    // ---- 2) 温润白瓷茶壶 ----
    const porcelain = new T.MeshStandardMaterial({
      color: 0xf9f3ec, roughness: 0.28, metalness: 0.02, envMapIntensity: 0.58,
    });
    const porcelain2 = new T.MeshStandardMaterial({
      color: 0xffeef4, roughness: 0.26, metalness: 0.02, envMapIntensity: 0.58,
    });
    {
      const pot = new T.Group();
      const body = new T.Mesh(new T.SphereGeometry(0.062, 16, 12), porcelain);
      body.scale.y = 0.82; body.castShadow = true;
      pot.add(body);
      const lid = new T.Mesh(new T.SphereGeometry(0.040, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), porcelain);
      lid.position.y = 0.040; lid.castShadow = true;
      pot.add(lid);
      const knob = new T.Mesh(new T.SphereGeometry(0.011, 8, 6), porcelain2);
      knob.position.y = 0.062; pot.add(knob);
      const spout = new T.Mesh(new T.CylinderGeometry(0.009, 0.017, 0.075, 8), porcelain);
      spout.position.set(0.062, 0.006, 0);
      spout.rotation.z = -0.72;
      spout.castShadow = true;
      pot.add(spout);
      const handle = new T.Mesh(new T.TorusGeometry(0.040, 0.0085, 8, 14, Math.PI * 1.15), porcelain);
      handle.position.set(-0.058, 0.012, 0);
      handle.rotation.y = Math.PI / 2;
      handle.rotation.z = -0.3;
      pot.add(handle);
      const lx = -0.08, lz = -0.06;
      const wpt = toWorldXZ(lx, lz);
      pot.position.set(wpt.x, surfaceYAt(lx, lz) + 0.058, wpt.z);
      pot.rotation.y = ROT + 0.4;
      pot.scale.setScalar(1.25);
      g.add(pot);
    }

    // ---- 3) 两只精致樱色茶杯 ----
    for (let i = 0; i < 2; i++) {
      const cup = new T.Group();
      const body = new T.Mesh(new T.CylinderGeometry(0.030, 0.023, 0.036, 14), porcelain2);
      body.castShadow = true;
      cup.add(body);
      const rim = new T.Mesh(new T.TorusGeometry(0.030, 0.0035, 6, 14), porcelain);
      rim.rotation.x = Math.PI / 2; rim.position.y = 0.018;
      cup.add(rim);
      const saucer = new T.Mesh(new T.CylinderGeometry(0.048, 0.042, 0.007, 16), porcelain);
      saucer.position.y = -0.020;
      saucer.castShadow = true;
      cup.add(saucer);
      const lx = 0.10 + i * 0.11, lz = -0.01 + i * 0.09;
      const wpt = toWorldXZ(lx, lz);
      cup.position.set(wpt.x, surfaceYAt(lx, lz) + 0.024, wpt.z);
      g.add(cup);
    }

    // ---- 4) 原木圆托盘与三枚春日樱饼（Sakura Mochi） ----
    {
      const trayGrp = new T.Group();
      const trayMat = new T.MeshStandardMaterial({ color: 0x9c6e46, roughness: 0.65, metalness: 0.02 });
      const mochiMat = new T.MeshStandardMaterial({ color: 0xffb8cf, roughness: 0.55, metalness: 0.0 });
      const leafMat = new T.MeshStandardMaterial({ color: 0x3b6329, roughness: 0.72, metalness: 0.0 });
      const tray = new T.Mesh(new T.CylinderGeometry(0.082, 0.074, 0.012, 18), trayMat);
      tray.castShadow = true; tray.receiveShadow = true;
      trayGrp.add(tray);
      const trayRim = new T.Mesh(new T.TorusGeometry(0.078, 0.006, 8, 18), trayMat);
      trayRim.rotation.x = Math.PI / 2; trayRim.position.y = 0.006;
      trayGrp.add(trayRim);
      for (let m = 0; m < 3; m++) {
        const ma = (m / 3) * TAU + 0.3;
        const mx = Math.cos(ma) * 0.034, mz = Math.sin(ma) * 0.034;
        const mochi = new T.Mesh(new T.SphereGeometry(0.024, 12, 10), mochiMat);
        mochi.scale.set(1.15, 0.72, 0.92);
        mochi.position.set(mx, 0.018, mz);
        mochi.rotation.y = ma;
        mochi.castShadow = true;
        trayGrp.add(mochi);
        // 包裹樱饼的盐渍樱叶
        const wrap = new T.Mesh(new T.CylinderGeometry(0.022, 0.023, 0.022, 10, 1, true, 0, Math.PI * 1.25), leafMat);
        wrap.position.set(mx, 0.018, mz);
        wrap.rotation.y = ma + 0.5;
        trayGrp.add(wrap);
      }
      const lx = -0.05, lz = 0.14;
      const wpt = toWorldXZ(lx, lz);
      trayGrp.position.set(wpt.x, surfaceYAt(lx, lz) + 0.006, wpt.z);
      g.add(trayGrp);
    }

    // ---- 5) 厚边编织野餐藤篮 ----
    {
      const wicker = new T.MeshStandardMaterial({ color: 0xb28650, roughness: 0.86, metalness: 0 });
      const wickerDark = new T.MeshStandardMaterial({ color: 0x8e6738, roughness: 0.90, metalness: 0 });
      const basket = new T.Group();
      const body = new T.Mesh(new T.CylinderGeometry(0.092, 0.074, 0.088, 18, 4, false), wicker);
      body.castShadow = true; body.receiveShadow = true;
      basket.add(body);
      // 篮口编织厚卷边
      const topRim = new T.Mesh(new T.TorusGeometry(0.092, 0.010, 8, 20), wickerDark);
      topRim.rotation.x = Math.PI / 2;
      topRim.position.y = 0.044;
      basket.add(topRim);
      const bottomRim = new T.Mesh(new T.TorusGeometry(0.074, 0.008, 8, 18), wickerDark);
      bottomRim.rotation.x = Math.PI / 2;
      bottomRim.position.y = -0.042;
      basket.add(bottomRim);
      // 提手
      const handle = new T.Mesh(new T.TorusGeometry(0.086, 0.0085, 8, 18, Math.PI), wickerDark);
      handle.position.y = 0.044;
      handle.castShadow = true;
      basket.add(handle);
      // 篮内蓬松亚麻餐巾
      const napkin = new T.Mesh(new T.SphereGeometry(0.078, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new T.MeshStandardMaterial({ color: 0xfff5ec, roughness: 0.92 }));
      napkin.position.y = 0.026; napkin.scale.y = 0.42;
      basket.add(napkin);
      const lx = 0.25, lz = -0.10;
      const wpt = toWorldXZ(lx, lz);
      basket.position.set(wpt.x, surfaceYAt(lx, lz) + 0.052, wpt.z);
      basket.scale.setScalar(1.26);
      basket.rotation.y = ROT - 0.35;
      g.add(basket);
    }

    islandGroup.add(g);
    return g;
  }
  const picnic = buildPicnic();
