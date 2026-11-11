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
  const yieldFrame = () => document.hidden
    ? new Promise((res) => setTimeout(res, 0))
    : new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
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
  const CAM_START = new T.Vector3(2.4, 5.2, 13.8);
  const CAM_END = new T.Vector3(0.45, 2.35, 11.6);
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

  // 按窗口宽高比自动调整机位距离：兼顾巨型树冠完整轮廓与前景花海，复刻参考图构图比例
  const VIEW_TARGET = new T.Vector3(0, 4.35, 0);
  const BASE_DIST = CAM_END.distanceTo(VIEW_TARGET) * 1.62;
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

  const fill = new T.DirectionalLight(0xffe0c8, 0.92);
  fill.position.set(-4.5, 4.2, 9.5);
  scene.add(fill);

  // 树冠下方提灯暖光氛围补光：让古树干分叉、抓地盘根、木长椅与草坪笼罩在温馨的琥珀暖光中
  const underCanopyLight = new T.PointLight(0xffad58, 1.35, 9.5, 1.5);
  underCanopyLight.position.set(0.05, 2.65, 0.42);
  scene.add(underCanopyLight);

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

        // 无正弦多项式哈希 + 逐角独立 floor：防止 Windows D3D11/FXC 编译器对 dot(i+offset) 常量折叠产生 1-ULP 跨格跳变方斑
        float h21(vec2 p){
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float n2(vec2 p){
          vec2 i00 = floor(p);
          vec2 i10 = floor(p + vec2(1.0, 0.0));
          vec2 i01 = floor(p + vec2(0.0, 1.0));
          vec2 i11 = floor(p + vec2(1.0, 1.0));
          vec2 f = p - i00;
          f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
          return mix(mix(h21(i00), h21(i10), f.x),
                     mix(h21(i01), h21(i11), f.x), f.y);
        }
        float fbm2(vec2 p){
          float s = 0.0, a = 0.5;
          const mat2 m2 = mat2(0.80, -0.60, 0.60, 0.80);
          for (int i = 0; i < 5; i++) { s += n2(p) * a; p = m2 * p * 2.02 + vec2(13.7, 29.3); a *= 0.5; }
          return s;
        }

        void main(){
          vec3 dir = normalize(vWPos - cameraPosition);   // 真实视线方向，太阳不再因球心视差而偏位
          float h = clamp(dir.y, -1.0, 1.0);
          // 调整天顶与中景过渡区间：在常规视角(h≈0~0.42)下也能展现深邃暮光蓝紫到暖金霞光的层次
          vec3 col = mix(uBot, uMid, smoothstep(-0.02, 0.16, h));
          col = mix(col, uTop, smoothstep(0.13, 0.45, h));

          vec2 dh = normalize(dir.xz + vec2(1e-5));
          vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
          float toward = pow(clamp(dot(dh, sh) * 0.5 + 0.5, 0.0, 1.0), 1.8);
          float sunDot = clamp(dot(dir, normalize(uSunDir)), 0.0, 1.0);

          // ---- 夕照晚霞：收束在地平线与低空，避免把整个天顶刷成纯黄 ----
          {
            float band = smoothstep(0.28, 0.0, abs(dir.y - 0.025));
            vec3 horizonGlow = mix(uGlow, vec3(1.0, 0.42, 0.32), (1.0 - toward) * 0.45);
            col = mix(col, horizonGlow, band * (0.25 + 0.75 * toward) * uSunset * 0.76);
            // 贴近太阳方向的柔金霞光
            float nearSun = pow(sunDot, 4.5);
            col += uGlow * nearSun * uSunset * 0.48;
          }

          // ---- 双层火烧云：高层流云 + 低层积云（修正 fbm 值域 0.30~0.68 导致旧版无云的问题） ----
          if (dir.y > 0.008) {
            float hy = max(dir.y + 0.035, 0.055);
            vec2 cp = dir.xz / hy;
            vec2 windOff = vec2(uTime * 0.0065, uTime * 0.0032);
            // 域扭曲：拉出横向舒展的流云纹理
            vec2 warp = vec2(
              fbm2(cp * 0.32 + windOff * 0.6),
              fbm2(cp * 0.32 + vec2(5.2, 1.3) - windOff * 0.5)
            ) - 0.5;
            vec2 uv1 = cp * vec2(0.28, 0.46) + warp * 0.55 + windOff;
            float raw1 = fbm2(uv1) * 0.68 + fbm2(uv1 * 2.15 + 7.3) * 0.32;
            // 将 fbm 窄分布 [0.31, 0.67] 映射回 [0, 1]
            float n1 = clamp((raw1 - 0.31) / 0.35, 0.0, 1.0);

            // 沿太阳方向偏移采样，计算云朵底边与迎光金边
            float rawLit = fbm2(uv1 + sh * 0.14);
            float nLit = clamp((rawLit - 0.31) / 0.35, 0.0, 1.0);
            float rimLight = clamp((n1 - nLit) * 2.6 + 0.35, 0.0, 1.0);

            // 覆盖度控制：晴天/黄昏也能呈现层次分明的火烧云
            float cov = clamp(uCloud * 1.45 + 0.18, 0.25, 0.92);
            float cl1 = smoothstep(1.0 - cov, 1.0 - cov + 0.32, n1);
            float thick = smoothstep(1.0 - cov + 0.05, 0.95, n1);

            // 高空轻纱卷云（增加天顶细节）
            vec2 uv2 = cp * vec2(0.55, 0.85) - windOff * 0.7 + warp * 0.25;
            float n2c = clamp((fbm2(uv2 + 19.1) - 0.34) / 0.32, 0.0, 1.0);
            float cl2 = smoothstep(0.52, 0.84, n2c) * 0.42 * smoothstep(0.06, 0.28, dir.y);

            float cl = clamp(cl1 + cl2 * (1.0 - cl1 * 0.6), 0.0, 1.0);
            // 地平线淡出，避免低空硬切
            cl *= smoothstep(0.008, 0.11, dir.y);

            // 云体着色：背光面/厚云处偏暮色紫灰，底边与朝阳面染金橙绯红
            vec3 shadowCol = mix(uTop * 0.85 + vec3(0.10, 0.08, 0.14), vec3(0.44, 0.32, 0.48), uSunset * 0.75);
            vec3 litCol = mix(uCloudTint, uGlow * 1.18, uSunset * (0.55 + 0.45 * toward));
            vec3 rimCol = mix(uSunColor, vec3(1.0, 0.76, 0.45), uSunset * 0.7) * (1.15 + 0.65 * pow(sunDot, 3.0));

            vec3 cc = mix(litCol, shadowCol, smoothstep(0.15, 0.82, thick) * (0.65 - 0.30 * rimLight));
            // 云底与迎光边缘镶金边
            float edgeGlow = (1.0 - smoothstep(0.0, 0.55, thick)) * 0.65 + rimLight * 0.55;
            cc = mix(cc, rimCol, clamp(edgeGlow * (0.35 + 0.65 * (uSunset * 0.7 + pow(sunDot, 2.0) * 0.5)), 0.0, 0.88));
            // 阴雨天压成铅灰
            cc = mix(cc, vec3(0.38, 0.41, 0.47), uCloudWet * 0.72);

            col = mix(col, cc, cl * 0.88);
          }

          col *= (1.0 - uCloudWet * 0.20);                  // 阴天整体压暗（别压太死）

          // 太阳圆盘 + 柔美双层光晕
          float d = clamp(dot(dir, normalize(uSunDir)), 0.0, 1.0);
          float disk = smoothstep(uSunSize, uSunSize + 0.0008, d);
          float halo = pow(d, 180.0) * 0.55
                     + pow(d, 18.0) * 0.16;
          // 阴雨天太阳被云遮住
          float sunVis = 1.0 - uCloudWet * 0.85;
          col += uSunColor * (disk * 5.2 + halo) * sunVis;
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

  /* ---------- 6. 圆形地台（微缩公园级泥土基底 + 树根微丘 + 深度接触阴影 AO + 垂挂草唇） ---------- */
  const islandGroup = new T.Group();
  scene.add(islandGroup);

  // 全局共享地形高度函数：让树根、草簇、长椅脚、野餐垫、落花与景石 100% 严丝合缝贴合地面，杜绝悬浮
  const TREE_BASE_XZ = { x: 0.224, z: -0.627 };
  function islandHeightAt(x, z) {
    const r = Math.hypot(x, z);
    const t = clamp(r / WORLD.islandR, 0, 1.15);
    // 基础微地形起伏
    let y = 0.038 * fbm(x * 0.85, 0.4, z * 0.85, 2)
          + 0.016 * fbm(x * 2.6, 1.1, z * 2.6, 2);
    // 古树根部自然隆起的腐殖土丘（让粗壮树根从土丘中抓地而出）
    const dxT = x - TREE_BASE_XZ.x, dzT = z - TREE_BASE_XZ.z;
    const dTree = Math.hypot(dxT, dzT);
    const angT = Math.atan2(dzT, dxT);
    // 9 道与主根对齐的泥土脊线隆起
    const rootWave = 0.5 + 0.5 * Math.cos(angT * 9.0 + 0.35);
    const mound = (0.072 + 0.026 * rootWave) * Math.exp(-dTree * dTree * 1.15);
    y += mound;
    // 岛缘草皮厚唇微拱后自然下垂
    if (t > 0.90) {
      const u = clamp((t - 0.90) / 0.10, 0, 1);
      y += 0.018 * Math.sin(u * Math.PI) - 0.032 * u * u;
    }
    return y;
  }

  // 全局共享草簇团块场（返回 0=裸露柔软泥土间隙 .. 1=茂密草簇核心），供地台泥土着色与草丛成簇分布共同读取
  function islandClumpField(x, z) {
    const n1 = fbm(x * 1.95 + 7.1, 0.6, z * 1.95 - 4.3, 3);
    const n2 = fbm(x * 4.80 - 2.4, 1.8, z * 4.80 + 5.7, 2);
    const cell = 0.5 + 0.5 * Math.sin(x * 3.4 + n1 * 3.2) * Math.cos(z * 3.4 + n2 * 3.2);
    return clamp(n1 * 0.52 + n2 * 0.24 + cell * 0.36 - 0.12, 0.0, 1.0);
  }

  function buildIsland() {
    const SEG = 128, RINGS = 40;
    const positions = [], colors = [], uvs = [], indices = [];
    const cTmp = new T.Color();
    const colSoilWarm  = new T.Color(0.42, 0.31, 0.21); // 柔软温暖的裸露腐殖泥土
    const colSoilDark  = new T.Color(0.24, 0.17, 0.12); // 树根/长椅底部深邃泥土 AO
    const colMossBase  = new T.Color(0.23, 0.42, 0.15); // 温润苔绿基底
    const colGrassLush = new T.Color(0.36, 0.58, 0.20); // 鲜活春草亮部
    const colGrassDeep = new T.Color(0.16, 0.32, 0.11); // 草簇根部环境光遮蔽暗部

    // 顶面：柔软质感泥土 + 簇状草地基底 + 树根/长椅/野餐垫深度接触阴影 AO
    for (let ri = 0; ri <= RINGS; ri++) {
      const t = ri / RINGS;
      for (let si = 0; si < SEG; si++) {
        const th = (si / SEG) * TAU;
        const rr = Math.pow(t, 0.92) * WORLD.islandR;
        const edge = 1 + 0.018 * fbm(Math.cos(th) * 2.2, 0.7, Math.sin(th) * 2.2, 2)
                       + 0.038 * Math.sin(th * 7.0 + 1.3)
                       + 0.023 * Math.sin(th * 13.0 + 0.7);
        const r = rr * edge;
        const x = Math.cos(th) * r, z = Math.sin(th) * r;
        const y = islandHeightAt(x, z);
        positions.push(x, y, z);

        // 1) 饱满温润的苔绿草坪基底 + 草簇间柔和腐殖微土（保证草叶间隙浓郁饱满，绝不发灰或露白）
        const clump = islandClumpField(x, z);
        const microSoil = fbm(x * 8.5 + 3.1, 2.2, z * 8.5 - 1.7, 2);
        const soilMix = smoothstep(0.36, 0.14, clump) * (0.45 + 0.55 * microSoil);

        cTmp.copy(colMossBase).lerp(colGrassLush, smoothstep(0.22, 0.75, clump));
        // 茂密草簇核心处压入一层草根 AO，让长在上方的立体草丛更具深邃体积感
        cTmp.lerp(colGrassDeep, smoothstep(0.58, 0.92, clump) * 0.42);
        // 草簇低谷处隐约透出柔软温润的泥土质感
        cTmp.lerp(colSoilWarm, soilMix * 0.45);

        // 2) 古树主干与 9 道抓地盘根的泥土过渡 + 深度接触阴影 (Contact AO)
        const dxT = x - TREE_BASE_XZ.x, dzT = z - TREE_BASE_XZ.z;
        const dTree = Math.hypot(dxT, dzT);
        const angT = Math.atan2(dzT, dxT);
        const rootLobe = 0.5 + 0.5 * Math.cos(angT * 9.0 + 0.35);
        const rootZone = Math.exp(-Math.pow(dTree / (0.85 + 0.38 * rootLobe), 2.0));
        const rootContactAO = Math.exp(-Math.pow(dTree / (0.52 + 0.28 * rootLobe), 2.2));
        cTmp.lerp(colSoilWarm, rootZone * 0.65);
        cTmp.lerp(colSoilDark, rootContactAO * 0.78);

        // 3) 木长椅底部接触阴影与轻度踩踏露土（x ≈ -0.56, z ≈ 0.62）
        const bx = x - (-0.56), bz = z - 0.62;
        const cosB = Math.cos(-0.15), sinB = Math.sin(-0.15);
        const lbx = bx * cosB - bz * sinB;
        const lbz = bx * sinB + bz * cosB;
        const dBench = Math.hypot(Math.max(0, Math.abs(lbx) - 0.52), Math.max(0, Math.abs(lbz) - 0.22));
        const benchPath = Math.exp(-Math.pow( Math.hypot(lbx, lbz - 0.26) / 0.62, 2.0 ));
        const benchAO = Math.exp(-dBench * dBench * 18.0);
        cTmp.lerp(colSoilWarm, benchPath * 0.46);
        cTmp.lerp(colSoilDark, benchAO * 0.68);

        // 4) 野餐垫下方与四周柔和接触暗晕（x ≈ 1.25, z ≈ 1.75）
        const px = x - 1.25, pz = z - 1.75;
        const cosP = Math.cos(-0.32), sinP = Math.sin(-0.32);
        const lpx = px * cosP - pz * sinP;
        const lpz = px * sinP + pz * cosP;
        const dPicnic = Math.hypot(Math.max(0, Math.abs(lpx) - 0.42), Math.max(0, Math.abs(lpz) - 0.30));
        const picnicAO = Math.exp(-dPicnic * dPicnic * 22.0);
        cTmp.lerp(colSoilDark, picnicAO * 0.56);

        // 5) 岛缘厚草唇与苔土自然过渡
        cTmp.multiplyScalar(lerp(1.0, 0.84, smoothstep(0.82, 1.0, t)));
        cTmp.lerp(colSoilWarm, smoothstep(0.88, 1.0, t) * 0.52);
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

    // 侧面土层：圆润微缩景观地台底座（与顶面草唇严丝合缝衔接，水下自然内收，杜绝两侧突角外翻）
    const sidePos = [], sideCol = [], sideUv = [], sideIdx = [];
    const SR = 14;
    const segs = 128;
    for (let ri = 0; ri <= SR; ri++) {
      const t = ri / SR;
      for (let si = 0; si < segs; si++) {
        const th = (si / segs) * TAU;
        // 与 topGeo 完全一致的岛缘轮廓，保证 ri=0 处 0 缝隙闭合
        const edge = 1 + 0.018 * fbm(Math.cos(th) * 2.2, 0.7, Math.sin(th) * 2.2, 2)
                       + 0.038 * Math.sin(th * 7.0 + 1.3)
                       + 0.023 * Math.sin(th * 13.0 + 0.7);
        const rEdge = WORLD.islandR * edge;
        const x0 = Math.cos(th) * rEdge, z0 = Math.sin(th) * rEdge;
        const yTop = islandHeightAt(x0, z0);

        // 上沿圆润饱满微鼓，向下平滑收拢成敦实的微缩公园底座
        const lipBulge = 1.0 + 0.022 * Math.sin(Math.min(1.0, t * 1.8) * Math.PI);
        const shrink = (1.0 - 0.34 * Math.pow(t, 1.35)) * lipBulge;
        const r = rEdge * shrink;
        const x = Math.cos(th) * r, z = Math.sin(th) * r;
        let y = lerp(yTop, WORLD.seatY - 0.56, Math.pow(t, 0.92));
        // 细腻泥土石阶风化肌理
        y -= 0.016 * Math.abs(Math.sin(th * 11.0 + 0.4)) * Math.pow(t, 0.75);
        sidePos.push(x, y, z);

        const n = fbm(x * 1.8 + 10, y * 3.0, z * 1.8, 3);
        if (t < 0.20) {
          // 顶部垂挂草皮苔藓厚唇过渡带
          cTmp.setRGB(0.24, 0.42, 0.16).lerp(new T.Color(0.38, 0.29, 0.19), smoothstep(0.0, 0.20, t));
        } else if (t < 0.62) {
          const u = (t - 0.20) / 0.42;
          cTmp.setRGB(0.38, 0.29, 0.19).lerp(new T.Color(0.43, 0.32, 0.22), Math.sin(u * Math.PI));
          cTmp.lerp(new T.Color(0.26, 0.19, 0.14), smoothstep(0.42, 1.0, u));
        } else {
          const u = (t - 0.62) / 0.38;
          cTmp.setRGB(0.26, 0.19, 0.14).lerp(new T.Color(0.18, 0.14, 0.11), u);
        }
        // 横向腐殖土层纹 + 纵向微雕AO，呈现细腻手工微缩模型质感
        const strata = 0.5 + 0.5 * Math.sin(y * 26.0 + fbm(x * 2.4, y * 2.0, z * 2.4, 2) * 3.2);
        const gully = 0.5 + 0.5 * Math.sin(th * 22.0 + n * 4.2);
        cTmp.multiplyScalar(0.80 + strata * 0.18 + gully * 0.14);
        cTmp.offsetHSL(0, 0, n * 0.04);
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

  /* ---------- 6b. 波浪函数与海面共享 Uniform（供岸边落花与花瓣海共用） ---------- */
  const SEA_WAVE_GLSL = `
    float seaWaveH(vec2 p, float t){
      float d = length(p);
      // 小岛周围岸线平缓过渡，让圆形微缩地台底座完整、均匀地托浮在花海之上，避免单侧浪峰漫过前缘造成两侧残缺感
      float near = smoothstep(4.3, 9.6, d);
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

      float moat = -0.075 * (1.0 - smoothstep(3.4, 5.2, d));
      return h * mix(0.05, 1.0, near) * mix(1.0, 0.55, smoothstep(60.0, 150.0, d)) + moat;
    }`;

  const seaUniforms = {
    uTime: { value: 0 },
    uSunDir: skyUniforms.uSunDir,
    uCrest: { value: new T.Color(0xffeff6) },
    uMid: { value: new T.Color(0xeaa6c1) },
    uDeep: { value: new T.Color(0xbe5f8b) },
    uSky: { value: new T.Color(0x9dc2e4) },
    uSun: { value: new T.Color(0xfff0d8) },
    uFogColor: { value: scene.fog.color },
    uGlow: skyUniforms.uGlow,
    uSunset: skyUniforms.uSunset,
    uIslandR: { value: WORLD.islandR },
    uBright: { value: 1.0 },
    uWindDir: windUniforms.uWindDir,
    uWindStr: windUniforms.uWindStr,
  };
  const waterUniforms = seaUniforms;   // 兼容旧引用（part4 更新 uTime）

  /* ---------- 6b-2. 岸边落花带：随波浪起伏、贴合岛缘轮廓 ---------- */
  const shorePetals = (function buildShorePetals() {
    const N = 1200;
    const geo = makeSeaPetalGeo();
    const sr = rng(77123);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) seed[i] = sr();
    geo.setAttribute('aSeed', new T.InstancedBufferAttribute(seed, 1));

    const mat = new T.ShaderMaterial({
      side: T.DoubleSide,
      uniforms: {
        uTime: seaUniforms.uTime,
        uSunDir: seaUniforms.uSunDir,
        uCrest: seaUniforms.uCrest,
        uMid: seaUniforms.uMid,
        uSun: seaUniforms.uSun,
        uBright: seaUniforms.uBright,
      },
      vertexShader: SEA_WAVE_GLSL + `
        uniform float uTime;
        attribute float aSeed;
        varying float vSeed;
        varying vec3 vNw;
        void main(){
          vSeed = aSeed;
          #ifdef USE_INSTANCING
            mat4 im = instanceMatrix;
          #else
            mat4 im = mat4(1.0);
          #endif
          vec3 p = position;
          vec4 base = im * vec4(0.0, 0.0, 0.0, 1.0);
          float h = seaWaveH(base.xz, uTime);
          p.y += sin(uTime * 1.6 + aSeed * 6.2831) * 0.008;
          vec4 wp = modelMatrix * im * vec4(p, 1.0);
          wp.y += h + 0.025;
          vNw = normalize(mat3(im) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uCrest, uMid, uSunDir, uSun;
        uniform float uBright;
        varying float vSeed;
        varying vec3 vNw;
        void main(){
          vec3 N = normalize(vNw);
          vec3 L = normalize(uSunDir);
          float ndl = abs(dot(N, L));
          vec3 col = mix(uMid, uCrest, 0.45 + 0.55 * vSeed);
          col *= (0.80 + ndl * 0.32);
          col += uSun * pow(ndl, 5.0) * 0.14;
          gl_FragColor = vec4(col * uBright, 1.0);
        }`,
    });

    const inst = new T.InstancedMesh(geo, mat, N);
    inst.frustumCulled = false;
    const dummy = new T.Object3D();
    for (let i = 0; i < N; i++) {
      // 保持与原版完全一致的 6 次 R() 调用，同时贴合小岛 7/13 瓣边缘轮廓
      const rRand = Math.pow(R(), 1.85);
      const a = R() * TAU;
      const edge = 1 + 0.038 * Math.sin(a * 7.0 + 1.3) + 0.023 * Math.sin(a * 13.0 + 0.7);
      const rr = WORLD.islandR * edge * 0.98 + rRand * 1.15;
      dummy.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      dummy.rotation.set((R() - 0.5) * 0.35, R() * TAU, (R() - 0.5) * 0.35);
      const s = 0.75 + R() * 0.95;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.position.y = WORLD.waterY;
    scene.add(inst);
    return inst;
  })();

  PROG(22, '堆起小岛');
  await yieldFrame();

  /* ---------- 6c. 远景山峦与森林剪影（分形山脊 + 高度雾与空气透视） ---------- */
  function buildRidge(radius, baseY, hMin, hMax, segs, seedOff, sharpness) {
    const pos = [], uvs = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * TAU;
      const nx = Math.cos(a), nz = Math.sin(a);
      // 分形山脊噪声（Ridged Multifractal）：山峰棱线自然挺拔、山谷平缓，去除原本锯齿状顶点随机抖动
      const r1 = 1.0 - Math.abs(noise3(nx * 1.7 + seedOff, 2.3, nz * 1.7 - seedOff));
      const r2 = 1.0 - Math.abs(noise3(nx * 3.9 - seedOff * 1.3, 5.1, nz * 3.9 + seedOff));
      const r3 = 1.0 - Math.abs(noise3(nx * 8.5 + seedOff * 2.1, 8.7, nz * 8.5 - seedOff * 0.7));
      const r4 = fbm(nx * 16.0 + seedOff, 1.9, nz * 16.0, 2) * 0.5 + 0.5;
      const ridge = r1 * r1 * 0.54 + r2 * r2 * 0.28 + r3 * 0.12 + r4 * 0.06;
      // 大尺度起伏包络：让远山有主峰也有低矮山口，不再是一圈等高围墙
      const env = smoothstep(0.16, 0.86, fbm(nx * 1.05 + seedOff * 0.5, 1.4, nz * 1.05 - seedOff * 0.4, 2) * 0.5 + 0.5);
      const h = Math.pow(clamp(ridge * (0.32 + 0.72 * env), 0, 1), sharpness || 1.35);
      const yTop = baseY + hMin + (hMax - hMin) * h;
      pos.push(nx * radius, yTop, nz * radius);
      uvs.push(h, 1.0);
      pos.push(nx * radius, baseY - 6.0, nz * radius);
      uvs.push(h, 0.0);
    }
    for (let i = 0; i < segs; i++) {
      const a0 = i * 2, b0 = i * 2 + 1, a1 = (i + 1) * 2, b1 = (i + 1) * 2 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function makeRidgeMat(layerDepth, baseHex, crestHex) {
    return new T.ShaderMaterial({
      side: T.DoubleSide,
      transparent: true,
      depthWrite: true,
      uniforms: {
        uLayer: { value: layerDepth },
        uBaseCol: { value: new T.Color(baseHex) },
        uCrestCol: { value: new T.Color(crestHex) },
        uFogColor: { value: scene.fog.color },
        uSkyTop: skyUniforms.uTop,
        uSkyMid: skyUniforms.uMid,
        uSkyBot: skyUniforms.uBot,
        uGlow: skyUniforms.uGlow,
        uSunDir: skyUniforms.uSunDir,
        uSunset: skyUniforms.uSunset,
        uCloudWet: skyUniforms.uCloudWet,
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vW;
        void main(){
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uLayer, uSunset, uCloudWet;
        uniform vec3 uBaseCol, uCrestCol, uFogColor, uSkyTop, uSkyMid, uSkyBot, uGlow, uSunDir;
        varying vec2 vUv;
        varying vec3 vW;
        void main(){
          vec2 dh = normalize(vW.xz + vec2(1e-5));
          vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
          float toward = pow(clamp(dot(dh, sh) * 0.5 + 0.5, 0.0, 1.0), 1.8);

          // 山体本色：随日照/暮色自适应（黄昏偏暮紫黛蓝，白天偏青黛，夜晚偏深靛）
          vec3 body = mix(uBaseCol, uCrestCol, smoothstep(0.15, 0.92, vUv.y));
          vec3 duskTint = mix(vec3(0.26, 0.21, 0.34), vec3(0.48, 0.33, 0.44), toward);
          body = mix(body, duskTint, uSunset * 0.68);
          float skyLum = dot(uSkyMid, vec3(0.299, 0.587, 0.114));
          body *= clamp(skyLum * 1.35 + 0.12, 0.14, 1.15);

          // 远山空气透视：越远的山层越融进地平线霞雾，同时保留清晰的远近剪影层次
          vec3 hazeCol = mix(uFogColor, uSkyBot, 0.42);
          hazeCol = mix(hazeCol, uGlow * 0.92 + vec3(0.08, 0.04, 0.06), toward * uSunset * 0.40);
          hazeCol *= (1.0 - uCloudWet * 0.22);

          float aerial = mix(0.12, 0.64, uLayer);
          vec3 col = mix(body, hazeCol, aerial);

          // 山脚高度雾：仅在山脚低处弥漫薄霭，消除海山硬切线又不遮没山体轮廓
          float mistH = mix(0.85, 2.60, uLayer);
          float footMist = 1.0 - smoothstep(-0.35, mistH, vW.y);
          col = mix(col, hazeCol, footMist * (0.62 + 0.28 * uLayer));

          // 脊线天光镶边：拉开前后山峦交叠处的层次
          float ridgeRim = smoothstep(0.78, 1.0, vUv.y);
          col += hazeCol * ridgeRim * (0.07 + 0.15 * toward) * (1.0 - uLayer * 0.45);

          float alpha = smoothstep(-1.1, -0.05, vW.y);
          gl_FragColor = vec4(col, alpha);
        }`,
    });
  }

  const farGroup = new T.Group();
  farGroup.name = 'farScenery';
  {
    // 4 层远近交错群山：最远淡紫峰峦 → 中远山 → 中近山 → 近处林线丘陵
    farGroup.add(new T.Mesh(
      buildRidge(126, -1.0, 5.2, 18.5, 260, 11.7, 1.48),
      makeRidgeMat(0.86, 0x62708e, 0x92a2bc)
    ));
    farGroup.add(new T.Mesh(
      buildRidge(102, -0.9, 3.8, 13.6, 240, 23.1, 1.40),
      makeRidgeMat(0.60, 0x4e5c78, 0x7888a4)
    ));
    farGroup.add(new T.Mesh(
      buildRidge(84, -0.8, 2.4, 9.2, 220, 3.4, 1.32),
      makeRidgeMat(0.36, 0x3e4b64, 0x61708a)
    ));
    farGroup.add(new T.Mesh(
      buildRidge(68, -0.4, 0.8, 4.2, 320, 7.1, 1.22),
      makeRidgeMat(0.14, 0x35403a, 0x505e52)
    ));
    // 保持全局随机数序列 R() 与旧版完全一致（旧版三层山共调用 261+221+341 = 823 次 R()）
    for (let _k = 0; _k < 823; _k++) R();
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

  /* ---------- 7. 花瓣之海（翻涌的浪由樱花花瓣组成，SEA_WAVE_GLSL 与 seaUniforms 已在前置定义） ---------- */
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
        uFogColor: seaUniforms.uFogColor,
        uGlow: seaUniforms.uGlow,
        uSunset: seaUniforms.uSunset,
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
        uniform float uTime, uIslandR, uBright, uWindStr, uSunset;
        uniform vec2 uWindDir;
        uniform vec3 uCrest, uMid, uDeep, uSky, uSun, uSunDir, uFogColor, uGlow;
        varying vec3 vW;
        varying vec2 vP;
        varying float vH;
        float h21(vec2 p){
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float n2(vec2 p){
          vec2 i00 = floor(p);
          vec2 i10 = floor(p + vec2(1.0, 0.0));
          vec2 i01 = floor(p + vec2(0.0, 1.0));
          vec2 i11 = floor(p + vec2(1.0, 1.0));
          vec2 f = fract(p);
          f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
          return mix(mix(h21(i00), h21(i10), f.x),
                     mix(h21(i01), h21(i11), f.x), f.y);
        }
        void main(){
          // 浪高归一化：0 谷底 / 1 峰顶
          float hh = clamp(vH * 0.34 + 0.46, 0.0, 1.0);   // 含涌浪的总振幅约 2.4

          // 三层噪声 + 顺风流纹：模拟密集花瓣聚集成带的丝绒纹理
          vec2 wDrift = uWindDir * uTime * 0.055 * uWindStr;
          float pn1 = n2(vP * 1.15 + vec2(uTime * 0.05, -uTime * 0.041) - wDrift);
          float pn2 = n2(vP * 4.2 - vec2(uTime * 0.09, uTime * 0.068) - wDrift * 1.6);
          float pn3 = n2(vP * 12.0 + vec2(uTime * 0.15, uTime * 0.112) - wDrift * 2.4);
          float pn4 = n2(vP * 34.0 - vec2(uTime * 0.22, -uTime * 0.19));
          float petals = pn1 * 0.52 + pn2 * 0.26 + pn3 * 0.14 + pn4 * 0.08;

          // 花瓣流带（沿着波峰与风向汇聚的浅粉花瓣纹）
          vec2 flowUv = vP * vec2(0.38, 0.62) - wDrift * 0.8 + vec2(pn1 * 0.65, pn2 * 0.45);
          float ribbonBand = smoothstep(0.54, 0.82, n2(flowUv * 1.8));

          // 浪谷深玫红 → 浪腰樱粉 → 浪峰暖粉白
          vec3 col = mix(uDeep, uMid, smoothstep(0.06, 0.58, hh));
          col = mix(col, uCrest, smoothstep(0.52, 0.98, hh) * 0.68);
          col = mix(col, uCrest, ribbonBand * smoothstep(0.28, 0.85, hh) * 0.28);

          // 花瓣颗粒让颜色起伏，避免像液体
          col *= 0.89 + petals * 0.25;

          // 区域色相微差
          col = mix(col, uDeep * 1.14, smoothstep(0.50, 0.95, pn1) * 0.14);

          // 浪尖白花瓣沫
          float foam = smoothstep(0.66, 0.95, hh) * smoothstep(0.48, 0.90, petals);
          col = mix(col, vec3(1.0, 0.972, 0.985), foam * 0.58);

          // 掠射角泛起天光
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.2);
          col = mix(col, uSky * 0.82, fres * 0.22);

          // 花瓣反光的碎亮光
          vec3 Hv = normalize(normalize(uSunDir) + V);
          float glint = pow(clamp(dot(Hv, vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 42.0);
          col += uSun * glint * (0.22 + petals * 0.42) * 0.36;

          // 岛周围堆一层厚厚的花瓣（柔化岸线过渡）
          float rDist = length(vP);
          float shore = 1.0 - smoothstep(uIslandR * 0.96, uIslandR + 4.2, rDist);
          col = mix(col, uCrest, shore * 0.28);

          vec3 finalCol = col * uBright;

          // 远景地平线暮霭融合：仅在远海(r=46~68，衔接远山山脚)渐入霞雾，既不冲淡中近景花海，又彻底消除海山硬切线
          float horizonFade = smoothstep(45.0, 68.5, rDist);
          if (horizonFade > 0.0) {
            vec2 dh = normalize(vP + vec2(1e-5));
            vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
            float toward = pow(clamp(dot(dh, sh) * 0.5 + 0.5, 0.0, 1.0), 1.8);
            vec3 mistCol = mix(uFogColor, uMid * uBright * 0.95 + uSky * 0.18, 0.32);
            mistCol = mix(mistCol, uGlow * 0.90 + vec3(0.08, 0.04, 0.06), toward * uSunset * 0.38);
            finalCol = mix(finalCol, mistCol, horizonFade * 0.92);
          }

          gl_FragColor = vec4(finalCol, 1.0);
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
        uCrest: seaUniforms.uCrest,
        uMid: seaUniforms.uMid,
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
          // 缓慢柔和的原地旋转（不再用 uTime * uWindStr 取模跳变，彻底解决花瓣乱跳与瞬移）
          float sp = uTime * (0.14 + aSeed * 0.22) + aSeed * 6.2831;
          float cs = cos(sp), sn = sin(sp);
          p.xz = mat2(cs, -sn, sn, cs) * p.xz;

          // 先求实例在世界海面上的真实水平坐标，再加连续平滑的随波微摆
          vec4 baseW = modelMatrix * im * vec4(0.0, 0.0, 0.0, 1.0);
          vec2 waveSway = vec2(
            sin(uTime * 0.45 + aSeed * 6.2831 + baseW.x * 0.25),
            cos(uTime * 0.40 + aSeed * 5.1732 + baseW.z * 0.25)
          ) * 0.28;
          vec2 centerXZ = baseW.xz + waveSway;

          // ★ 关键修复：直接在花瓣真实所在的位置采样浪高与波面法线斜率，保证花瓣 100% 贴合海面波浪起伏
          float h = seaWaveH(centerXZ, uTime);
          float hx = (seaWaveH(centerXZ + vec2(0.35, 0.0), uTime) - h) / 0.35;
          float hz = (seaWaveH(centerXZ + vec2(0.0, 0.35), uTime) - h) / 0.35;
          vec3 waveN = normalize(vec3(-hx, 1.0, -hz));

          vec4 wp = modelMatrix * im * vec4(p, 1.0);
          wp.xz += waveSway;
          // 让花瓣顺着波面倾角自然倾斜贴附在浪面上
          vec2 relXZ = wp.xz - centerXZ;
          wp.y += h + 0.022 - dot(relXZ, vec2(hx, hz)) * 0.85;
          vW = wp.xyz;
          vNw = normalize(mix(waveN, normalize(mat3(im) * normal), 0.28));
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uCrest, uMid, uSunDir, uSunCol;
        uniform float uBright;
        varying float vSeed;
        varying vec3 vNw;
        varying vec3 vW;
        void main(){
          vec3 N = normalize(vNw);
          vec3 L = normalize(uSunDir);
          float ndl = abs(dot(N, L));
          // 与海面同色系但略亮，表现漂浮在浪面的透光樱花瓣，彻底消除深紫黑碎斑感
          vec3 col = mix(uMid, uCrest, 0.38 + 0.62 * vSeed);
          float lit = 0.80 + ndl * 0.34;
          col *= lit;
          col += uSunCol * pow(ndl, 4.0) * 0.16;
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
      // 平铺贴浪面微倾，不再竖立产生暗黑背光面（保持 6 次 R() 调用）
      dummy.rotation.set((R() - 0.5) * 0.48, R() * TAU, (R() - 0.5) * 0.48);
      const s = 1.05 + R() * 1.25;
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

  /* ---------- 7d. 3D 丝带花瓣：三维空间流光丝绸带 + 双螺旋花瓣星流 ---------- */
  const RIBBON_MAX_R = 28;      // 3D 空间轨迹最大半径
  const RIBBON_LIFE = 2.8;      // 轨迹存活时长
  const RIBBON_MAX_PTS = 160;
  const RIBBON_SEG = 96;        // 3D 丝绸网格纵向分段数

  const ribbon = (function () {
    const N = 900;
    const geo = makeSeaPetalGeo();
    const mat = new T.MeshStandardMaterial({
      color: 0xffe4f0,
      roughness: 0.78,
      metalness: 0.0,
      envMapIntensity: 0.22,
      side: T.DoubleSide,
      emissive: 0xff9ec4,
      emissiveIntensity: 0.38,
    });
    const inst = new T.InstancedMesh(geo, mat, N);
    inst.instanceMatrix.setUsage(T.DynamicDrawUsage);
    inst.frustumCulled = false;
    inst.visible = false;
    scene.add(inst);

    // ★ 新增：真正的 3D 立体扭转流光丝绸网格（主丝带 + 副丝带双层交织）
    function makeSilkRibbonMesh(widthScale, opacityScale) {
      const vCnt = (RIBBON_SEG + 1) * 2;
      const rPos = new Float32Array(vCnt * 3);
      const rUv = new Float32Array(vCnt * 2);
      const rIdx = [];
      for (let i = 0; i <= RIBBON_SEG; i++) {
        const u = i / RIBBON_SEG;
        rUv[i * 4]     = u; rUv[i * 4 + 1] = 0;
        rUv[i * 4 + 2] = u; rUv[i * 4 + 3] = 1;
        if (i < RIBBON_SEG) {
          const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
          rIdx.push(a, b, c, b, d, c);
        }
      }
      const rGeo = new T.BufferGeometry();
      const posAttr = new T.BufferAttribute(rPos, 3);
      posAttr.setUsage(T.DynamicDrawUsage);
      rGeo.setAttribute('position', posAttr);
      rGeo.setAttribute('uv', new T.BufferAttribute(rUv, 2));
      rGeo.setIndex(rIdx);

      const rMat = new T.ShaderMaterial({
        side: T.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: opacityScale },
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vWPos;
          void main(){
            vUv = uv;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWPos = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform float uTime, uOpacity;
          varying vec2 vUv;
          varying vec3 vWPos;
          void main(){
            float u = vUv.x;
            float v = vUv.y;
            // 首尾渐隐包络
            float endFade = smoothstep(0.0, 0.14, u) * smoothstep(1.0, 0.82, u);
            // 丝绸横截面高光：双侧金粉亮边 + 中心柔光丝纹
            float centerDist = abs(v * 2.0 - 1.0);
            float edgeRim = smoothstep(0.52, 0.92, centerDist) * smoothstep(1.0, 0.88, centerDist);
            float silkWave = 0.5 + 0.5 * sin(u * 28.0 - uTime * 5.2 + v * 6.0);
            float coreBody = (1.0 - centerDist * centerDist * 0.65) * (0.72 + 0.28 * silkWave);

            vec3 colPink = vec3(1.0, 0.56, 0.76);
            vec3 colGold = vec3(1.0, 0.86, 0.62);
            vec3 colWhite = vec3(1.0, 0.96, 0.98);
            vec3 col = mix(colPink, colGold, 0.5 + 0.5 * sin(u * 6.28 - uTime * 1.8));
            col = mix(col, colWhite, edgeRim * 0.75 + pow(silkWave, 3.0) * 0.28);

            float alpha = (coreBody * 0.46 + edgeRim * 0.62) * endFade * uOpacity;
            gl_FragColor = vec4(col, alpha);
          }`,
      });
      const mesh = new T.Mesh(rGeo, rMat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, geo: rGeo, mat: rMat, widthScale };
    }

    const silkMain = makeSilkRibbonMesh(1.0, 0.88);
    const silkSub  = makeSilkRibbonMesh(0.52, 0.62);

    const rnd = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) rnd[i] = R();

    return {
      inst, silkMain, silkSub, N, rnd,
      on: false, hover: false,
      lastMoveT: -10,
      ndc: new T.Vector2(0, 0),
      prevNdc: new T.Vector2(99, 99),
      trail: [],
      smooth: { x: 0, y: 2.5, z: 0 },
      hasSmooth: false,
      dummy: new T.Object3D(),
      ray: new T.Raycaster(),
      viewPlane: new T.Plane(),
      hit: new T.Vector3(),
      path: [],
      curvePts: [],
    };
  })();

  // ★ 3D 空间光标投影：不再锁死在 2D 海平面，而是在相机前方的 3D 景深曲面内自由升降穿梭
  function ribbonProject3D(t) {
    const rb = ribbon;
    if (rb.hover && rb.ndc.distanceToSquared(rb.prevNdc) > 1e-6) {
      rb.prevNdc.copy(rb.ndc);
      rb.lastMoveT = t;
    }
    const isMoving = rb.hover && (t - rb.lastMoveT < 1.8);

    if (isMoving) {
      rb.ray.setFromCamera(rb.ndc, camera);
      // 构造穿过小岛与树冠中心、面向相机的 3D 交互平面，并叠加随角度呼吸的 Z 景深弧度
      const camDir = new T.Vector3();
      camera.getWorldDirection(camDir);
      const focusDist = clamp(camera.position.distanceTo(controls.target) * 0.86, 6.5, 22.0);
      const depthWave = Math.sin(t * 1.4 + rb.ndc.x * 2.2) * 1.65 - Math.abs(rb.ndc.x) * 1.8;
      const planeCenter = camera.position.clone().addScaledVector(camDir, focusDist + depthWave);
      rb.viewPlane.setFromNormalAndCoplanarPoint(camDir, planeCenter);

      let tx = 0, ty = 2.8, tz = 0;
      if (rb.ray.ray.intersectPlane(rb.viewPlane, rb.hit)) {
        tx = rb.hit.x;
        ty = rb.hit.y;
        tz = rb.hit.z;
      } else {
        const d = rb.ray.ray.direction;
        tx = camera.position.x + d.x * focusDist;
        ty = camera.position.y + d.y * focusDist;
        tz = camera.position.z + d.z * focusDist;
      }
      const r = Math.hypot(tx, tz);
      if (r > RIBBON_MAX_R) { const k = RIBBON_MAX_R / r; tx *= k; tz *= k; }
      const minFloor = WORLD.waterY + seaWaveH(tx, tz, t) + 0.35;
      ty = clamp(ty, minFloor, 12.5);
      return { x: tx, y: ty, z: tz };
    } else {
      // 鼠标静止或未悬停时：自动环绕巨型樱花树与小岛做 3D 螺旋八字漫游展示
      const ang = t * 1.05;
      const rad = 4.2 + Math.sin(t * 0.52) * 1.85;
      const tx = Math.cos(ang) * rad;
      const tz = Math.sin(ang) * rad + Math.sin(ang * 2.0) * 1.2;
      const ty = 2.6 + Math.sin(t * 0.78) * 1.75 + Math.cos(ang * 2.0) * 0.55;
      return { x: tx, y: ty, z: tz };
    }
  }

  function updateRibbon(t, dt) {
    const rb = ribbon;
    if (!rb.on) {
      if (rb.inst.visible) rb.inst.visible = false;
      if (rb.silkMain.mesh.visible) rb.silkMain.mesh.visible = false;
      if (rb.silkSub.mesh.visible) rb.silkSub.mesh.visible = false;
      rb.trail.length = 0;
      rb.hasSmooth = false;
      return;
    }

    // 采集 3D 目标点并做三维指数平滑滤波
    const p = ribbonProject3D(t);
    if (!rb.hasSmooth) {
      rb.smooth.x = p.x; rb.smooth.y = p.y; rb.smooth.z = p.z;
      rb.hasSmooth = true;
    } else {
      const k = Math.min(1, Math.max(0.08, dt * 14));
      rb.smooth.x += (p.x - rb.smooth.x) * k;
      rb.smooth.y += (p.y - rb.smooth.y) * k;
      rb.smooth.z += (p.z - rb.smooth.z) * k;
    }

    // 让既有轨迹点在 3D 空间中也随微风与升力轻柔浮动，形成真实飘带感
    for (let i = 0; i < rb.trail.length; i++) {
      const tp = rb.trail[i];
      tp.x += WIND.vec.x * dt * 0.22;
      tp.z += WIND.vec.y * dt * 0.22;
      tp.y += Math.sin(t * 2.0 + i * 0.25) * dt * 0.12;
    }

    const last = rb.trail[rb.trail.length - 1];
    if (!last || Math.hypot(rb.smooth.x - last.x, rb.smooth.y - last.y, rb.smooth.z - last.z) > 0.06) {
      rb.trail.push({ x: rb.smooth.x, y: rb.smooth.y, z: rb.smooth.z, t: t });
    }

    while (rb.trail.length && t - rb.trail[0].t > RIBBON_LIFE) rb.trail.shift();
    while (rb.trail.length > RIBBON_MAX_PTS) rb.trail.shift();

    const n = rb.trail.length;
    const vis = n >= 4;
    rb.inst.visible = vis;
    rb.silkMain.mesh.visible = vis;
    rb.silkSub.mesh.visible = vis;
    if (!vis) return;

    rb.silkMain.mat.uniforms.uTime.value = t;
    rb.silkSub.mat.uniforms.uTime.value = t;

    // 三点两次滑动平均，获得柔顺的 3D 空间曲线控制点
    const P = rb.path;
    P.length = 0;
    for (let i = 0; i < n; i++) {
      const a = rb.trail[Math.max(0, i - 1)];
      const b = rb.trail[i];
      const c2 = rb.trail[Math.min(n - 1, i + 1)];
      P.push({
        x: (a.x + b.x * 2 + c2.x) * 0.25,
        y: (a.y + b.y * 2 + c2.y) * 0.25,
        z: (a.z + b.z * 2 + c2.z) * 0.25,
      });
    }

    // 采样 3D 丝带中心线与局部三维正交标架 (T, N, B)
    function sampleRibbonFrame(u) {
      const fi = u * (n - 1);
      const i0 = Math.min(n - 1, Math.floor(fi));
      const i1 = Math.min(n - 1, i0 + 1);
      const fr = fi - i0;
      const A = P[i0], B = P[i1];
      const cx = A.x + (B.x - A.x) * fr;
      const cy = A.y + (B.y - A.y) * fr;
      const cz = A.z + (B.z - A.z) * fr;

      const iPrev = Math.max(0, i0 - 1);
      const iNext = Math.min(n - 1, i1 + 1);
      let tx = P[iNext].x - P[iPrev].x;
      let ty = P[iNext].y - P[iPrev].y;
      let tz = P[iNext].z - P[iPrev].z;
      const tLen = Math.hypot(tx, ty, tz) || 1;
      tx /= tLen; ty /= tLen; tz /= tLen;

      // 构造与切线正交的副法线 B = T × Up
      let bx = -tz, by = 0, bz = tx;
      let bLen = Math.hypot(bx, by, bz);
      if (bLen < 1e-4) { bx = 1; by = 0; bz = 0; bLen = 1; }
      bx /= bLen; bz /= bLen;

      // 主法线 N = B × T
      const nx = by * tz - bz * ty;
      const ny = bz * tx - bx * tz;
      const nz = bx * ty - by * tx;
      return { cx, cy, cz, tx, ty, tz, nx, ny, nz, bx, by, bz };
    }

    // 更新两条 3D 扭转丝绸网格顶点
    function updateSilkGeo(silk, phaseOffset, helixRadius) {
      const arr = silk.geo.attributes.position.array;
      for (let i = 0; i <= RIBBON_SEG; i++) {
        const u = i / RIBBON_SEG;
        const F = sampleRibbonFrame(u);
        const wProf = Math.sin(Math.PI * Math.pow(u, 0.78));
        const halfW = 0.24 * silk.widthScale * wProf;

        // 3D 空间扭转角（随路径 u 与时间 t 连续翻转，呈现真正的 3D 绸带立体翻飞）
        const twist = u * 8.5 - t * 3.2 + phaseOffset;
        const cs = Math.cos(twist), sn = Math.sin(twist);
        // 丝带横向向量（在 N-B 平面内旋转）
        const sx = F.bx * cs + F.nx * sn;
        const sy = F.by * cs + F.ny * sn;
        const sz = F.bz * cs + F.nz * sn;
        // 丝带法向起伏偏移（让主副丝带在 3D 中相互缠绕）
        const ox = (F.nx * cs - F.bx * sn) * helixRadius * wProf;
        const oy = (F.ny * cs - F.by * sn) * helixRadius * wProf;
        const oz = (F.nz * cs - F.bz * sn) * helixRadius * wProf;

        const idx = i * 6;
        arr[idx]     = F.cx + ox - sx * halfW;
        arr[idx + 1] = F.cy + oy - sy * halfW;
        arr[idx + 2] = F.cz + oz - sz * halfW;
        arr[idx + 3] = F.cx + ox + sx * halfW;
        arr[idx + 4] = F.cy + oy + sy * halfW;
        arr[idx + 5] = F.cz + oz + sz * halfW;
      }
      silk.geo.attributes.position.needsUpdate = true;
    }

    updateSilkGeo(rb.silkMain, 0.0, 0.06);
    updateSilkGeo(rb.silkSub, 2.2, 0.22);

    // 更新环绕 3D 丝带双螺旋飞舞的 900 片立体花瓣
    const d = rb.dummy;
    for (let i = 0; i < rb.N; i++) {
      const u = i / (rb.N - 1);
      const F = sampleRibbonFrame(u);
      const wProf = Math.sin(Math.PI * Math.pow(u, 0.80));
      const r0 = rb.rnd[i * 4], r1 = rb.rnd[i * 4 + 1], r2 = rb.rnd[i * 4 + 2], r3 = rb.rnd[i * 4 + 3];

      // 双螺旋涡流角度 + 个体三维径向散布
      const strand = (i & 1) ? Math.PI : 0.0;
      const spiralAng = u * 12.0 - t * 2.8 + strand + (r0 - 0.5) * 1.4;
      const rad = (0.12 + r1 * 0.68) * wProf;
      const offB = Math.cos(spiralAng) * rad;
      const offN = Math.sin(spiralAng) * rad;

      const x = F.cx + F.bx * offB + F.nx * offN;
      const y = F.cy + F.by * offB + F.ny * offN;
      const z = F.cz + F.bz * offB + F.nz * offN;

      d.position.set(x, y, z);
      d.rotation.set(
        spiralAng * 0.7 + r1 * TAU + Math.sin(t * 2.1 + u * 6.0) * 0.65,
        r2 * TAU + t * (0.8 + r0 * 0.9),
        (r3 - 0.5) * 1.8 + Math.cos(t * 1.7 + u * 5.5) * 0.65
      );
      d.scale.setScalar((1.05 + r2 * 1.15) * (0.35 + wProf * 1.05));
      d.updateMatrix();
      rb.inst.setMatrixAt(i, d.matrix);
    }
    rb.inst.instanceMatrix.needsUpdate = true;
  }
  /* ---------- 7c. 浪尖漫舞花瓣：顺着波峰柔滑起伏（消除垂直乱跳感） ---------- */
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
    const near = smoothstep(4.3, 9.6, d);
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
    const moat = -0.075 * (1.0 - smoothstep(3.4, 5.2, d));
    return h * lerp(0.05, 1.0, near) * far + moat;
  }

  function buildSpray() {
    const N = 1200;
    const geo = makeSeaPetalGeo();
    const mat = new T.MeshStandardMaterial({
      color: 0xffe4ef,
      roughness: 0.90,
      metalness: 0.0,
      envMapIntensity: 0.12,
      side: T.DoubleSide,
      emissive: 0xffb8d2,
      emissiveIntensity: 0.36,
    });
    const inst = new T.InstancedMesh(geo, mat, N);
    inst.instanceMatrix.setUsage(T.DynamicDrawUsage);
    inst.frustumCulled = false;
    scene.add(inst);
    const data = [];
    for (let i = 0; i < N; i++) {
      data.push({ ci: 0, ox: 0, oz: 0, t: Math.random() * 4, dur: 3.5, vy: 0, y0: 0, sp: 0, rot: 0, rx: 0, rz: 0, sc: 1 });
    }
    return { inst, data, dummy: new T.Object3D() };
  }
  const spray = buildSpray();
  regInst(spray.inst, 'spray');

  function respawnSpray(p, tNow, crests) {
    let ci = Math.floor(R() * CREST_N);
    for (let k = 0; k < 3; k++) {
      if (crests[ci].s > 0.35) break;
      ci = Math.floor(R() * CREST_N);
    }
    const a = R() * TAU;
    const rr = Math.sqrt(R()) * (4.0 + crests[ci].s * 6.0);
    p.ci = ci;
    p.ox = Math.cos(a) * rr;
    p.oz = Math.sin(a) * rr;
    p.t = 0;
    p.vy = 0.12 + R() * 0.28;
    p.dur = 3.2 + R() * 2.4;
    p.sp = 0.22 + R() * 0.45;
    p.rot = R() * TAU;
    p.rx = (R() - 0.5) * 0.55;
    p.rz = (R() - 0.5) * 0.55;
    p.sc = 0.75 + R() * 0.85;
    p.y0 = WORLD.waterY;
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
      const lifeU = clamp(tt / p.dur, 0, 1);
      // 柔和的正弦生灭包络，彻底消除花瓣突然冒出或消失的闪跳感
      const env = Math.sin(lifeU * Math.PI);

      // 顺着海风匀速缓移（不用随帧抖动的 WIND.strength 乘 tt^2，避免位置回弹乱跳）
      const x = c.x + p.ox + WIND.vec.x * tt * 0.55 + Math.sin(tt * 0.9 + p.rot) * 0.18;
      const z = c.z + p.oz + WIND.vec.y * tt * 0.55 + Math.cos(tt * 0.8 + p.rot) * 0.18;
      // 实时贴合当前(x, z)处的真实海浪高度，仅在浪尖上方轻盈掠过 0.03~0.32m
      const waveY = WORLD.waterY + seaWaveH(x, z, tNow);
      const y = waveY + 0.03 + env * p.vy;

      d.position.set(x, y, z);
      d.rotation.set(
        p.rx + Math.sin(tt * p.sp + p.rot) * 0.28,
        p.rot + tt * p.sp * 0.8,
        p.rz + Math.cos(tt * p.sp + p.rot) * 0.28
      );
      d.scale.setScalar(c.s < 0.35 ? 0 : p.sc * env * Math.min(1, (c.s - 0.35) * 2.5));
      d.updateMatrix();
      spray.inst.setMatrixAt(i, d.matrix);
    }
    spray.inst.instanceMatrix.needsUpdate = true;
  }
