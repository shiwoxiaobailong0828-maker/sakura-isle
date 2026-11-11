
  /* ---------- 9. 草 ---------- */
  const grassUniforms = { uTime: { value: 0 }, uWind: { value: 1.0 }, uWindDir: windUniforms.uWindDir, uGust: windUniforms.uGust };
  function buildGrass() {
    // 一簇草：6 片细长叶，向外散开
    const pos = [], col = [], idx = [], nor = [];
    const BLADES = 6;
    let vo = 0;
    for (let b = 0; b < BLADES; b++) {
      const a = (b / BLADES) * TAU + (b % 2) * 0.35;
      const ca = Math.cos(a), sa = Math.sin(a);
      const w = 0.0155;
      const h = 0.12 + 0.065 * (b % 3);
      const lean = 0.036 + 0.020 * (b % 3);
      // 三角形叶片（底宽顶尖）
      pos.push(-w * sa, 0, w * ca);
      pos.push(w * sa, 0, -w * ca);
      pos.push(ca * lean, h, sa * lean);
      // 修正顶点色与实例色双重相乘导致的发黑问题：根部温润苔绿、叶尖柔亮春绿
      const v0 = 0.86 + 0.14 * (b / BLADES);
      col.push(0.48 * v0, 0.60 * v0, 0.34 * v0);
      col.push(0.48 * v0, 0.60 * v0, 0.34 * v0);
      col.push(1.05 * v0, 1.22 * v0, 0.70 * v0);
      nor.push(ca * 0.25, 0.94, sa * 0.25, ca * 0.25, 0.94, sa * 0.25, ca * 0.35, 0.90, sa * 0.35);
      idx.push(vo, vo + 1, vo + 2);
      vo += 3;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    sanitize(geo);

    const COUNT = 8200;
    const mat = new T.MeshStandardMaterial({
      vertexColors: true, side: T.DoubleSide, roughness: 0.82, metalness: 0, envMapIntensity: 0.35,
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = grassUniforms.uTime;
      sh.uniforms.uWind = grassUniforms.uWind;
      sh.uniforms.uWindDir = grassUniforms.uWindDir;
      sh.uniforms.uGust = grassUniforms.uGust;
      sh.vertexShader = `uniform float uTime; uniform float uWind; uniform float uGust;\n        uniform vec2 uWindDir;\n` +
        sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           {
             vec4 wp = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
             float hh = clamp(position.y / 0.14, 0.0, 1.0);
             // 草浪：大尺度波动 + 细碎抖动
             float wave = sin(uTime * 1.15 + wp.x * 0.9 + wp.z * 0.7) * 0.5 + 0.5;
             float gust = sin(uTime * 0.55 + wp.x * 0.35) * 0.5 + 0.5;
             // 草地统一风场：整体顺着风向倒伏 + 阵风加剧
             float bend = (wave * 0.45 + gust * 0.55) * (0.075 + uGust * 0.055) * hh * uWind;
             transformed.x += uWindDir.x * bend - uWindDir.y * bend * 0.18;
             transformed.z += uWindDir.y * bend + uWindDir.x * bend * 0.18;
             transformed.y -= abs(bend) * 0.30 * hh;
           }`
        );
    };
    const inst = new T.InstancedMesh(geo, mat, COUNT);
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.frustumCulled = false;

    const dummy = new T.Object3D();
    const c = new T.Color();
    let i = 0, guard = 0;
    while (i < COUNT && guard < COUNT * 12) {
      guard++;
      const a = R() * TAU;
      const rr = Math.sqrt(R()) * (WORLD.islandR - 0.06);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      // 树根附近稀疏一点
      const dTree = Math.hypot(x - TREE.x, z - TREE.z);
      if (dTree < 0.30) continue;
      // 野餐区留空，避免草把垫子盖住
      if (Math.hypot(x + 0.10, z - 1.98) < 0.66) continue;
      // 边缘密度也降一点
      if (rr > WORLD.islandR - 0.35 && R() < 0.45) continue;
      const y = 0.035 * fbm(x * 0.85, 0.4, z * 0.85, 2) + 0.015 * fbm(x * 2.6, 1.1, z * 2.6, 2);
      const s = 0.68 + R() * 0.62;
      dummy.position.set(x, y - 0.012, z);
      dummy.rotation.set((R() - 0.5) * 0.30, R() * TAU, (R() - 0.5) * 0.30);
      dummy.scale.set(s * (0.85 + R() * 0.35), s * (0.75 + R() * 0.6), s);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      // 深浅斑驳（提高明度与暖春绿饱和度，避免与顶点色叠乘后发暗）
      const k = fbm(x * 2.2 + 9, 0.5, z * 2.2, 2);
      c.setHSL(0.255 + k * 0.032, 0.44 + k * 0.12, 0.46 + R() * 0.14);
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

  /* ---------- 10. 长椅 ---------- */
  function buildBench() {
    const g = new T.Group();
    const woodMat = new T.MeshStandardMaterial({ color: 0x7d5a3a, roughness: 0.82, metalness: 0.0 });
    const woodMat2 = new T.MeshStandardMaterial({ color: 0x8d6844, roughness: 0.78, metalness: 0.0 });
    const ironMat = new T.MeshStandardMaterial({ color: 0x1f2429, roughness: 0.52, metalness: 0.70 });
    const ironMat2 = new T.MeshStandardMaterial({ color: 0x2a3037, roughness: 0.48, metalness: 0.72 });

    const W = 0.94;          // 座宽
    const D = 0.36;          // 座深
    const SEAT_Y = 0.32;

    const box = (w, h, d, mat) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    };

    // ---- 座面：6 根木条，圆润一点（两侧加封边）----
    const slatN = 6;
    const slatD = (D - 0.02) / slatN;
    for (let i = 0; i < slatN; i++) {
      const zz = -D / 2 + slatD * (i + 0.5);
      const s = box(W, 0.026, slatD * 0.80, i % 2 ? woodMat : woodMat2);
      s.position.set(0, SEAT_Y, zz);
      g.add(s);
    }
    // 座面下横梁
    for (const sz of [-1, 1]) {
      const rail = box(W - 0.04, 0.030, 0.045, woodMat);
      rail.position.set(0, SEAT_Y - 0.028, sz * (D / 2 - 0.05));
      g.add(rail);
    }

    // ---- 靠背：两根铁立柱 + 三根木横板（向后倾）----
    const BACK_TILT = 0.17;
    const backH = 0.46;
    for (const sx of [-1, 1]) {
      const post = new T.Mesh(new T.CylinderGeometry(0.016, 0.018, backH, 10), ironMat);
      post.position.set(sx * (W / 2 - 0.035), SEAT_Y + backH / 2, -D / 2 - 0.02);
      post.rotation.x = BACK_TILT;
      post.castShadow = true;
      g.add(post);
    }
    for (let i = 0; i < 3; i++) {
      const yy = SEAT_Y + 0.13 + i * 0.135;
      const zz = -D / 2 - 0.02 - Math.sin(BACK_TILT) * (yy - SEAT_Y);
      const slat = box(W - 0.06, 0.052, 0.028, i % 2 ? woodMat2 : woodMat);
      slat.position.set(0, yy, zz);
      slat.rotation.x = BACK_TILT;
      g.add(slat);
    }

    // ---- 扶手：木扶手 + 前端铁支杆 ----
    for (const sx of [-1, 1]) {
      const armY = SEAT_Y + 0.215;
      const arm = box(0.048, 0.030, D * 0.86, woodMat);
      arm.position.set(sx * (W / 2 - 0.02), armY, -0.01);
      g.add(arm);
      // 前支杆
      const sup = new T.Mesh(new T.CylinderGeometry(0.011, 0.011, armY - SEAT_Y, 8), ironMat2);
      sup.position.set(sx * (W / 2 - 0.02), (armY + SEAT_Y) / 2, D / 2 - 0.075);
      sup.castShadow = true;
      g.add(sup);
      // 扶手与靠背的连接短杆
      const link = new T.Mesh(new T.CylinderGeometry(0.010, 0.010, 0.10, 8), ironMat2);
      link.position.set(sx * (W / 2 - 0.02), armY - 0.02, -D / 2 - 0.02);
      link.rotation.x = 0.5;
      g.add(link);
    }

    // ---- 四条铁腿（略微外撇）+ 横撑 + 脚垫 ----
    const legH = SEAT_Y - 0.03;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new T.Mesh(new T.CylinderGeometry(0.017, 0.013, legH, 10), ironMat);
        const lx = sx * (W / 2 - 0.07);
        const lz = sz * (D / 2 - 0.06);
        leg.position.set(lx, legH / 2, lz);
        leg.rotation.z = -sx * 0.05;
        leg.rotation.x = sz * 0.04;
        leg.castShadow = true;
        g.add(leg);
        // 脚垫
        const foot = new T.Mesh(new T.SphereGeometry(0.021, 8, 6), ironMat2);
        foot.position.set(lx - sx * 0.004, 0.014, lz - sz * 0.004);
        foot.scale.y = 0.6;
        g.add(foot);
      }
    }
    // 侧向横撑（前后腿之间）
    for (const sx of [-1, 1]) {
      const br = new T.Mesh(new T.BoxGeometry(0.020, 0.016, D - 0.14), ironMat2);
      br.position.set(sx * (W / 2 - 0.07), 0.10, 0);
      g.add(br);
    }
    // 纵向横撑（左右腿之间）
    for (const sz of [-1, 1]) {
      const br = new T.Mesh(new T.BoxGeometry(W - 0.16, 0.016, 0.018), ironMat2);
      br.position.set(0, 0.075, sz * (D / 2 - 0.06));
      g.add(br);
    }

    // 摆位
    g.position.set(-0.98, 0.07, 1.28);
    g.rotation.y = Math.PI * 0.34;
    g.scale.setScalar(1.5);
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
  const PETAL_N = 480;
  const PETAL_R = 6.10;   // 与树冠半径一致
  const PETAL_TOP = 13.20; // 树冠顶部高度
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

  /* ---------- 12b. 岛面点缀：灌木 / 野花 / 青苔景石 ---------- */
  function buildIslandDeco() {
    const group = new T.Group();
    group.name = 'islandDeco';
    const IR = WORLD.islandR;

    // 排除区：树干、长椅周围留空
    function blocked(x, z) {
      if (Math.hypot(x - TREE.x, z - TREE.z) < 0.62) return true;
      if (Math.hypot(x + 1.05, z - 1.28) < 0.55) return true;   // 长椅
      if (Math.hypot(x + 0.10, z - 1.98) < 0.82) return true;   // 野餐区
      return false;
    }

        // ---- bush: dense leaf-card clusters (fluffy, not spheres) ----
    {
      const leafGeo = new T.CircleGeometry(0.115, 5);
      leafGeo.scale(0.58, 1.0, 1.0);
      {
        const p = leafGeo.attributes.position;
        for (let vi = 0; vi < p.count; vi++) {
          const lx = p.getX(vi), ly = p.getY(vi);
          p.setZ(vi, (lx * lx + ly * ly) * 6.0);
        }
        leafGeo.computeVertexNormals();
      }
      const leafMat = new T.MeshStandardMaterial({
        side: T.DoubleSide, roughness: 0.95, metalness: 0, envMapIntensity: 0.16,
      });
      const N_BUSH = 13;
      const PER = 230;
      const inst = new T.InstancedMesh(leafGeo, leafMat, N_BUSH * PER);
      inst.castShadow = true;
      const dummy = new T.Object3D();
      const col = new T.Color();
      let idx = 0;
      for (let b = 0; b < N_BUSH; b++) {
        let x, z, ok = false;
        for (let k = 0; k < 40; k++) {
          const a = R() * TAU, rr = 0.6 + Math.sqrt(R()) * (IR - 1.0);
          x = Math.cos(a) * rr; z = Math.sin(a) * rr;
          if (!blocked(x, z)) { ok = true; break; }
        }
        if (!ok) continue;
        const R0 = 0.24 + R() * 0.16;
        const H0 = 0.22 + R() * 0.16;
        for (let l = 0; l < PER; l++) {
          const th = R() * TAU, ph = Math.acos(2 * R() - 1);
          const rr = Math.pow(R(), 0.45);
          const px = Math.sin(ph) * Math.cos(th) * rr * R0;
          const py = Math.cos(ph) * rr * H0 * 0.95 + H0 * 0.80;
          const pz = Math.sin(ph) * Math.sin(th) * rr * R0;
          dummy.position.set(x + px, Math.max(0.045, py), z + pz);
          dummy.rotation.set(R() * TAU, R() * TAU, R() * TAU);
          const sc = 0.75 + R() * 0.85;
          dummy.scale.set(sc, sc, sc);
          dummy.updateMatrix();
          inst.setMatrixAt(idx, dummy.matrix);
          const up = clamp(py / (H0 * 1.7), 0, 1);
          const v = (0.14 + R() * 0.09) * (0.65 + up * 0.88);
          col.setRGB(v * 0.62, v * 1.48, v * 0.46);
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

    // ---- 野花：精致簇状点缀，温润粉白紫黄配色 ----
    {
      const N = 860;
      const geo = new T.CircleGeometry(0.035, 5);
      geo.rotateX(-Math.PI / 2);
      const mat = new T.MeshStandardMaterial({
        vertexColors: false, side: T.DoubleSide, roughness: 0.86, metalness: 0,
        envMapIntensity: 0.18, emissive: 0xffeef4, emissiveIntensity: 0.08,
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
        // 成簇聚合：噪波控制成片花丛，留出干净草坪呼吸空间
        const cl = fbm(x * 2.4 + 5, 0.7, z * 2.4 - 3, 2);
        if (cl < -0.05 && R() < 0.82) continue;
        dummy.position.set(x, 0.085 + R() * 0.03, z);
        dummy.rotation.set(0, R() * TAU, 0);
        const sc = 0.65 + R() * 0.75;
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

    // ---- 青苔景石（含岸线半浸礁石） ----
    {
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
        const s = 0.14 + R() * 0.16;
        const g = new T.SphereGeometry(s, 8, 6);   // 用索引几何，mergeGeos 需要 index
        const p = g.attributes.position;
        for (let vi = 0; vi < p.count; vi++) {
          const vx = p.getX(vi), vy = p.getY(vi), vz = p.getZ(vi);
          const n = fbm(vx * 14 + i * 3, vy * 14, vz * 14, 2) * 0.30;
          p.setXYZ(vi, vx * (1 + n), vy * (0.72 + n * 0.6), vz * (1 + n));
        }
        g.computeVertexNormals();
        // 顶点色：顶上青苔绿，底部石灰
        const cnt = p.count;
        const cols = new Float32Array(cnt * 3);
        for (let vi = 0; vi < cnt; vi++) {
          const vy = p.getY(vi);
          const up = smoothstep(-s * 0.22, s * 0.50, vy);
          // 底部石灰、顶部青苔
          const g0 = 0.34 + vy * 0.02;
          cols[vi * 3]     = lerp(g0, 0.22, up);
          cols[vi * 3 + 1] = lerp(g0 * 0.96, 0.48, up);
          cols[vi * 3 + 2] = lerp(g0 * 0.92, 0.20, up);
        }
        g.setAttribute('color', new T.BufferAttribute(cols, 3));
        rockGeos.push(g.clone().translate(x, s * 0.45, z));
      }
      // 岸线礁石：使用独立种子 sr 压住岛沿，打破圆盘生硬轮廓且不影响主随机流
      const sr = rng(8821);
      const shoreAngles = [0.38, 1.42, 2.58, 3.85, 5.15];
      for (let i = 0; i < shoreAngles.length; i++) {
        const a = shoreAngles[i] + (sr() - 0.5) * 0.18;
        const lobe = 1
          + 0.045 * Math.sin(a * 7 + 0.9)
          + 0.025 * Math.cos(a * 13 - 0.6);
        const rr = IR * lobe * (0.95 + sr() * 0.05);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        const s = 0.20 + sr() * 0.16;
        const g = new T.SphereGeometry(s, 8, 6);
        const p = g.attributes.position;
        for (let vi = 0; vi < p.count; vi++) {
          const vx = p.getX(vi), vy = p.getY(vi), vz = p.getZ(vi);
          const n = fbm(vx * 12 + i * 5, vy * 12, vz * 12, 2) * 0.32;
          p.setXYZ(vi, vx * (1.25 + n), vy * (0.62 + n * 0.45), vz * (1.10 + n));
        }
        g.computeVertexNormals();
        const cnt = p.count;
        const cols = new Float32Array(cnt * 3);
        for (let vi = 0; vi < cnt; vi++) {
          const vy = p.getY(vi);
          const up = smoothstep(-s * 0.15, s * 0.45, vy);
          const g0 = 0.30 + vy * 0.02;
          cols[vi * 3]     = lerp(g0, 0.24, up);
          cols[vi * 3 + 1] = lerp(g0 * 0.95, 0.46, up);
          cols[vi * 3 + 2] = lerp(g0 * 0.90, 0.22, up);
        }
        g.setAttribute('color', new T.BufferAttribute(cols, 3));
        rockGeos.push(g.clone().translate(x, -0.04, z));
      }
      if (rockGeos.length) {
        const rm = new T.Mesh(mergeGeos(rockGeos), new T.MeshStandardMaterial({
          vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.24,
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

  /* ---- 鸟：身体 + 头 + 喙 + 尾 + 一对弧形翼 ---- */
  function makeBirdMesh(matBody, matWing) {
    const g = new T.Group();

    // 身体（长椭球）
    const body = new T.Mesh(new T.SphereGeometry(0.040, 10, 8), matBody);
    body.scale.set(1.0, 0.92, 2.0);
    g.add(body);

    // 头
    const head = new T.Mesh(new T.SphereGeometry(0.026, 9, 7), matBody);
    head.position.set(0, 0.014, 0.062);
    g.add(head);

    // 喙
    const beak = new T.Mesh(new T.ConeGeometry(0.009, 0.030, 6), matBody);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.010, 0.094);
    g.add(beak);

    // 尾（扁平三角）
    const tailGeo = new T.BufferGeometry();
    tailGeo.setAttribute('position', new T.Float32BufferAttribute([
      0, 0, -0.070,
      -0.052, 0.004, -0.140,
      0.052, 0.004, -0.140,
    ], 3));
    tailGeo.setIndex([0, 1, 2]);
    tailGeo.computeVertexNormals();
    const tail = new T.Mesh(tailGeo, matWing);
    g.add(tail);

    // 翅膀：用分段的弧形平面，绕身体轴上下扇动
    function makeWing(side) {
      const SEG = 6;
      const geo = new T.PlaneGeometry(0.175, 0.085, SEG, 2);
      geo.rotateX(-Math.PI / 2);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        // 翼型：外段收窄 + 上反角
        const ax = Math.abs(x) / 0.0875;
        p.setY(i, ax * ax * 0.030 + z * 0.10);
        p.setZ(i, z * (1.0 - 0.35 * ax));
      }
      geo.computeVertexNormals();
      const m = new T.Mesh(geo, matWing);
      m.position.set(side * 0.030, 0.012, 0.005);
      m.scale.x = side;
      return m;
    }
    const wingL = makeWing(1);
    const wingR = makeWing(-1);
    g.add(wingL); g.add(wingR);

    return { g, wingL, wingR };
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
    // ---- 飞鸟 ----
    const birdBodyMat = new T.MeshStandardMaterial({ color: 0x342c38, roughness: 0.85, metalness: 0 });
    const birdWingMat = new T.MeshStandardMaterial({
      color: 0x2b2430, roughness: 0.8, metalness: 0, side: T.DoubleSide,
    });
    const FLOCKS = [
      { cx: -18, cz: -34, r: 16, y: 11.5, spd: 0.16 },
      { cx: 26, cz: -26, r: 12, y: 10.0, spd: -0.20 },
      { cx: 4, cz: -46, r: 22, y: 13.0, spd: 0.12 },
    ];
    for (const F of FLOCKS) {
      const n = 5 + Math.floor(R() * 4);
      for (let i = 0; i < n; i++) {
        const b = makeBirdMesh(birdBodyMat, birdWingMat);
        b.g.scale.setScalar(1.5 + R() * 1.0);
        scene.add(b.g);
        birdFlock.push({
          g: b.g, wl: b.wingL, wr: b.wingR,
          cx: F.cx + (R() - 0.5) * 5,
          cz: F.cz + (R() - 0.5) * 5,
          r: F.r * (0.78 + R() * 0.45),
          y: F.y + (R() - 0.5) * 2.4,
          spd: F.spd * (0.9 + R() * 0.2),
          ph: R() * TAU,
          flap: 5.0 + R() * 2.5,
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
    // 飞鸟
    for (const b of birdFlock) {
      const a = b.ph + t * b.spd;
      const x = b.cx + Math.cos(a) * b.r;
      const z = b.cz + Math.sin(a) * b.r;
      b.g.position.set(x, b.y + Math.sin(t * 0.7 + b.ph) * 0.8, z);
      const dir = Math.sign(b.spd);
      // 面向飞行方向（模型的 +Z 是机头）
      b.g.rotation.y = -a + (dir > 0 ? 0 : Math.PI);
      b.g.rotation.z = Math.sin(t * 0.9 + b.ph) * 0.12;
      const f = Math.sin(t * b.flap + b.ph) * 0.85;
      b.wl.rotation.z = f;
      b.wr.rotation.z = -f;
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

  /* ---------- 12d. 野餐垫 / 茶具 / 竹篮 ---------- */
  function buildPicnic() {
    const g = new T.Group();
    g.name = 'picnic';

    // 位置：长椅前方草地上（避开树根与椅腿）
    const PX = -0.10, PZ = 1.98, ROT = -0.38;

    // ---- 野餐垫：圆角布垫 + 格纹顶点色 ----
    {
      const W = 0.86, D = 0.62, SEG = 16;
      const geo = new T.PlaneGeometry(W, D, SEG, SEG);
      geo.rotateX(-Math.PI / 2);
      const p = geo.attributes.position;
      const cols = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        // 轻微起伏，贴合草地
        p.setY(i, 0.012 + Math.sin(x * 9.0) * 0.004 + Math.cos(z * 11.0) * 0.004);
        // 格纹：两色交替
        const cx = Math.floor((x / W + 0.5) * 6);
        const cz = Math.floor((z / D + 0.5) * 5);
        const on = (cx + cz) % 2 === 0;
        const base = on ? [0.92, 0.55, 0.66] : [0.99, 0.95, 0.90];
        cols[i * 3] = base[0]; cols[i * 3 + 1] = base[1]; cols[i * 3 + 2] = base[2];
      }
      geo.setAttribute('color', new T.BufferAttribute(cols, 3));
      geo.computeVertexNormals();
      const mat = new T.MeshStandardMaterial({
        vertexColors: true, roughness: 0.95, metalness: 0, side: T.DoubleSide,
        envMapIntensity: 0.12,
      });
      const cloth = new T.Mesh(geo, mat);
      cloth.position.set(PX, 0.155, PZ);
      cloth.rotation.y = ROT;
      cloth.receiveShadow = true;
      g.add(cloth);
    }

    // ---- 茶壶 ----
    const porcelain = new T.MeshStandardMaterial({
      color: 0xf7f2ea, roughness: 0.32, metalness: 0.0, envMapIntensity: 0.55,
    });
    const porcelain2 = new T.MeshStandardMaterial({
      color: 0xdfe9f2, roughness: 0.30, metalness: 0.0, envMapIntensity: 0.55,
    });
    {
      const pot = new T.Group();
      const body = new T.Mesh(new T.SphereGeometry(0.062, 14, 10), porcelain);
      body.scale.y = 0.82; body.castShadow = true;
      pot.add(body);
      // 盖
      const lid = new T.Mesh(new T.SphereGeometry(0.040, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), porcelain);
      lid.position.y = 0.040; lid.castShadow = true;
      pot.add(lid);
      const knob = new T.Mesh(new T.SphereGeometry(0.011, 8, 6), porcelain);
      knob.position.y = 0.062; pot.add(knob);
      // 壶嘴
      const spout = new T.Mesh(new T.CylinderGeometry(0.010, 0.017, 0.075, 8), porcelain);
      spout.position.set(0.062, 0.006, 0);
      spout.rotation.z = -0.72;
      spout.castShadow = true;
      pot.add(spout);
      // 把手（半环）
      const handle = new T.Mesh(new T.TorusGeometry(0.040, 0.0085, 8, 14, Math.PI * 1.15), porcelain);
      handle.position.set(-0.058, 0.012, 0);
      handle.rotation.y = Math.PI / 2;
      handle.rotation.z = -0.3;
      pot.add(handle);
      pot.position.set(PX - 0.04, 0.215, PZ - 0.07);
      pot.rotation.y = ROT + 0.4;
      pot.scale.setScalar(1.35);
      g.add(pot);
    }

    // ---- 两只茶杯 ----
    for (let i = 0; i < 2; i++) {
      const cup = new T.Group();
      const body = new T.Mesh(new T.CylinderGeometry(0.030, 0.024, 0.036, 12), porcelain2);
      body.castShadow = true;
      cup.add(body);
      const rim = new T.Mesh(new T.TorusGeometry(0.030, 0.0035, 6, 14), porcelain);
      rim.rotation.x = Math.PI / 2; rim.position.y = 0.018;
      cup.add(rim);
      const saucer = new T.Mesh(new T.CylinderGeometry(0.048, 0.044, 0.006, 14), porcelain);
      saucer.position.y = -0.022;
      cup.add(saucer);
      cup.position.set(
        PX + 0.16 + i * 0.10,
        0.182,
        PZ + 0.03 + i * 0.10
      );
      g.add(cup);
    }

    // ---- 竹篮 ----
    {
      const wicker = new T.MeshStandardMaterial({ color: 0xa8814f, roughness: 0.92, metalness: 0 });
      const wickerDark = new T.MeshStandardMaterial({ color: 0x8a6839, roughness: 0.95, metalness: 0 });
      const basket = new T.Group();
      const body = new T.Mesh(new T.CylinderGeometry(0.085, 0.070, 0.085, 14, 1, true), wicker);
      body.material.side = T.DoubleSide;
      body.castShadow = true;
      basket.add(body);
      const bottom = new T.Mesh(new T.CylinderGeometry(0.070, 0.070, 0.008, 14), wickerDark);
      bottom.position.y = -0.042;
      basket.add(bottom);
      // 提手
      const handle = new T.Mesh(new T.TorusGeometry(0.078, 0.007, 6, 16, Math.PI), wickerDark);
      handle.position.y = 0.042;
      basket.add(handle);
      // 里面露出的布
      const cloth = new T.Mesh(new T.SphereGeometry(0.055, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new T.MeshStandardMaterial({ color: 0xf3e6d8, roughness: 0.95 }));
      cloth.position.y = 0.012; cloth.scale.y = 0.55;
      basket.add(cloth);
      basket.position.set(PX + 0.30, 0.185, PZ - 0.16);
      basket.scale.setScalar(1.3);
      basket.rotation.y = ROT - 0.3;
      g.add(basket);
    }

    islandGroup.add(g);
    return g;
  }
  const picnic = buildPicnic();
