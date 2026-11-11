/* ============================================================
   樱花树下 · Sakura Isle
   高质感 CG · 圆形小岛 · 垂枝樱花
   ============================================================ */
(async function () {
  'use strict';

  const T = globalThis.THREE;
  const OrbitControls = globalThis.OrbitControls;

  /* ---------- 0a. 加载进度 & 分帧 ---------- */
  // 真实进度：每个构建阶段结束后调用；yieldFrame 让浏览器有机会重绘进度条
  const PROG = (p, txt) => { try { if (window.__setProgress) window.__setProgress(p, txt); } catch (e) { } };
  const yieldFrame = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
  PROG(2, '初始化');

  /* ---------- 0. 工具 ---------- */
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const R = rng(20261109);

  // 简单 3D 值噪声
  const NoiseSeed = (function () {
    const p = new Uint8Array(512), nr = rng(99);
    const tmp = new Uint8Array(256);
    for (let i = 0; i < 256; i++) tmp[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(nr() * (i + 1)); const t = tmp[i]; tmp[i] = tmp[j]; tmp[j] = t; }
    for (let i = 0; i < 512; i++) p[i] = tmp[i & 255];
    return p;
  })();
  function noise3(x, y, z) {
    const p = NoiseSeed;
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, zi = Math.floor(z) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y), zf = z - Math.floor(z);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const A = p[xi] + yi, AA = p[A] + zi, AB = p[A + 1] + zi;
    const B = p[xi + 1] + yi, BA = p[B] + zi, BB = p[B + 1] + zi;
    const g = (h) => ((h & 15) / 15) * 2 - 1;
    const x1 = lerp(g(p[AA]), g(p[BA]), u);
    const x2 = lerp(g(p[AB]), g(p[BB]), u);
    const y1 = lerp(x1, x2, v);
    const A2 = p[xi] + yi + 1, AA2 = p[A2] + zi, AB2 = p[A2 + 1] + zi;
    const B2 = p[xi + 1] + yi + 1, BA2 = p[B2] + zi, BB2 = p[B2 + 1] + zi;
    const x3 = lerp(g(p[AA2]), g(p[BA2]), u);
    const x4 = lerp(g(p[AB2]), g(p[BB2]), u);
    const y2 = lerp(x3, x4, v);
    return lerp(y1, y2, w);
  }
  const fbm = (x, y, z, oct) => {
    let v = 0, a = 0.5, f = 1;
    for (let i = 0; i < (oct || 3); i++) { v += a * noise3(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
    return v;
  };

  /* ---------- 0b. 统一风场 ---------- */
  // 全局风：风向 / 强度 / 阵风。树、草、海面、飞沫、落花、丝带全部读这一份，
  // 保证整个场景是「同一阵风」在吹，而不是各自乱抖。
  const WIND = {
    dirAngle: 0.62,        // 主风向（弧度）
    strength: 1.0,         // 当前强度（含阵风）
    gust: 0.0,             // 0~1 阵风因子
    vec: new T.Vector2(Math.cos(0.62), Math.sin(0.62)),
  };
  const windUniforms = {
    uWindDir: { value: new T.Vector2(Math.cos(0.62), Math.sin(0.62)) },
    uWindStr: { value: 1.0 },
    uGust: { value: 0.0 },
  };
  // 由主循环每帧调用（放在 part4）
  function updateWind(t) {
    // 两层慢速噪声叠出自然阵风节奏
    const g1 = fbm(t * 0.11, 7.3, 0.5, 2) * 0.5 + 0.5;
    const g2 = Math.sin(t * 0.37 + 1.1) * 0.5 + 0.5;
    WIND.gust = g1 * 0.68 + g2 * 0.32;
    WIND.strength = 0.58 + WIND.gust * 0.95;          // 0.58 ~ 1.53
    // 风向缓慢摆动 ±20°
    const ang = WIND.dirAngle + Math.sin(t * 0.09) * 0.35 + Math.sin(t * 0.23) * 0.08;
    WIND.vec.set(Math.cos(ang), Math.sin(ang));
    windUniforms.uWindDir.value.copy(WIND.vec);
    windUniforms.uWindStr.value = WIND.strength;
    windUniforms.uGust.value = WIND.gust;
  }

  /* ---------- 0c. 自适应质量框架 ---------- */
  // 把可降级的 InstancedMesh 登记进来；低帧率时按档位缩减 .count
  const INST_REGISTRY = [];
  function regInst(mesh, label) {
    if (!mesh) return;
    INST_REGISTRY.push({ mesh, label, max: mesh.count });
  }
  const QUALITY = {
    tiers: [
      { name: 'low', scale: 0.42 },
      { name: 'mid', scale: 0.68 },
      { name: 'high', scale: 1.00 },
    ],
    tier: 2,          // 默认高
    auto: true,
    _accT: 0, _accN: 0, _window: 0, _lowStreak: 0,
  };
  function applyQuality() {
    const sc = QUALITY.tiers[QUALITY.tier].scale;
    for (const r of INST_REGISTRY) {
      r.mesh.count = Math.max(1, Math.floor(r.max * sc));
    }
  }
  function setQualityTier(t) {
    QUALITY.tier = clamp(t | 0, 0, QUALITY.tiers.length - 1);
    applyQuality();
  }

  /* ---------- 1. 世界 ---------- */
  const WORLD = {
    islandR: 5.20,      // 岛半径
    grassY: 0.0,        // 草地基准
    seatY: -0.58,       // 土层厚度（岛底）
    waterY: -0.62,      // 水面高度
  };

  /* ---------- 2. 渲染器 ---------- */
  const app = document.getElementById('app');
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.NoToneMapping;
  renderer.outputColorSpace = T.SRGBColorSpace;
  app.appendChild(renderer.domElement);

  const scene = new T.Scene();
  const fogColor = new T.Color(0xdfeaf2);
  scene.fog = new T.FogExp2(fogColor.getHex(), 0.012);

  const camera = new T.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 300);
  const CAM_START = new T.Vector3(3.0, 6.5, 12.5);
  const CAM_END = new T.Vector3(5.2, 3.9, 12.2);
  camera.position.copy(CAM_START);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2.05, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.minDistance = 0.6;                 // 允许贴近看花瓣
  controls.maxDistance = 180;                  // 允许拉远看整片花海
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI * 0.505;   // 略低于水平即止，避免看到岛底穿模   // 别钻到海面以下
  // ★ 打开平移：右键 / 双指拖动可以移动视点，不再被钉在树干上
  controls.enablePan = true;
  controls.panSpeed = 1.15;
  controls.screenSpacePanning = true;
  controls.zoomSpeed = 0.95;
  controls.rotateSpeed = 0.85;
  controls.autoRotateSpeed = 0.28;
  controls.enabled = false;

  // 按窗口宽高比自动调整机位距离：竖屏时拉远，保证能看到全景
  const VIEW_TARGET = new T.Vector3(0, 4.85, 0);
  const BASE_DIST = CAM_END.distanceTo(VIEW_TARGET) * 1.70;
  function fitViewDistance() {
    const aspect = window.innerWidth / window.innerHeight;
    // aspect >= 1.35 时用基准距离；越窄拉得越远
    const k = aspect >= 1.35 ? 1.0 : Math.pow(1.35 / aspect, 0.82);
    return BASE_DIST * k;
  }
  function applyFitView() {
    const d = fitViewDistance();
    const dir = CAM_END.clone().sub(VIEW_TARGET).normalize();
    camera.position.copy(VIEW_TARGET).addScaledVector(dir, d);
    controls.target.copy(VIEW_TARGET);
    controls.update();
  }
  /* ---------- 3. 灯光 ---------- */
  const hemi = new T.HemisphereLight(0xdcecff, 0x4a5a38, 0.62);
  scene.add(hemi);

  const sun = new T.DirectionalLight(0xfff0dd, 3.0);
  sun.position.set(-6.5, 7.2, 5.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -11; sc.right = 11; sc.top = 11; sc.bottom = -11; sc.near = 0.5; sc.far = 48;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.055;
  sun.shadow.radius = 2.6;
  scene.add(sun);
  scene.add(sun.target);
  sun.target.position.set(0, 1.0, 0);

  const fill = new T.DirectionalLight(0xbcd4ff, 0.55);
  fill.position.set(6, 3.5, -5);
  scene.add(fill);

  /* ---------- 4. 天空 ---------- */
  const skyUniforms = {
    uTop: { value: new T.Color(0x3d7bc4) },
    uMid: { value: new T.Color(0xa9cdea) },
    uBot: { value: new T.Color(0xe8eef2) },
    uSunDir: { value: new T.Vector3(-0.6, 0.55, 0.45).normalize() },
    uSunColor: { value: new T.Color(0xfff4e0) },
    uSunSize: { value: 0.9992 },
    uTime: { value: 0 },
    uCloud: { value: 0.26 },      // 云的多少
    uCloudWet: { value: 0.0 },    // 阴雨程度 0~1，越大云越铅灰、天空越暗
    uCloudTint: { value: new T.Color(0xffffff) },
    uGlow: { value: new T.Color(0xff8a3d) },    // 夕照金橙
    uSunset: { value: 0.0 },                    // 0=白天 1=黄昏
  };
  const sky = new T.Mesh(
    new T.SphereGeometry(140, 48, 32),
    new T.ShaderMaterial({
      uniforms: skyUniforms,
      side: T.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vWPos;
        void main(){
          vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uTop, uMid, uBot, uSunColor, uSunDir, uCloudTint, uGlow;
        uniform float uSunset;
        uniform float uSunSize, uTime, uCloud, uCloudWet;
        varying vec3 vWPos;

        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1,0)), f.x),
                     mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y);
        }
        float fbm2(vec2 p){
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { s += n2(p) * a; p *= 2.03; a *= 0.5; }
          return s;
        }

        void main(){
          vec3 dir = normalize(vWPos - cameraPosition);   // 真实视线方向，太阳不再因球心视差而偏位
          float h = clamp(dir.y, -1.0, 1.0);
          vec3 col = mix(uBot, uMid, smoothstep(-0.05, 0.30, h));
          col = mix(col, uTop, smoothstep(0.22, 0.85, h));

          // ---- 云层：把视线投影到一块虚拟云板上 ----
          float cl = 0.0;
          float thick = 0.0;
          if (dir.y > 0.015) {
            vec2 cp = dir.xz / max(dir.y, 0.045);
            cp = cp * 0.42 + vec2(uTime * 0.0075, uTime * 0.0042);
            float n = fbm2(cp * 0.85);
            n += 0.45 * fbm2(cp * 2.3 + 13.7);
            n /= 1.45;
            thick = pow(clamp(n, 0.0, 1.0), 1.25);
            // 覆盖度：uCloud 越大，云的阈值越低
            float thr = 1.06 - uCloud * 0.92;
            cl = smoothstep(thr, thr + 0.20, n);
            // 地平线附近淡出，避免出现硬边
            cl *= smoothstep(0.015, 0.16, dir.y);
          }

          // ---- 夕照金橙：地平线朝向太阳一侧的暖光 ----
          {
            vec2 dh = normalize(dir.xz + vec2(1e-5));
            vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
            float toward = pow(clamp(dot(dh, sh) * 0.5 + 0.5, 0.0, 1.0), 2.2);
            float band = smoothstep(0.55, 0.02, abs(dir.y - 0.04));
            col = mix(col, uGlow, band * (0.28 + 0.72 * toward) * uSunset * 0.85);
            // 贴近太阳的强辉光
            float nearSun = pow(clamp(dot(dir, normalize(uSunDir)), 0.0, 1.0), 6.0);
            col += uGlow * nearSun * uSunset * 0.55;
          }

          // 云的颜色：受自身厚度、太阳方向、阴雨程度影响
          vec3 cc = uCloudTint;
          cc *= 0.50 + 0.95 * thick;                 // 加对比，阴天也能看出云块
          float s = pow(clamp(dot(dir, normalize(uSunDir)), 0.0, 1.0), 4.0);
          cc += uSunColor * s * 0.40;                       // 朝阳一侧的镶亮边
          cc = mix(cc, uGlow * (0.55 + 0.65 * thick), uSunset * 0.72 * s);   // 夕阳把云染成金红
          cc = mix(cc, vec3(0.38, 0.41, 0.47), uCloudWet * 0.70);   // 阴雨天压成铅灰
          col = mix(col, cc, cl * 0.95);
          col *= (1.0 - uCloudWet * 0.20);                  // 阴天整体压暗（别压太死）

          // 太阳圆盘 + 光晕
          float d = dot(dir, normalize(uSunDir));
          float disk = smoothstep(uSunSize, uSunSize + 0.0006, d);
          float halo = pow(clamp(d, 0.0, 1.0), 220.0) * 0.5
                     + pow(clamp(d, 0.0, 1.0), 24.0) * 0.13;
          // 阴雨天太阳被云遮住
          float sunVis = 1.0 - uCloudWet * 0.85;
          col += uSunColor * (disk * 6.0 + halo) * sunVis;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  sky.frustumCulled = false;
  scene.add(sky);

  PROG(10, '铺设天空');
  await yieldFrame();

  /* ---------- 5. 几何工具 ---------- */
  function TRS(x, y, z, rx, ry, rz, sx, sy, sz) {
    const q = new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0));
    return new T.Matrix4().compose(
      new T.Vector3(x, y, z), q,
      new T.Vector3(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz)
    );
  }
  function sanitize(geo) {
    const n = geo.attributes.normal;
    if (n) {
      const a = n.array;
      for (let i = 0; i < a.length; i += 3) {
        const L2 = a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2];
        if (!isFinite(L2) || L2 < 1e-12) { a[i] = 0; a[i + 1] = 1; a[i + 2] = 0; }
        else { const L = Math.sqrt(L2); a[i] /= L; a[i + 1] /= L; a[i + 2] /= L; }
      }
      n.needsUpdate = true;
    }
    return geo;
  }
  function mergeGeos(list) {
    let tv = 0, ti = 0;
    for (const g of list) { tv += g.attributes.position.count; ti += g.index.count; }
    const pos = new Float32Array(tv * 3), nor = new Float32Array(tv * 3), col = new Float32Array(tv * 3), uv = new Float32Array(tv * 2);
    const idx = tv > 65535 ? new Uint32Array(ti) : new Uint16Array(ti);
    let vo = 0, io = 0;
    for (const g of list) {
      pos.set(g.attributes.position.array, vo * 3);
      nor.set(g.attributes.normal.array, vo * 3);
      if (g.attributes.color) col.set(g.attributes.color.array, vo * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      vo += g.attributes.position.count;
      io += gi.length;
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('color', new T.BufferAttribute(col, 3));
    out.setAttribute('uv', new T.BufferAttribute(uv, 2));
    out.setIndex(new T.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }
  function colored(geo, color) {
    const c = geo.attributes.position.count;
    const arr = new Float32Array(c * 3);
    const cc = new T.Color(color);
    for (let i = 0; i < c; i++) { arr[i * 3] = cc.r; arr[i * 3 + 1] = cc.g; arr[i * 3 + 2] = cc.b; }
    geo.setAttribute('color', new T.BufferAttribute(arr, 3));
    if (!geo.attributes.uv) {
      const uv = new Float32Array(c * 2);
      geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    }
    return geo;
  }

  /* ---------- 6. 圆形地台 ---------- */
  const islandGroup = new T.Group();
  scene.add(islandGroup);

  function buildIsland() {
    const SEG = 96, RINGS = 24;
    const positions = [], colors = [], uvs = [], indices = [];
    const cTmp = new T.Color();

    // 顶面草地（极坐标）
    for (let ri = 0; ri <= RINGS; ri++) {
      const t = ri / RINGS;
      for (let si = 0; si < SEG; si++) {
        const th = (si / SEG) * TAU;
        const rr = Math.pow(t, 1.0) * WORLD.islandR;
        // 边缘轮廓（与侧壁同一套起伏，避免接缝错开）
        const edge = 1 + 0.018 * fbm(Math.cos(th) * 2.2, 0.7, Math.sin(th) * 2.2, 2)
                       + 0.038 * Math.sin(th * 7.0 + 1.3)
                       + 0.023 * Math.sin(th * 13.0 + 0.7);
        const r = rr * edge;
        const x = Math.cos(th) * r, z = Math.sin(th) * r;
        // 地表起伏（很轻微，主要给草的层次）
        const y = 0.035 * fbm(x * 0.85, 0.4, z * 0.85, 2)
                + 0.015 * fbm(x * 2.6, 1.1, z * 2.6, 2);
        positions.push(x, y, z);

        // 草地颜色：深浅斑驳
        const n1 = fbm(x * 1.6 + 4, 0.8, z * 1.6 - 2, 3);
        const n2 = fbm(x * 5.5 - 3, 1.6, z * 5.5 + 6, 2);
        cTmp.setRGB(0.18, 0.34, 0.12);
        cTmp.lerp(new T.Color(0.32, 0.52, 0.16), smoothstep(-0.3, 0.5, n1));
        cTmp.lerp(new T.Color(0.12, 0.24, 0.09), smoothstep(0.1, 0.6, n2) * 0.45);
        // 靠近边缘略深
        cTmp.multiplyScalar(lerp(1.0, 0.78, smoothstep(0.82, 1.0, t)));
        // 岛缘露土：草地到侧壁之间加一圈土色过渡
        cTmp.lerp(new T.Color(0.35, 0.27, 0.17), smoothstep(0.93, 1.0, t) * 0.38);
        colors.push(cTmp.r, cTmp.g, cTmp.b);
        uvs.push(x * 0.25, z * 0.25);
      }
    }
    for (let ri = 0; ri < RINGS; ri++) {
      for (let si = 0; si < SEG; si++) {
        const a = ri * SEG + si, b = ri * SEG + ((si + 1) % SEG);
        const c = (ri + 1) * SEG + si, d = (ri + 1) * SEG + ((si + 1) % SEG);
        indices.push(a, c, b, b, c, d);
      }
    }
    const topGeo = new T.BufferGeometry();
    topGeo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    topGeo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    topGeo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    topGeo.setIndex(indices);
    topGeo.computeVertexNormals(); sanitize(topGeo);

    const topMat = new T.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0.0,
    });
    const top = new T.Mesh(topGeo, topMat);
    top.receiveShadow = true;
    islandGroup.add(top);

    // 侧面土层
    const sidePos = [], sideCol = [], sideUv = [], sideIdx = [];
    const SR = 10;
    const segs = 96;
    for (let ri = 0; ri <= SR; ri++) {
      const t = ri / SR;
      for (let si = 0; si < segs; si++) {
        const th = (si / segs) * TAU;
        // 轮廓：7/13 瓣低频起伏 + 细碎噪声，侧壁不再是光滑圆柱
        const edge = 1 + 0.038 * Math.sin(th * 7.0 + 1.3)
                       + 0.023 * Math.sin(th * 13.0 + 0.7)
                       + 0.017 * fbm(Math.cos(th) * 2.6 + 5, 1.7, Math.sin(th) * 2.6 - 3, 2);
        // 中段微微鼓出 + 底部收圆
        const bulge = 1 + 0.050 * Math.sin(t * Math.PI) * (0.6 + 0.4 * Math.sin(th * 9.0));
        const shrink = (1 - 0.16 * Math.pow(t, 1.9)) * bulge;
        const r = WORLD.islandR * edge * shrink;
        const x = Math.cos(th) * r, z = Math.sin(th) * r;
        let y = lerp(0.0, WORLD.seatY, Math.pow(t, 0.9));
        // 纵向侵蚀沟（越往下越深）
        y -= 0.030 * Math.abs(Math.sin(th * 11.0 + 0.4)) * Math.pow(t, 0.7);
        sidePos.push(x, y, z);

        const n = fbm(x * 1.4 + 10, y * 2.2, z * 1.4, 3);
        if (t < 0.13) {
          cTmp.setRGB(0.24, 0.36, 0.15).lerp(new T.Color(0.33, 0.25, 0.14), t / 0.13);
        } else if (t < 0.55) {
          const u = (t - 0.13) / 0.42;
          cTmp.setRGB(0.28, 0.21, 0.12).lerp(new T.Color(0.36, 0.25, 0.14), u);
          cTmp.lerp(new T.Color(0.22, 0.15, 0.09), smoothstep(0.4, 1.0, u));
        } else {
          const u = (t - 0.55) / 0.45;
          cTmp.setRGB(0.22, 0.15, 0.09).lerp(new T.Color(0.30, 0.27, 0.24), u);
        }
        // 纵向深浅条纹：泥土分层感
        const stripe = 0.5 + 0.5 * Math.sin(th * 26.0 + fbm(x * 2.0, 3.0, z * 2.0, 2) * 4.0);
        cTmp.multiplyScalar(0.80 + stripe * 0.32);
        cTmp.offsetHSL(0, 0, n * 0.045);
        sideCol.push(cTmp.r, cTmp.g, cTmp.b);
        sideUv.push(si / segs * 4, t * 1.2);
      }
    }
    for (let ri = 0; ri < SR; ri++) {
      for (let si = 0; si < segs; si++) {
        const a = ri * segs + si, b = ri * segs + ((si + 1) % segs);
        const c = (ri + 1) * segs + si, d = (ri + 1) * segs + ((si + 1) % segs);
        sideIdx.push(a, b, c, b, d, c);
      }
    }
    const sideGeo = new T.BufferGeometry();
    sideGeo.setAttribute('position', new T.Float32BufferAttribute(sidePos, 3));
    sideGeo.setAttribute('color', new T.Float32BufferAttribute(sideCol, 3));
    sideGeo.setAttribute('uv', new T.Float32BufferAttribute(sideUv, 2));
    sideGeo.setIndex(sideIdx);
    sideGeo.computeVertexNormals(); sanitize(sideGeo);
    const side = new T.Mesh(sideGeo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.97 }));
    side.castShadow = true;
    side.receiveShadow = true;
    islandGroup.add(side);
  }
  buildIsland();

  /* ---------- 6a. 岛下接地软阴影（水面不吃实时阴影，手贴一张径向渐变） ---------- */
  (function buildGroundShadow() {
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g2 = cv.getContext('2d');
    const grd = g2.createRadialGradient(S / 2, S / 2, S * 0.22, S / 2, S / 2, S * 0.50);
    grd.addColorStop(0.00, 'rgba(26,30,28,0.40)');
    grd.addColorStop(0.55, 'rgba(26,30,28,0.16)');
    grd.addColorStop(1.00, 'rgba(26,30,28,0.00)');
    g2.fillStyle = grd;
    g2.fillRect(0, 0, S, S);
    const tx = new T.CanvasTexture(cv);
    tx.colorSpace = T.SRGBColorSpace;
    const size = WORLD.islandR * 2.15;
    const m = new T.Mesh(
      new T.PlaneGeometry(size, size),
      new T.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, WORLD.waterY + 0.012, 0);
    m.renderOrder = 2;
    scene.add(m);
  })();

  /* ---------- 6b. 岸边落花带：岛缘外一圈密集花瓣，越外越稀 ---------- */
  const shorePetals = (function buildShorePetals() {
    const N = 1200;
    const geo = makeSeaPetalGeo();
    const mat = new T.MeshStandardMaterial({
      color: 0xffe2ee,
      roughness: 0.92,
      metalness: 0.0,
      side: T.DoubleSide,
      emissive: 0xff9fc2,
      emissiveIntensity: 0.24,
    });
    const inst = new T.InstancedMesh(geo, mat, N);
    inst.frustumCulled = false;
    const dummy = new T.Object3D();
    for (let i = 0; i < N; i++) {
      // 越靠岛缘越密
      const rr = WORLD.islandR * 1.01 + Math.pow(R(), 1.85) * 1.05;
      const a = R() * TAU;
      dummy.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      dummy.rotation.set(-Math.PI / 2 + (R() - 0.5) * 0.5, R() * TAU, (R() - 0.5) * 0.4);
      const s = 0.75 + R() * 0.95;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.position.y = WORLD.waterY + 0.022;
    scene.add(inst);
    return inst;
  })();

  PROG(22, '堆起小岛');
  await yieldFrame();

  /* ---------- 6c. 远景山峦与森林剪影（拉开纵深） ---------- */
  // 环形"幕布"式山脊：内圈可见，越远越淡
  function buildRidge(radius, baseY, hMin, hMax, segs, cLowHex, cHighHex, seedOff, jitter) {
    const pos = [], col = [], idx = [];
    const cLow = new T.Color(cLowHex), cHigh = new T.Color(cHighHex);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * TAU;
      const nx = Math.cos(a), nz = Math.sin(a);
      // 多频噪声堆山脊
      let h = fbm(nx * 2.3 + seedOff, 3.3, nz * 2.3, 3) * 0.5 + 0.5;
      h += (fbm(nx * 7.1 - seedOff, 8.1, nz * 7.1, 2) * 0.5 + 0.5) * 0.45;
      h += (fbm(nx * 17.0 + seedOff * 2, 1.7, nz * 17.0, 2) * 0.5 + 0.5) * 0.18;
      h = clamp(h / 1.63, 0, 1);
      const yTop = baseY + hMin + (hMax - hMin) * Math.pow(h, 1.45) + (R() - 0.5) * jitter;
      pos.push(nx * radius, yTop, nz * radius);
      col.push(cHigh.r, cHigh.g, cHigh.b);
      pos.push(nx * radius, baseY - 8, nz * radius);
      col.push(cLow.r, cLow.g, cLow.b);
    }
    for (let i = 0; i < segs; i++) {
      const a0 = i * 2, b0 = i * 2 + 1, a1 = (i + 1) * 2, b1 = (i + 1) * 2 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  const farGroup = new T.Group();
  farGroup.name = 'farScenery';
  {
    // 最远山：淡蓝灰，几乎融进雾里
    farGroup.add(new T.Mesh(
      buildRidge(120, -1.2, 8, 26, 260, 0x7c8ba6, 0xb9c6d6, 11.7, 1.4),
      new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, fog: true, depthWrite: true })
    ));
    // 中景山：略深
    farGroup.add(new T.Mesh(
      buildRidge(90, -1.0, 5, 16, 220, 0x66748e, 0x93a2b8, 3.4, 1.1),
      new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, fog: true, depthWrite: true })
    ));
    // 森林带：低矮锯齿，像远处林线
    farGroup.add(new T.Mesh(
      buildRidge(68, 0.05, 1.1, 4.4, 340, 0x47543f, 0x6a7a62, 7.1, 0.45),
      new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, fog: true, depthWrite: true })
    ));
  }
  scene.add(farGroup);

  /* ---------- 6d. 丁达尔光柱（3D 体积光锥） ---------- */
  const shaftUniforms = {
    uTime: { value: 0 },
    uStrength: { value: 0 },
    uColor: { value: new T.Color(0xffd7a8) },
  };
  const shaftGroup = new T.Group();
  shaftGroup.name = 'godShafts';
  (function buildShafts() {
    const N = 9;
    for (let i = 0; i < N; i++) {
      const H = 22;
      const rTop = 0.05 + R() * 0.05;
      const rBot = 1.0 + R() * 1.3;
      const geo = new T.CylinderGeometry(rTop, rBot, H, 12, 1, true);
      geo.translate(0, -H / 2, 0);            // 以顶端为原点，向下延伸
      const mat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: true,
        blending: T.AdditiveBlending, side: T.DoubleSide, fog: false,
        uniforms: {
          uTime: shaftUniforms.uTime,
          uStrength: shaftUniforms.uStrength,
          uColor: shaftUniforms.uColor,
          uSeed: { value: i * 1.73 },
        },
        vertexShader: `
          varying vec2 vUv; varying vec3 vW;
          void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `
          uniform float uTime, uStrength, uSeed;
          uniform vec3 uColor;
          varying vec2 vUv; varying vec3 vW;
          void main(){
            // vUv.y: 0 顶端 → 1 底端
            float lenFade = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.42, vUv.y);
            float flick = 0.72 + 0.28 * sin(uTime * 0.55 + uSeed * 5.0) * sin(uTime * 0.21 + uSeed);
            float a = lenFade * 0.16 * uStrength * flick;
            gl_FragColor = vec4(uColor, a);
          }`,
      });
      const m = new T.Mesh(geo, mat);
      m.renderOrder = 2;
      m.frustumCulled = false;
      m.userData.baseAngle = (i / N) * TAU + R() * 0.6;
      m.userData.rad = 0.9 + R() * 2.8;
      shaftGroup.add(m);
    }
  })();
  scene.add(shaftGroup);
  shaftGroup.visible = false;

  /* ---------- 6e. 光束卡片（billboard 光柱，保证可见） ---------- */
  const beamUniforms = {
    uStrength: { value: 0 },
    uColor: { value: new T.Color(0xffe0b0) },
  };
  const beamGroup = new T.Group();
  beamGroup.name = 'lightBeams';
  (function buildBeams() {
    const defs = [
      { x: -3.1, y: 7.2, w: 1.5, h: 15, a: 0.42 },
      { x: -1.7, y: 7.6, w: 1.1, h: 16, a: 0.30 },
      { x: -0.4, y: 7.0, w: 1.8, h: 17, a: 0.26 },
      { x: 1.0, y: 7.8, w: 1.2, h: 15, a: 0.34 },
      { x: 2.4, y: 7.2, w: 1.5, h: 16, a: 0.40 },
      { x: 3.6, y: 6.6, w: 1.0, h: 14, a: 0.28 },
    ];
    for (const d of defs) {
      const geo = new T.PlaneGeometry(d.w, d.h, 1, 1);
      const mat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: false,
        blending: T.AdditiveBlending, side: T.DoubleSide, fog: false,
        uniforms: {
          uStrength: beamUniforms.uStrength,
          uColor: beamUniforms.uColor,
          uA: { value: d.a },
        },
        vertexShader: `
          varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform float uStrength, uA;
          uniform vec3 uColor;
          varying vec2 vUv;
          void main(){
            // 横向：中间亮两边淡
            float ax = abs(vUv.x - 0.5) * 2.0;
            float across = pow(1.0 - ax, 2.4);
            // 纵向：上下渐隐
            float along = smoothstep(0.0, 0.30, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
            float a = across * along * uA * uStrength;
            gl_FragColor = vec4(uColor, a);
          }`,
      });
      const m = new T.Mesh(geo, mat);
      m.position.set(d.x, d.y, -1.2);
      m.renderOrder = 4;
      m.frustumCulled = false;
      m.userData.rotZ = 0.26;
      beamGroup.add(m);
    }
  })();
  scene.add(beamGroup);
  beamGroup.visible = false;    // 用户要求：去掉丁达尔光束

  // 每帧：朝向相机 + 固定倾角
  function updateBeams() {
    if (!beamGroup.visible) return;
    for (const m of beamGroup.children) {
      m.quaternion.copy(camera.quaternion);
      m.rotateZ(m.userData.rotZ);
    }
  }

  shaftGroup.visible = false;   // 改用屏幕空间光束，几何光锥停用

  // 依据太阳方向摆放光柱（从太阳斜射向岛）
  function orientShafts() {
    const dir = skyUniforms.uSunDir.value.clone().normalize();   // 指向太阳
    const down = dir.clone().multiplyScalar(-1);                 // 光行进方向
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, -1, 0), down);
    for (const m of shaftGroup.children) {
      const a = m.userData.baseAngle, r = m.userData.rad;
      m.position.set(Math.cos(a) * r, 14.0, Math.sin(a) * r);
      m.quaternion.copy(q);
    }
  }


/* ---------- 6b. 倒影组（花瓣海不反射，保留空组以兼容旧引用） ---------- */
  const mirrorGroup = new T.Group();
  mirrorGroup.visible = false;
  scene.add(mirrorGroup);

  /* ---------- 7. 花瓣之海（翻涌的浪由樱花花瓣组成） ---------- */
  // 波浪函数：GLSL 与 JS 共用同一组参数，保证视觉一致
  const SEA_WAVE_GLSL = `
    float seaWaveH(vec2 p, float t){
      float d = length(p);
      // 小岛附近压平，避免浪拍穿岛底
      float near = smoothstep(3.2, 9.0, d);
      float h = 0.0;
      h += sin(dot(p, vec2(0.850, 0.527)) * 0.2010 + t * 0.52) * 0.430;
      h += sin(dot(p, vec2(0.530,-0.848)) * 0.4030 + t * 0.82) * 0.305;
      h += sin(dot(p, vec2(-0.300, 0.954)) * 0.8180 + t * 1.22) * 0.180;
      h += sin(dot(p, vec2(0.950, 0.312)) * 1.9600 + t * 1.95) * 0.100;
      h += sin(dot(p, vec2(-0.750, 0.660)) * 3.6000 + t * 2.60) * 0.045;
      h += sin(dot(p, vec2(0.200,-0.980)) * 0.6100 + t * 1.05) * 0.110;

      // ★ 局部大涌浪：4 处随机游走的浪峰，此起彼伏，不是固定在某一点
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float ang = fi * 2.399 + t * 0.085 + fi * 0.63;
        float rad = 10.5 + fi * 8.0 + sin(t * 0.21 + fi) * 2.5;
        vec2 c = vec2(cos(ang), sin(ang)) * rad;
        float s = 0.50 + 0.50 * sin(t * 0.75 + fi * 2.1);
        float d2 = dot(p - c, p - c);
        h += exp(-d2 * 0.020) * s * 1.15;
      }

      return h * mix(0.18, 1.0, near) * mix(1.0, 0.55, smoothstep(60.0, 150.0, d));
    }`;

  const seaUniforms = {
    uTime: { value: 0 },
    uSunDir: skyUniforms.uSunDir,
    uCrest: { value: new T.Color(0xffeff6) },
    uMid: { value: new T.Color(0xeaa6c1) },
    uDeep: { value: new T.Color(0xbe5f8b) },
    uSky: { value: new T.Color(0x9dc2e4) },
    uSun: { value: new T.Color(0xfff0d8) },
    uIslandR: { value: WORLD.islandR },
    uBright: { value: 1.0 },
    uWindDir: windUniforms.uWindDir,
    uWindStr: windUniforms.uWindStr,
  };
  const waterUniforms = seaUniforms;   // 兼容旧引用（part4 更新 uTime）

  // 极坐标圆盘：径向指数分布，岛的近处密、远处疏
  function buildSeaGeometry(rMin, rMax, rings, segs) {
    const pos = [], uvs = [], idx = [];
    for (let i = 0; i <= rings; i++) {
      const f = i / rings;
      const r = rMin * Math.pow(rMax / rMin, f);   // 指数增长
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * TAU;
        pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
        uvs.push(j / segs, f);
      }
    }
    const stride = segs + 1;
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * stride + j;
        const b = a + 1;
        const c = (i + 1) * stride + j;
        const d = c + 1;
        // 绕序必须是 (a,b,c)：切向 × 径向 = 朝上，否则整片海会被背面剔除
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function buildPetalSea() {
    const geo = buildSeaGeometry(0.7, 190, 232, 144);
    const mat = new T.ShaderMaterial({
      side: T.DoubleSide,
      uniforms: {
        uTime: seaUniforms.uTime,
        uSunDir: seaUniforms.uSunDir,
        uCrest: seaUniforms.uCrest,
        uMid: seaUniforms.uMid,
        uDeep: seaUniforms.uDeep,
        uSky: seaUniforms.uSky,
        uSun: seaUniforms.uSun,
        uIslandR: seaUniforms.uIslandR,
        uBright: seaUniforms.uBright,
        uWindDir: seaUniforms.uWindDir,
        uWindStr: seaUniforms.uWindStr,
      },
      vertexShader: SEA_WAVE_GLSL + `
        uniform float uTime;
        varying vec3 vW;
        varying vec2 vP;
        varying float vH;
        void main(){
          vec3 p = position;
          vec2 pp = p.xz;
          float h = seaWaveH(pp, uTime);
          p.y += h;
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vW = wp.xyz;
          vP = pp;
          vH = h;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uTime, uIslandR, uBright, uWindStr;
        uniform vec2 uWindDir;
        uniform vec3 uCrest, uMid, uDeep, uSky, uSun, uSunDir;
        varying vec3 vW;
        varying vec2 vP;
        varying float vH;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1,0)), f.x),
                     mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y);
        }
        void main(){
          // 浪高归一化：0 谷底 / 1 峰顶
          float hh = clamp(vH * 0.34 + 0.46, 0.0, 1.0);   // 含涌浪的总振幅约 2.4

          // 三层噪声：模拟密集花瓣的堆叠颗粒感
          vec2 wDrift = uWindDir * uTime * 0.055 * uWindStr;
          float pn1 = n2(vP * 1.15 + vec2(uTime * 0.05, -uTime * 0.041) - wDrift);
          float pn2 = n2(vP * 4.2 - vec2(uTime * 0.09, uTime * 0.068) - wDrift * 1.6);
          float pn3 = n2(vP * 12.0 + vec2(uTime * 0.15, uTime * 0.112) - wDrift * 2.4);
          float pn4 = n2(vP * 34.0 - vec2(uTime * 0.22, -uTime * 0.19));
          float petals = pn1 * 0.52 + pn2 * 0.26 + pn3 * 0.14 + pn4 * 0.08;

          // 浪谷深玫红 → 浪腰粉 → 浪峰近白
          vec3 col = mix(uDeep, uMid, smoothstep(0.06, 0.60, hh));
          col = mix(col, uCrest, smoothstep(0.56, 1.0, hh) * 0.62);

          // 花瓣颗粒让颜色起伏，避免像液体
          col *= 0.88 + petals * 0.26;

          // 区域色相微差
          col = mix(col, uDeep * 1.14, smoothstep(0.50, 0.95, pn1) * 0.15);

          // 浪尖白花瓣沫
          float foam = smoothstep(0.68, 0.96, hh) * smoothstep(0.52, 0.92, petals);
          col = mix(col, vec3(1.0, 0.972, 0.982), foam * 0.55);

          // 掠射角泛起天光
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
          col = mix(col, uSky * 0.80, fres * 0.26);

          // 花瓣反光的碎亮光
          vec3 Hv = normalize(normalize(uSunDir) + V);
          float glint = pow(clamp(dot(Hv, vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 48.0);
          col += uSun * glint * (0.20 + petals * 0.40) * 0.34;

          // 岛周围堆一层厚厚的花瓣（岸线）
          float shore = 1.0 - smoothstep(uIslandR, uIslandR + 4.5, length(vP));
          col = mix(col, uCrest, shore * 0.22);

          gl_FragColor = vec4(col * uBright, 1.0);
        }`,
    });
    const m = new T.Mesh(geo, mat);
    m.position.y = WORLD.waterY;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  }
  const waterMesh = buildPetalSea();

  /* ---------- 7b. 海上漂浮的花瓣（跟着波浪起伏） ---------- */
  // 真正的樱花花瓣：圆润轮廓 + 尖端小缺口 + 杯状弧度
  function makeSeaPetalGeo() {
    const L = 0.088;      // 瓣长
    const W = 0.056;      // 半宽
    const NU = 9;         // 单侧轮廓分段
    const pos = [], nor = [], idx = [];

    // 沿瓣长 u∈[0,1] 的半宽：中段最宽、两端收拢
    const wOf = (u) => W * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.60)), 0.70) * (0.80 + 0.20 * u);
    // 杯状 + 横向内凹
    const yOf = (u, xr) => 0.024 * u * u - 0.011 * xr * xr * Math.sin(Math.PI * u);

    const outline = [];
    // 右半：从瓣根到瓣尖
    for (let i = 0; i <= NU; i++) {
      const u = (i / NU) * 0.95;
      outline.push({ x: wOf(u), u, xr: 1 });
    }
    // 尖端右角
    outline.push({ x: 0.165 * W, u: 1.0, xr: 0.30 });
    // 尖端中央的缺口（樱花标志性的小凹）
    outline.push({ x: 0, u: 0.905, xr: 0.0 });
    // 尖端左角
    outline.push({ x: -0.165 * W, u: 1.0, xr: -0.30 });
    // 左半：从瓣尖回瓣根
    for (let i = NU; i >= 0; i--) {
      const u = (i / NU) * 0.95;
      outline.push({ x: -wOf(u), u, xr: -1 });
    }

    // 扇形三角化，从瓣根出发
    pos.push(0, 0, 0); nor.push(0, 1, 0);
    for (const o of outline) {
      pos.push(o.x, yOf(o.u, o.xr), o.u * L);
      nor.push(0, 1, 0);
    }
    const n = outline.length + 1;
    for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1);

    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    sanitize(g);
    return g;
  }
  function buildSeaPetals() {
    const N = 2000;
    const geo = makeSeaPetalGeo();
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) seed[i] = R();
    geo.setAttribute('aSeed', new T.InstancedBufferAttribute(seed, 1));

    const mat = new T.ShaderMaterial({
      side: T.DoubleSide,
      uniforms: {
        uTime: seaUniforms.uTime,
        uSunDir: seaUniforms.uSunDir,
        uC1: { value: new T.Color(0xffe3ee) },
        uC2: { value: new T.Color(0xf3a9c7) },
        uSunCol: { value: new T.Color(0xfff3e2) },
        uBright: seaUniforms.uBright,
        uWindDir: seaUniforms.uWindDir,
        uWindStr: seaUniforms.uWindStr,
      },
      vertexShader: SEA_WAVE_GLSL + `
        uniform float uTime, uWindStr;
        uniform vec2 uWindDir;
        attribute float aSeed;
        varying float vSeed;
        varying vec3 vNw;
        varying vec3 vW;
        void main(){
          vSeed = aSeed;
          #ifdef USE_INSTANCING
            mat4 im = instanceMatrix;
          #else
            mat4 im = mat4(1.0);
          #endif
          vec3 p = position;
          vec4 base = im * vec4(0.0, 0.0, 0.0, 1.0);
          // 顺风漂移：让整片花瓣缓慢流动，取模后仍留在原地附近
          base.xz += uWindDir * (mod(uTime * 0.55 * uWindStr + aSeed * 40.0, 40.0) - 20.0);
          float h = seaWaveH(base.xz, uTime);
          // 缓慢的自转 + 上下微浮
          float sp = uTime * (0.25 + aSeed * 0.5) + aSeed * 6.2831;
          float cs = cos(sp), sn = sin(sp);
          p.xz = mat2(cs, -sn, sn, cs) * p.xz;
          p.y += sin(uTime * 1.7 + aSeed * 6.2831) * 0.012;
          vec4 wp = modelMatrix * im * vec4(p, 1.0);
          wp.y += h + 0.02;
          vW = wp.xyz;
          vNw = normalize(mat3(im) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uC1, uC2, uSunDir, uSunCol;
        uniform float uBright;
        varying float vSeed;
        varying vec3 vNw;
        varying vec3 vW;
        void main(){
          vec3 N = normalize(vNw);
          vec3 L = normalize(uSunDir);
          float ndl = abs(dot(N, L));
          float lit = 0.45 + ndl * 0.75;
          vec3 col = mix(uC2, uC1, vSeed);
          col *= lit;
          // 天光补一点蓝
          col += vec3(0.06, 0.09, 0.14) * (0.4 + 0.6 * N.y);
          col += uSunCol * pow(ndl, 6.0) * 0.18;
          gl_FragColor = vec4(col * uBright, 1.0);
        }`,
    });

    const inst = new T.InstancedMesh(geo, mat, N);
    inst.frustumCulled = false;
    const dummy = new T.Object3D();
    for (let i = 0; i < N; i++) {
      // 指数分布：靠岛近的地方更密
      const rr = 5.2 + Math.pow(R(), 1.35) * 38.0;
      const a = R() * TAU;
      dummy.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      dummy.rotation.set((R() - 0.5) * 1.5, R() * TAU, (R() - 0.5) * 1.5);
      const s = 1.15 + R() * 1.45;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.position.y = WORLD.waterY;
    scene.add(inst);
    return inst;
  }
  const seaPetals = buildSeaPetals();
  regInst(seaPetals, 'seaPetals');

  /* ---------- 7d. 丝带花瓣：跟随鼠标拖出飘动的花瓣带 ---------- */
  const RIBBON_MAX_R = 34;      // 落点最大半径：保证任何视角都在画面内
  const RIBBON_LIFE = 2.4;      // 轨迹存活时长
  const RIBBON_MAX_PTS = 170;

  const ribbon = (function () {
    const N = 900;
    const geo = makeSeaPetalGeo();
    const mat = new T.MeshStandardMaterial({
      color: 0xffdcea,
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.18,
      side: T.DoubleSide,
      emissive: 0xffb8d2,
      emissiveIntensity: 0.06,
    });
    const inst = new T.InstancedMesh(geo, mat, N);
    inst.instanceMatrix.setUsage(T.DynamicDrawUsage);
    inst.frustumCulled = false;
    inst.visible = false;
    scene.add(inst);

    const rnd = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) rnd[i] = R();

    return {
      inst, N, rnd,
      on: false, hover: false,
      ndc: new T.Vector2(0, 0),
      trail: [],
      smooth: { x: 0, z: 0 },
      hasSmooth: false,
      dummy: new T.Object3D(),
      ray: new T.Raycaster(),
      plane: new T.Plane(new T.Vector3(0, 1, 0), -WORLD.waterY),
      hit: new T.Vector3(),
      path: [],
    };
  })();

  // 把鼠标投影到海面；射线近乎平行海面时，沿水平方向外推，避免"看不见"
  function ribbonProject() {
    const rb = ribbon;
    rb.ray.setFromCamera(rb.ndc, camera);
    let tx, tz;
    if (rb.ray.ray.intersectPlane(rb.plane, rb.hit)) {
      tx = rb.hit.x; tz = rb.hit.z;
    } else {
      const d = rb.ray.ray.direction;
      const hl = Math.hypot(d.x, d.z) || 1;
      tx = camera.position.x + (d.x / hl) * RIBBON_MAX_R * 0.92;
      tz = camera.position.z + (d.z / hl) * RIBBON_MAX_R * 0.92;
    }
    const r = Math.hypot(tx, tz);
    if (r > RIBBON_MAX_R) { const k = RIBBON_MAX_R / r; tx *= k; tz *= k; }
    return { x: tx, z: tz };
  }

  function updateRibbon(t, dt) {
    const rb = ribbon;
    if (!rb.on) {
      if (rb.inst.visible) rb.inst.visible = false;
      rb.trail.length = 0;
      rb.hasSmooth = false;
      return;
    }

    // 光标 → 海面点，并做指数平滑（低通滤波，轨迹更顺）
    if (rb.hover) {
      const p = ribbonProject();
      if (!rb.hasSmooth) {
        rb.smooth.x = p.x; rb.smooth.z = p.z; rb.hasSmooth = true;
      } else {
        const k = Math.min(1, Math.max(0.08, dt * 16));
        rb.smooth.x += (p.x - rb.smooth.x) * k;
        rb.smooth.z += (p.z - rb.smooth.z) * k;
      }
      const last = rb.trail[rb.trail.length - 1];
      if (!last || Math.hypot(rb.smooth.x - last.x, rb.smooth.z - last.z) > 0.10) {
        rb.trail.push({ x: rb.smooth.x, z: rb.smooth.z, t: t });
      }
    }

    while (rb.trail.length && t - rb.trail[0].t > RIBBON_LIFE) rb.trail.shift();
    while (rb.trail.length > RIBBON_MAX_PTS) rb.trail.shift();

    const n = rb.trail.length;
    rb.inst.visible = n >= 3;
    if (!rb.inst.visible) return;

    // 三点滑动平均，抹掉采样折角
    const P = rb.path;
    P.length = 0;
    for (let i = 0; i < n; i++) {
      const a = rb.trail[Math.max(0, i - 1)];
      const b = rb.trail[i];
      const c2 = rb.trail[Math.min(n - 1, i + 1)];
      P.push({ x: (a.x + b.x * 2 + c2.x) * 0.25, z: (a.z + b.z * 2 + c2.z) * 0.25 });
    }

    const d = rb.dummy;
    for (let i = 0; i < rb.N; i++) {
      const u = i / (rb.N - 1);
      const fi = u * (n - 1);
      const i0 = Math.min(n - 1, Math.floor(fi));
      const i1 = Math.min(n - 1, i0 + 1);
      const fr = fi - i0;
      const A = P[i0], B = P[i1];
      const x0 = A.x + (B.x - A.x) * fr;
      const z0 = A.z + (B.z - A.z) * fr;

      let dx = B.x - A.x, dz = B.z - A.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const nx = -dz, nz = dx;

      // 丝带宽度：两头收尖，中段饱满
      const wProf = Math.sin(Math.PI * Math.pow(u, 0.80));
      const r0 = rb.rnd[i * 4], r1 = rb.rnd[i * 4 + 1], r2 = rb.rnd[i * 4 + 2];

      // 只用低频摆动，看起来像布带而不是锯齿
      const sway = Math.sin(u * 4.6 - t * 1.7) * 0.95 * wProf
                 + Math.sin(u * 9.2 + t * 2.3) * 0.22 * wProf;
      const side = (r0 - 0.5) * 2.0 * wProf * 1.05;

      const x = x0 + nx * (side + sway);
      const z = z0 + nz * (side + sway);
      const y = WORLD.waterY + seaWaveH(x, z, t) + 0.10
              + Math.sin(u * 6.2 - t * 2.1) * 0.26 * wProf + r1 * 0.16;

      d.position.set(x, y, z);
      d.rotation.set(
        (r1 - 0.5) * 1.2 + Math.sin(t * 1.5 + u * 7.0) * 0.45,
        r2 * TAU + t * (0.5 + r0 * 0.7),
        (r0 - 0.5) * 1.2 + Math.cos(t * 1.3 + u * 5.5) * 0.45
      );
      d.scale.setScalar((1.15 + r2 * 1.15) * (0.45 + wProf * 1.05));
      d.updateMatrix();
      rb.inst.setMatrixAt(i, d.matrix);
    }
    rb.inst.instanceMatrix.needsUpdate = true;
  }
  /* ---------- 7c. 浪尖飞沫：被大浪卷起来的花瓣 ---------- */
  // 与 GLSL 里 4 处涌浪中心保持一致
  const CREST_N = 4;
  function crestCenters(t) {
    const out = [];
    for (let i = 0; i < CREST_N; i++) {
      const ang = i * 2.399 + t * 0.085 + i * 0.63;
      const rad = 10.5 + i * 8.0 + Math.sin(t * 0.21 + i) * 2.5;
      const s = 0.50 + 0.50 * Math.sin(t * 0.75 + i * 2.1);
      out.push({ x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, s });
    }
    return out;
  }
  // JS 版浪高（与 GLSL 同步，用于确定飞沫起点）
  function seaWaveH(x, z, t) {
    const d = Math.hypot(x, z);
    const near = smoothstep(3.2, 9.0, d);
    let h = 0;
    h += Math.sin(x * 0.850 * 0.2010 + z * 0.527 * 0.2010 + t * 0.52) * 0.430;
    h += Math.sin(x * 0.530 * 0.4030 + z * -0.848 * 0.4030 + t * 0.82) * 0.305;
    h += Math.sin(x * -0.300 * 0.8180 + z * 0.954 * 0.8180 + t * 1.22) * 0.180;
    h += Math.sin(x * 0.950 * 1.9600 + z * 0.312 * 1.9600 + t * 1.95) * 0.100;
    h += Math.sin(x * -0.750 * 3.6000 + z * 0.660 * 3.6000 + t * 2.60) * 0.045;
    h += Math.sin(x * 0.200 * 0.6100 + z * -0.980 * 0.6100 + t * 1.05) * 0.110;
    for (let i = 0; i < CREST_N; i++) {
      const ang = i * 2.399 + t * 0.085 + i * 0.63;
      const rad = 10.5 + i * 8.0 + Math.sin(t * 0.21 + i) * 2.5;
      const cx = Math.cos(ang) * rad, cz = Math.sin(ang) * rad;
      const s = 0.50 + 0.50 * Math.sin(t * 0.75 + i * 2.1);
      const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
      h += Math.exp(-d2 * 0.020) * s * 1.15;
    }
    const far = 1 - smoothstep(60.0, 150.0, d) * 0.45;
    return h * lerp(0.18, 1.0, near) * far;
  }

  function buildSpray() {
    const N = 1900;
    const geo = makeSeaPetalGeo();
    const mat = new T.MeshStandardMaterial({
      color: 0xf5b3cc,
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.12,
      side: T.DoubleSide,
      emissive: 0xffc4da,
      emissiveIntensity: 0.03,
    });
    const inst = new T.InstancedMesh(geo, mat, N);
    inst.instanceMatrix.setUsage(T.DynamicDrawUsage);
    inst.frustumCulled = false;
    scene.add(inst);
    const data = [];
    for (let i = 0; i < N; i++) {
      data.push({ ci: 0, ox: 0, oz: 0, t: Math.random() * 3, dur: 1, vy: 0, y0: 0, sp: 0, rot: 0, rx: 0, rz: 0, sc: 1 });
    }
    return { inst, data, dummy: new T.Object3D() };
  }
  const spray = buildSpray();
  regInst(spray.inst, 'spray');

  function respawnSpray(p, tNow, crests) {
    // 选一个"够高的涌浪"作为出生点
    let ci = Math.floor(R() * CREST_N);
    for (let k = 0; k < 3; k++) {
      if (crests[ci].s > 0.35) break;
      ci = Math.floor(R() * CREST_N);
    }
    const a = R() * TAU;
    const rr = Math.sqrt(R()) * (3.4 + crests[ci].s * 5.2);
    p.ci = ci;
    p.ox = Math.cos(a) * rr;
    p.oz = Math.sin(a) * rr;
    p.t = 0;
    p.vy = 1.5 + R() * 2.4 + crests[ci].s * 1.1;
    p.dur = (p.vy * 2) / 3.6;
    p.sp = 0.35 + R() * 0.9;
    p.rot = R() * TAU;
    p.rx = (R() - 0.5) * 2.0;
    p.rz = (R() - 0.5) * 2.0;
    p.sc = 0.7 + R() * 0.9;
    p.y0 = seaWaveH(crests[ci].x + p.ox, crests[ci].z + p.oz, tNow) + WORLD.waterY + 0.10;
  }

  function updateSpray(tNow, dt) {
    if (!spray) return;
    const crests = crestCenters(tNow);
    const d = spray.dummy;
    for (let i = 0; i < spray.data.length; i++) {
      const p = spray.data[i];
      p.t += dt;
      if (p.t > p.dur || p.t < 0) respawnSpray(p, tNow, crests);
      const c = crests[p.ci];
      const tt = p.t;
      // 抛物线：先被浪抛起，再落下
      const y = p.y0 + p.vy * tt - 1.8 * tt * tt;
      // 顺风被吹偏：飞行时间越长，偏移越大
      const wPush = tt * tt * 1.35 * WIND.strength;
      const x = c.x + p.ox * (1 + tt * 0.28) + Math.sin(tt * 2.2 + p.rot) * 0.16 + WIND.vec.x * wPush;
      const z = c.z + p.oz * (1 + tt * 0.28) + Math.cos(tt * 1.8 + p.rot) * 0.16 + WIND.vec.y * wPush;
      d.position.set(x, y, z);
      d.rotation.set(p.rx + tt * p.sp * 2.4, p.rot + tt * p.sp * 1.6, p.rz + tt * p.sp * 1.9);
      // 只有浪够高时才抛起花瓣，浪弱的地方不出现 → 飞沫此起彼伏\n      d.scale.setScalar(c.s < 0.52 ? 0 : p.sc * Math.min(1, (c.s - 0.52) * 3.2));
      d.updateMatrix();
      spray.inst.setMatrixAt(i, d.matrix);
    }
    spray.inst.instanceMatrix.needsUpdate = true;
  }
