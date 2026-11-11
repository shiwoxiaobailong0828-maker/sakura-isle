
  /* ---------- 13. 环境贴图 ---------- */
  // @hdri-inject
  const HDRI_SUNSET_B64 = "__HDRI_SUNSET__";
  function buildEnv() {
    const envScene = new T.Scene();
    const g = new T.SphereGeometry(20, 32, 24);
    const m = new T.ShaderMaterial({
      side: T.BackSide,
      vertexShader: `varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `
        varying vec3 vD;
        void main(){
          float h = vD.y * 0.5 + 0.5;
          vec3 sky = mix(vec3(0.62,0.74,0.86), vec3(0.30,0.52,0.78), smoothstep(0.45,1.0,h));
          vec3 gnd = mix(vec3(0.22,0.28,0.16), vec3(0.10,0.14,0.09), smoothstep(0.5,0.0,h));
          vec3 c = mix(gnd, sky, smoothstep(0.44,0.56,h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    envScene.add(new T.Mesh(g, m));
    // 高光板，让材质有反射层次
    const lights = [
      { p: [-7, 6, 5], s: [5, 4], c: 0xfff4e0, i: 6 },
      { p: [6, 4, 6], s: [4, 5], c: 0xcfe2ff, i: 2.6 },
    ];
    for (const L of lights) {
      const pl = new T.Mesh(new T.PlaneGeometry(L.s[0], L.s[1]),
        new T.MeshBasicMaterial({ color: new T.Color(L.c).multiplyScalar(L.i) }));
      pl.position.set(L.p[0], L.p[1], L.p[2]);
      pl.lookAt(0, 0, 0);
      envScene.add(pl);
    }
    const pmrem = new T.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromScene(envScene, 0.04);
    scene.environment = rt.texture;
    pmrem.dispose();
  }
  buildEnv();

  /* ---------- 13b. 黄昏 HDRI（Blender 生成，加载完成后覆盖程序化环境） ---------- */
  (function applyHdri() {
    const b64 = (typeof HDRI_SUNSET_B64 === 'string') ? HDRI_SUNSET_B64 : '';
    if (!b64 || b64.length < 200 || b64.charAt(0) === '_') return;
    const img = new Image();
    const tex = new T.Texture();
    tex.mapping = T.EquirectangularReflectionMapping;
    tex.colorSpace = T.SRGBColorSpace;
    img.onload = () => {
      tex.image = img;
      tex.needsUpdate = true;
      const pm = new T.PMREMGenerator(renderer);
      pm.compileEquirectangularShader();
      const rt2 = pm.fromEquirectangular(tex);
      const old = scene.environment;
      scene.environment = rt2.texture;
      if (old && old.dispose) old.dispose();
      pm.dispose();
      tex.dispose();
      console.log('[env] sunset HDRI applied');
    };
    img.onerror = () => console.warn('[env] HDRI decode failed');
    img.src = 'data:image/jpeg;base64,' + b64;
  })();
  /* ---------- 14. 后期 ---------- */
  const post = (function () {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = renderer.getPixelRatio();
    const rtScene = new T.WebGLRenderTarget(w * pr, h * pr, { type: T.HalfFloatType, samples: 4 });
    const rtB = new T.WebGLRenderTarget(w * pr / 2, h * pr / 2, { type: T.HalfFloatType, depthBuffer: false });
    const rtC = new T.WebGLRenderTarget(w * pr / 4, h * pr / 4, { type: T.HalfFloatType, depthBuffer: false });
    const rtD = new T.WebGLRenderTarget(w * pr / 4, h * pr / 4, { type: T.HalfFloatType, depthBuffer: false });
    const rtE = new T.WebGLRenderTarget(w * pr / 8, h * pr / 8, { type: T.HalfFloatType, depthBuffer: false });

    const quad = new T.Mesh(new T.PlaneGeometry(2, 2), null);
    quad.frustumCulled = false;
    const qs = new T.Scene(); qs.add(quad);
    const qc = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const vs = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0);} `;

    const brightMat = new T.ShaderMaterial({
      uniforms: { tD: { value: null }, uT: { value: 1.02 }, uK: { value: 0.34 } },
      vertexShader: vs,
      fragmentShader: `
        uniform sampler2D tD; uniform float uT, uK; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tD, vUv).rgb;
          float l = max(c.r, max(c.g, c.b));
          // ★ 萤火虫抑制：NaN / Inf / 超高亮像素会被 bloom 无限放大成光斑，先剔除
          //    ( !(l >= 0.0) 在 GLSL 里可捕获 NaN )
          if ( !(l >= 0.0) || l > 24.0 ) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          float soft = clamp(l - uT + uK, 0.0, 2.0*uK);
          soft = soft*soft/(4.0*uK + 1e-4);
          float w = max(soft, l - uT) / max(l, 1e-4);
          gl_FragColor = vec4(min(c * w, vec3(10.0)), 1.0);
        }`,
    });
    const blurMat = new T.ShaderMaterial({
      uniforms: { tD: { value: null }, uDir: { value: new T.Vector2(1, 0) }, uTexel: { value: new T.Vector2(1 / w, 1 / h) } },
      vertexShader: vs,
      fragmentShader: `
        uniform sampler2D tD; uniform vec2 uDir, uTexel; varying vec2 vUv;
        void main(){
          vec2 o = uDir * uTexel;
          vec3 s = texture2D(tD, vUv).rgb * 0.2270270270;
          s += texture2D(tD, vUv + o*1.3846153846).rgb * 0.3162162162;
          s += texture2D(tD, vUv - o*1.3846153846).rgb * 0.3162162162;
          s += texture2D(tD, vUv + o*3.2307692308).rgb * 0.0702702703;
          s += texture2D(tD, vUv - o*3.2307692308).rgb * 0.0702702703;
          gl_FragColor = vec4(s, 1.0);
        }`,
    });
    const composeMat = new T.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tB: { value: null }, tC: { value: null }, tD: { value: null }, tE: { value: null },
        uExposure: { value: 1.0 }, uBloom: { value: 0.30 }, uVig: { value: 0.55 },
        uSat: { value: 1.12 }, uTime: { value: 0 }, uFade: { value: 0 },
        uTint: { value: new T.Color(0xffffff) },
        uShadowTint: { value: new T.Color(0xffffff) },
        uHiTint: { value: new T.Color(0xffffff) },
        uSunScreen: { value: new T.Vector2(0.5, 0.5) },
        uSunStr: { value: 0.0 },
        uRayColor: { value: new T.Color(0xffc98f) },
        uSunScreen: { value: new T.Vector2(0.5, 0.6) },
        uSunVis: { value: 1.0 },
        uFlareColor: { value: new T.Color(0xfff0c8) },
      },
      vertexShader: vs,
      fragmentShader: `
        uniform sampler2D tScene, tB, tC, tD, tE;
        uniform float uExposure, uBloom, uVig, uSat, uTime, uFade;
        uniform vec3 uTint;
        uniform vec3 uShadowTint;
        uniform vec3 uHiTint;
        uniform vec2 uSunScreen;
        uniform float uSunStr;
        uniform vec3 uRayColor;
        varying vec2 vUv;
        vec3 aces(vec3 x){
          const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
          return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
        }
        void main(){
          vec2 uv = vUv;
          vec2 dir = uv - 0.5;
          float ca = 0.0008 * dot(dir, dir);
          vec3 col;
          col.r = texture2D(tScene, uv + dir*ca).r;
          col.g = texture2D(tScene, uv).g;
          col.b = texture2D(tScene, uv - dir*ca).b;

          vec3 bloom = texture2D(tB, uv).rgb*0.50 + texture2D(tC, uv).rgb*0.35
                     + texture2D(tD, uv).rgb*0.45 + texture2D(tE, uv).rgb*0.60;
          bloom = min(bloom, vec3(6.0));
          col += bloom * uBloom;

          // 丁达尔光束已按需求移除
          col *= uExposure;
          col = aces(col);
          // 对比 S 曲线
          col = clamp(col, 0.0, 1.0);
          col = col * col * (3.0 - 2.0 * col) * 0.42 + col * 0.58;
          float luma = dot(col, vec3(0.2126,0.7152,0.0722));
          col = mix(vec3(luma), col, uSat);
          // 冷暖分离：暗部偏冷、亮部偏暖
          float lum2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
          float mixK = smoothstep(0.12, 0.86, lum2);
          col = mix(col * uShadowTint, col * uHiTint, mixK);
          col *= uTint;
          // 逆光星芒已移除：位置与天空太阳对不上，且阴天会泛红

          float v = smoothstep(0.92, 0.28, length(dir)*1.24);
          col *= mix(1.0, v, uVig);
          col = pow(clamp(col,0.0,1.0), vec3(1.0/2.2));
          float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453);
          col += (g - 0.5) * (1.6/255.0);
          col *= uFade;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });

    function pass(mat, target) {
      quad.material = mat;
      renderer.setRenderTarget(target);
      renderer.render(qs, qc);
    }
    return {
      rtScene,
      uniforms: composeMat.uniforms,
      render(dt) {
        renderer.setRenderTarget(rtScene);
        renderer.clear();
        renderer.render(scene, camera);
        brightMat.uniforms.tD.value = rtScene.texture;
        pass(brightMat, rtB);
        blurMat.uniforms.tD.value = rtB.texture;
        blurMat.uniforms.uTexel.value.set(2 / (w * pr), 2 / (h * pr));
        blurMat.uniforms.uDir.value.set(1, 0); pass(blurMat, rtC);
        blurMat.uniforms.tD.value = rtC.texture;
        blurMat.uniforms.uDir.value.set(0, 1); pass(blurMat, rtD);
        blurMat.uniforms.tD.value = rtD.texture;
        blurMat.uniforms.uTexel.value.set(4 / (w * pr), 4 / (h * pr));
        blurMat.uniforms.uDir.value.set(1, 0); pass(blurMat, rtE);
        composeMat.uniforms.tScene.value = rtScene.texture;
        composeMat.uniforms.tB.value = rtB.texture;
        composeMat.uniforms.tC.value = rtC.texture;
        composeMat.uniforms.tD.value = rtD.texture;
        composeMat.uniforms.tE.value = rtE.texture;
        pass(composeMat, null);
      },
      setSize(W, H) {
        const P = renderer.getPixelRatio();
        rtScene.setSize(W * P, H * P);
        rtB.setSize(W * P / 2, H * P / 2);
        rtC.setSize(W * P / 4, H * P / 4);
        rtD.setSize(W * P / 4, H * P / 4);
        rtE.setSize(W * P / 8, H * P / 8);
      },
    };
  })();

  /* ---------- 15. 时间 / 天气 ---------- */
  const state = { time: 'afternoon', weather: 'sunny', autoRotate: false };

  const PRESETS = {
    morning: {
      skyTop: 0x5d93c8, skyMid: 0xc3dcee, skyBot: 0xf2ece2,
      sunDir: [-0.42, 0.30, -0.86], sunColor: 0xffe8c2, sunInt: 2.85,
      hemiSky: 0xcfe2ff, hemiGnd: 0x53603c, hemiInt: 0.72,
      fog: 0xe8eef2, fogD: 0.0105,
      cloud: 0.30, cloudTint: 0xfff0e2, glow: 0xffcf9a, sunset: 0.28, shadowTint: 0xa8b8dd, hiTint: 0xfff0dc,
      exposure: 0.80, bloom: 0.30, tint: 0xfff4e8, sat: 1.06,
    },
    noon: {
      skyTop: 0x2763ae, skyMid: 0x8cbbdf, skyBot: 0xd4e2ec,
      sunDir: [-0.45, 0.68, 0.58], sunColor: 0xfffdf8, sunInt: 3.35,
      hemiSky: 0xe2efff, hemiGnd: 0x5c6b40, hemiInt: 0.95,
      fog: 0xdfeaf2, fogD: 0.0085,
      cloud: 0.24, cloudTint: 0xffffff, glow: 0xfff0d0, sunset: 0.04, shadowTint: 0xbfcde8, hiTint: 0xfffaf0,
      exposure: 0.72, bloom: 0.24, tint: 0xffffff, sat: 1.12,
    },
    afternoon: {
      skyTop: 0x2f66ac, skyMid: 0x92bad9, skyBot: 0xd8e2ea,
      sunDir: [-0.40, 0.42, -0.82], sunColor: 0xfff6ec, sunInt: 3.15,
      hemiSky: 0xdcecff, hemiGnd: 0x55673f, hemiInt: 0.92,
      fog: 0xdfeaf2, fogD: 0.0090,
      cloud: 0.28, cloudTint: 0xfff8f0, glow: 0xffc287, sunset: 0.40, shadowTint: 0x9fb2d8, hiTint: 0xffeed2,
      exposure: 0.74, bloom: 0.30, tint: 0xfff8ee, sat: 1.10,
    },
    dusk: {
      skyTop: 0x263868, skyMid: 0xd47e6a, skyBot: 0xf6c28b,
      sunDir: [-0.62, 0.40, -0.50], sunColor: 0xffc282, sunInt: 2.65,
      hemiSky: 0xb2b6dc, hemiGnd: 0x5b4634, hemiInt: 0.76,
      fog: 0xe4b296, fogD: 0.0056,
      cloud: 0.34, cloudTint: 0xffd6a6, glow: 0xff7e3e, sunset: 1.00, shadowTint: 0xb0a8cf, hiTint: 0xffe8cc,
      exposure: 0.88, bloom: 0.28, tint: 0xffead2, sat: 1.22,
    },
    night: {
      skyTop: 0x050a18, skyMid: 0x14213d, skyBot: 0x2a3550,
      sunDir: [-0.40, 0.62, 0.68], sunColor: 0xaec8ff, sunInt: 0.55,
      hemiSky: 0x3a4c78, hemiGnd: 0x14180f, hemiInt: 0.30,
      fog: 0x0e1626, fogD: 0.0160,
      cloud: 0.18, cloudTint: 0x33405f, glow: 0x33426e, sunset: 0.00, shadowTint: 0x6a7bb0, hiTint: 0xa9c0ff,
      exposure: 1.02, bloom: 0.42, tint: 0xb9caf0, sat: 0.98,
    },
  };

  // 花瓣海在各时段的配色
  const SEA_PALETTE = {
    morning:   { deep: 0xc0698f, mid: 0xefb6ca, crest: 0xfff4f8, sky: 0xc8dcf0, bright: 1.00 },
    noon:      { deep: 0xc85f8e, mid: 0xefa9c4, crest: 0xfff2f7, sky: 0xa8c8e8, bright: 1.06 },
    afternoon: { deep: 0xbe5f8b, mid: 0xeaa6c1, crest: 0xffeff6, sky: 0x9dc2e4, bright: 1.00 },
    dusk:      { deep: 0x863b62, mid: 0xdc8896, crest: 0xffe2ca, sky: 0xe29e88, bright: 0.90 },
    night:     { deep: 0x121a30, mid: 0x2b3556, crest: 0x8894bb, sky: 0x1b2747, bright: 0.30 },
  };

  function applyTime(name) {
    const p = PRESETS[name] || PRESETS.afternoon;
    state.time = name;
    skyUniforms.uTop.value.setHex(p.skyTop);
    skyUniforms.uMid.value.setHex(p.skyMid);
    skyUniforms.uBot.value.setHex(p.skyBot);
    skyUniforms.uSunDir.value.set(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize();
    skyUniforms.uSunColor.value.setHex(p.sunColor);
    sun.color.setHex(p.sunColor);
    sun.intensity = p.sunInt;
    sun.position.copy(skyUniforms.uSunDir.value).multiplyScalar(14);
    sun.target.position.set(0, 1.0, 0);
    sun.target.updateMatrixWorld();
    hemi.color.setHex(p.hemiSky);
    hemi.groundColor.setHex(p.hemiGnd);
    hemi.intensity = p.hemiInt;
    if (typeof underCanopyLight !== 'undefined') {
      const lanternStr = name === 'night' ? 2.15 : (name === 'dusk' ? 1.45 : (name === 'morning' ? 0.55 : 0.35));
      underCanopyLight.intensity = lanternStr;
      underCanopyLight.color.setHex(name === 'night' ? 0xff9d42 : 0xffb366);
    }
    if (typeof fill !== 'undefined') {
      fill.intensity = name === 'night' ? 0.36 : (name === 'dusk' ? 0.94 : 0.78);
      fill.color.setHex(name === 'night' ? 0x6882b8 : 0xffe0c8);
    }
    scene.fog.color.setHex(p.fog);
    scene.fog.density = p.fogD;
    post.uniforms.uExposure.value = p.exposure;
    post.uniforms.uBloom.value = p.bloom;
    post.uniforms.uTint.value.setHex(p.tint);
    post.uniforms.uSat.value = p.sat;
    post.uniforms.uShadowTint.value.setHex(p.shadowTint || 0xffffff);
    post.uniforms.uHiTint.value.setHex(p.hiTint || 0xffffff);
    // 天气系统基于"基准值"做绝对计算，不能每帧累乘
    state.base = { sunInt: p.sunInt, hemiInt: p.hemiInt, fogD: p.fogD, sat: p.sat };
    // 云层
    skyUniforms.uCloudTint.value.setHex(p.cloudTint || 0xffffff);
    skyUniforms.uGlow.value.setHex(p.glow || 0xff8a3d);
    skyUniforms.uSunset.value = (p.sunset === undefined ? 0 : p.sunset);
    // 丁达尔光柱：黄昏最强
    if (typeof shaftUniforms !== 'undefined') {
      shaftUniforms.uStrength.value = 0.25 + (p.sunset === undefined ? 0 : p.sunset) * 1.15;
      beamUniforms.uStrength.value = 0.18 + (p.sunset === undefined ? 0 : p.sunset) * 1.05;
      beamUniforms.uColor.value.setHex(p.glow || 0xffd7a8);
      shaftUniforms.uColor.value.setHex(p.glow || 0xffd7a8);
      orientShafts();
    }
    state.cloudBase = (p.cloud === undefined ? 0.26 : p.cloud);
    skyUniforms.uCloud.value = state.cloudBase + (skyUniforms.uCloudWet.value * 0.72);
    // 花瓣海配色随时段变化，夜里不能还是粉的
    const sp = SEA_PALETTE[name] || SEA_PALETTE.afternoon;
    seaUniforms.uDeep.value.setHex(sp.deep);
    seaUniforms.uMid.value.setHex(sp.mid);
    seaUniforms.uCrest.value.setHex(sp.crest);
    seaUniforms.uSky.value.setHex(sp.sky);
    seaUniforms.uBright.value = sp.bright;
    state.seaBrightBase = sp.bright;
    if (typeof spray !== 'undefined' && spray && spray.inst) {
      spray.inst.material.color.setHex(0xffe4ef).multiplyScalar(0.45 + sp.bright * 0.65);
      spray.inst.material.emissiveIntensity = 0.38 * sp.bright;
    }

    document.querySelectorAll('[data-time]').forEach(b => b.classList.toggle('on', b.dataset.time === name));
  }

  /* ---------- 16. 天气 ---------- */
  const weather = {
    rainAmt: 0, snowAmt: 0,
    rainMesh: null, snowMesh: null,
    rainN: 2400, snowN: 2600,
    rainData: [], snowData: [],
  };
  function buildWeather() {
    // 雨：线段
    const rp = new Float32Array(weather.rainN * 6);
    for (let i = 0; i < weather.rainN; i++) {
      const x = (R() - 0.5) * 18, y = R() * 14, z = (R() - 0.5) * 18;
      rp[i * 6] = x; rp[i * 6 + 1] = y; rp[i * 6 + 2] = z;
      rp[i * 6 + 3] = x; rp[i * 6 + 4] = y - 0.42; rp[i * 6 + 5] = z;
      weather.rainData.push({ v: 8 + R() * 7, x, y, z });
    }
    const rg = new T.BufferGeometry();
    rg.setAttribute('position', new T.BufferAttribute(rp, 3));
    weather.rainMesh = new T.LineSegments(rg, new T.LineBasicMaterial({
      color: 0x8fb0cc, transparent: true, opacity: 0.34,
    }));
    weather.rainMesh.frustumCulled = false;
    weather.rainMesh.visible = false;
    scene.add(weather.rainMesh);

    // 雪：点
    const sp = new Float32Array(weather.snowN * 3);
    for (let i = 0; i < weather.snowN; i++) {
      sp[i * 3] = (R() - 0.5) * 18;
      sp[i * 3 + 1] = R() * 14;
      sp[i * 3 + 2] = (R() - 0.5) * 18;
      weather.snowData.push({
        v: 0.45 + R() * 1.1, ph: R() * TAU, sw: 0.6 + R() * 1.4,
        bx: (R() - 0.5) * 18, bz: (R() - 0.5) * 18,   // 固定基准点，只做摆动
        y: R() * 13,                                    // ★ 必须有初值，否则 NaN 永远掉不下去
      });
    }
    const sg = new T.BufferGeometry();
    sg.setAttribute('position', new T.BufferAttribute(sp, 3));
    const snowMat = new T.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uSize: { value: 2.4 } },
      vertexShader: `
        uniform float uSize;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = uSize * 55.0 / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d));
          gl_FragColor = vec4(1.0, 1.0, 1.0, a * 0.75);
        }`,
    });
    weather.snowMesh = new T.Points(sg, snowMat);
    weather.snowMesh.frustumCulled = false;
    weather.snowMesh.visible = false;
    scene.add(weather.snowMesh);
  }
  buildWeather();

  // 雨雪强度（0.2 ~ 1.5）
  let wxPower01 = 0.7;
  const wxPowerEl = document.getElementById('wxPower');
  const wxPowerValEl = document.getElementById('wxPowerVal');
  const wxGroupEl = document.getElementById('wxGroup');
  if (wxPowerEl) {
    wxPower01 = wxPowerEl.value / 100;
    wxPowerEl.addEventListener('input', () => {
      wxPower01 = wxPowerEl.value / 100;
      if (wxPowerValEl) wxPowerValEl.textContent = wxPowerEl.value + '%';
    });
  }

  const min01 = (x) => Math.min(1, Math.max(0, x));

  function setWeather(name) {
    state.weather = name;
    document.querySelectorAll('[data-weather]').forEach(b => b.classList.toggle('on', b.dataset.weather === name));
    const g = document.getElementById('wxGroup');
    if (g) g.classList.toggle('dim', name === 'sunny');
  }

  let _wxLast = 0;
  function updateWeather() {
    // ★ 用真实时间推进过渡：低帧率设备上也能在 1 秒左右到位
    const _now = performance.now();
    const dt = _wxLast ? Math.min(0.2, (_now - _wxLast) / 1000) : 0.016;
    _wxLast = _now;
    // 平滑过渡
    const tRain = state.weather === 'rain' ? wxPower01 : 0;
    const tSnow = state.weather === 'snow' ? wxPower01 : 0;
    weather.rainAmt += (tRain - weather.rainAmt) * Math.min(1, dt * 4.0);
    weather.snowAmt += (tSnow - weather.snowAmt) * Math.min(1, dt * 4.0);
    if (Math.abs(tRain - weather.rainAmt) < 0.01) weather.rainAmt = tRain;
    if (Math.abs(tSnow - weather.snowAmt) < 0.01) weather.snowAmt = tSnow;

    const amt = Math.max(weather.rainAmt, weather.snowAmt);
    const amtC = Math.min(1, amt);
    // ★ 必须用绝对赋值：原来 *= / += 每帧累乘，几秒后光照归零、雾密度爆表 → 全白
    const B = state.base || { sunInt: 3.0, hemiInt: 0.9, fogD: 0.012, sat: 1.1 };
    sun.intensity = B.sunInt * (1 - 0.34 * amtC);
    hemi.intensity = B.hemiInt * (1 + 0.06 * amtC);
    scene.fog.density = B.fogD + 0.004 * amtC;
    post.uniforms.uSat.value = B.sat * (1 - 0.10 * amtC);
    // 云量 / 铅灰程度随雨雪变化
    skyUniforms.uCloudWet.value = amtC;
    skyUniforms.uCloud.value = (state.cloudBase === undefined ? 0.26 : state.cloudBase) + amtC * 0.52;

    if (seaUniforms.uBright) {
      seaUniforms.uBright.value = (state.seaBrightBase || 1) * (1 - 0.16 * amtC);
    }

    weather.rainMesh.visible = weather.rainAmt > 0.01;
    weather.snowMesh.visible = weather.snowAmt > 0.01;

    if (weather.rainMesh.visible) {
      weather.rainMesh.material.opacity = 0.34 * Math.min(1, weather.rainAmt);
      const arr = weather.rainMesh.geometry.attributes.position.array;
      for (let i = 0; i < weather.rainN; i++) {
        const d = weather.rainData[i];
        d.y -= d.v * dt * 1.6 * (0.7 + weather.rainAmt * 0.6);
        d.x += dt * 1.6;
        if (d.y < 0) { d.y = 13 + R() * 2; d.x = (R() - 0.5) * 18; d.z = (R() - 0.5) * 18; }
        arr[i * 6] = d.x; arr[i * 6 + 1] = d.y; arr[i * 6 + 2] = d.z;
        arr[i * 6 + 3] = d.x - 0.05; arr[i * 6 + 4] = d.y - 0.42; arr[i * 6 + 5] = d.z;
      }
      weather.rainMesh.geometry.attributes.position.needsUpdate = true;
    }
    if (weather.snowMesh.visible) {
      weather.snowMesh.material.uniforms.uSize.value = 1.10 + 0.70 * min01(weather.snowAmt);
      const arr = weather.snowMesh.geometry.attributes.position.array;
      for (let i = 0; i < weather.snowN; i++) {
        const d = weather.snowData[i];
        d.y -= d.v * dt;
        if (d.y < 0) { d.y = 13 + R() * 2; }
        // ★ 用固定的基准点做左右飘摆；之前每帧重新随机 x/z 会让雪花变成噪点
        arr[i * 3] = d.bx + Math.sin(elapsed * d.sw + d.ph) * 0.55;
        arr[i * 3 + 1] = d.y;
        arr[i * 3 + 2] = d.bz + Math.cos(elapsed * d.sw * 0.8 + d.ph) * 0.55;
      }
      weather.snowMesh.geometry.attributes.position.needsUpdate = true;
    }
  }

  /* ---------- 16b. 萤火虫：夜晚围绕樱花树螺旋飞舞的光点 ---------- */
  const firefly = (function () {
    const N = 260;
    const pos = new Float32Array(N * 3);
    const aPhase = new Float32Array(N);
    const aSize = new Float32Array(N);
    const data = [];
    for (let i = 0; i < N; i++) {
      data.push({
        a0: R() * TAU,                  // 初始角度
        aSpd: 0.16 + R() * 0.36,        // 角速度 → 螺旋的转速
        r0: 1.0 + R() * 3.6,            // 环绕半径
        rAmp: 0.40 + R() * 1.25,        // 半径呼吸幅度
        rSpd: 0.20 + R() * 0.55,
        y0: 0.6 + R() * 8.6,            // 高度
        yAmp: 0.35 + R() * 1.5,
        ySpd: 0.32 + R() * 0.85,
        ph: R() * TAU,
      });
      aPhase[i] = R();
      aSize[i] = 0.55 + R() * 0.95;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new T.BufferAttribute(aPhase, 1));
    geo.setAttribute('aSize', new T.BufferAttribute(aSize, 1));
    const mat = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uAmt: { value: 0 },
        uPix: { value: Math.min(2, window.devicePixelRatio || 1) },
      },
      vertexShader: `
        uniform float uTime, uPix;
        attribute float aPhase;
        attribute float aSize;
        varying float vTw;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // 每只萤火虫自己的闪烁节奏
          float tw = 0.30 + 0.70 * pow(0.5 + 0.5 * sin(uTime * (0.9 + aPhase * 2.3) + aPhase * 31.0), 2.2);
          vTw = tw;
          gl_PointSize = aSize * 30.0 * uPix * (0.5 + tw * 0.8) / max(-mv.z, 0.6);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uAmt;
        varying float vTw;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          float core = smoothstep(0.5, 0.0, r);
          float glow = pow(core, 3.0);
          // 黄绿 → 暖白的芯
          vec3 col = mix(vec3(0.55, 1.0, 0.30), vec3(1.0, 0.96, 0.62), core);
          float a = (glow * 0.85 + core * 0.30) * vTw * uAmt;
          gl_FragColor = vec4(col * (1.3 + vTw * 1.7), a);
        }`,
    });
    const pts = new T.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    scene.add(pts);
    return { pts, data, geo, mat };
  })();

  let fireflyAmt = 0;
  function updateFireflies(t, dt) {
    // 只在夜里出现；雨雪天收起来
    const wantNight = state.time === 'night' ? 1 : 0;
    const wAmt = Math.max(weather.rainAmt, weather.snowAmt);
    const tgt = wantNight * (1 - Math.min(1, wAmt * 1.3));
    fireflyAmt += (tgt - fireflyAmt) * Math.min(1, dt * 1.6);
    if (Math.abs(fireflyAmt - tgt) < 0.004) fireflyAmt = tgt;

    firefly.pts.visible = fireflyAmt > 0.012;
    if (!firefly.pts.visible) return;

    firefly.mat.uniforms.uTime.value = t;
    firefly.mat.uniforms.uAmt.value = fireflyAmt;

    const arr = firefly.geo.attributes.position.array;
    for (let i = 0; i < firefly.data.length; i++) {
      const d = firefly.data[i];
      const a = d.a0 + t * d.aSpd;                                   // 角度匀速增加 → 螺旋
      const r = d.r0 + Math.sin(t * d.rSpd + d.ph) * d.rAmp;         // 半径呼吸
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] = d.y0 + Math.sin(t * d.ySpd + d.ph) * d.yAmp;  // 上下起伏
      arr[i * 3 + 2] = Math.sin(a) * r;
    }
    firefly.geo.attributes.position.needsUpdate = true;
  }
  /* ---------- 16c. 魔法光尘：空中漂浮的发光微粒（黄昏也可见） ---------- */
  const dust = (function () {
    const N = 520;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const data = [];
    for (let i = 0; i < N; i++) {
      data.push({
        a: R() * TAU,
        rad: 1.2 + Math.pow(R(), 0.7) * 12.0,
        y: 0.4 + R() * 7.0,
        spd: 0.10 + R() * 0.22,      // 环绕速度
        vy: 0.02 + R() * 0.06,       // 缓慢上升
        ph: R() * TAU,
        sz: 0.5 + R() * 1.0,
      });
      seed[i] = R();
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new T.BufferAttribute(seed, 1));
    const mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPix: { value: Math.min(2, window.devicePixelRatio || 1) },
        uWarm: { value: new T.Color(0xffd8a0) },
        uAmt: { value: 1.0 },
      },
      vertexShader: `
        uniform float uTime, uPix;
        attribute float aSeed;
        varying float vA;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float tw = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.5 + aSeed) + aSeed * 20.0));
          vA = tw;
          gl_PointSize = (1.6 + aSeed * 2.4) * uPix * 26.0 / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uWarm; uniform float uAmt;
        varying float vA;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          float core = smoothstep(0.5, 0.0, r);
          float a = pow(core, 2.4) * vA * uAmt * 0.55;
          gl_FragColor = vec4(uWarm * (1.15 + vA * 0.9), a);
        }`,
    });
    const pts = new T.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return { pts, data, geo, mat };
  })();

  function updateDust(t) {
    const arr = dust.geo.attributes.position.array;
    for (let i = 0; i < dust.data.length; i++) {
      const d = dust.data[i];
      const a = d.a + t * d.spd;
      const rad = d.rad + Math.sin(t * 0.4 + d.ph) * 0.35;
      let y = d.y + Math.sin(t * 0.55 + d.ph) * 0.45 + ((t * d.vy) % 1.2);
      arr[i * 3] = Math.cos(a) * rad;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = Math.sin(a) * rad;
    }
    dust.geo.attributes.position.needsUpdate = true;
    dust.mat.uniforms.uTime.value = t;
  }
  /* ---------- 17. 开场动画 ---------- */
  let introT = 0;
  const INTRO_DUR = 2.8;
  let INTRO_START = performance.now();
  function updateIntro() {
    if (introT >= INTRO_DUR) return;
    const now = performance.now();
    introT = Math.min(INTRO_DUR, (now - INTRO_START) / 1000);
    const t = introT / INTRO_DUR;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    camera.position.lerpVectors(CAM_START, CAM_END, e);
    camera.lookAt(0, 1.25, 0);
    post.uniforms.uFade.value = smoothstep(0, 0.5, e);
    if (introT >= INTRO_DUR) {
      controls.enabled = true;
      applyFitView();
      post.uniforms.uFade.value = 1;
    }
  }

  /* ---------- 18. UI ---------- */
  document.querySelectorAll('[data-time]').forEach(b => {
    b.addEventListener('click', () => applyTime(b.dataset.time));
  });
  document.querySelectorAll('[data-weather]').forEach(b => {
    b.addEventListener('click', () => setWeather(b.dataset.weather));
  });
  const btnRotate = document.getElementById('btnRotate');
  if (btnRotate) btnRotate.addEventListener('click', () => {
    state.autoRotate = !state.autoRotate;
    btnRotate.classList.toggle('on', state.autoRotate);
  });
  const btnReset = document.getElementById('btnReset');
  /* ---------- 丝带花瓣：鼠标追踪 ---------- */
  const btnSound = document.getElementById('btnSound');
  if (btnSound) {
    btnSound.addEventListener('click', () => {
      const on = toggleAudio();
      btnSound.classList.toggle('on', !!on);
    });
  }
  const btnRibbon = document.getElementById('btnRibbon');
  if (btnRibbon) {
    btnRibbon.addEventListener('click', () => {
      ribbon.on = !ribbon.on;
      btnRibbon.classList.toggle('on', ribbon.on);
      if (!ribbon.on) ribbon.trail.length = 0;
    });
  }
  const _cv = renderer.domElement;
  _cv.addEventListener('pointermove', (e) => {
    const r = _cv.getBoundingClientRect();
    ribbon.ndc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -(((e.clientY - r.top) / r.height) * 2 - 1)
    );
    ribbon.hover = true;
  });
  _cv.addEventListener('pointerleave', () => { ribbon.hover = false; });
  if (btnReset) btnReset.addEventListener('click', () => {
    applyFitView();
  });
  const btnShot = document.getElementById('btnShot');
  if (btnShot) btnShot.addEventListener('click', () => {
    post.render(0.016);
    renderer.domElement.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '樱花树下-' + Date.now() + '.png';
      a.click();
    });
  });

  /* ---------- 18b. 水面倒影：克隆岛与树，镜像到水下 ---------- */
  function buildReflection() {
    function cloneForMirror(group, opacity) {
      const g = group.clone(true);
      g.traverse(function (o) {
        // 倒影只保留树干剪影，花朵/草不需要镜像
        if (o.isInstancedMesh && o.geometry && o.geometry.attributes &&
            (o.geometry.attributes.aRand || o.count > 2000)) {
          o.visible = false;
          return;
        }
        if (o.isMesh || o.isInstancedMesh || o.isPoints || o.isLineSegments) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          const newMats = mats.map(function (m) {
            if (!m) return m;
            const mm = m.clone();
            mm.transparent = true;
            mm.opacity = (m.opacity !== undefined ? m.opacity : 1) * opacity;
            mm.depthWrite = false;
            mm.side = T.DoubleSide;
            mm.fog = true;
            return mm;
          });
          o.material = Array.isArray(o.material) ? newMats : newMats[0];
          o.castShadow = false;
          o.receiveShadow = false;
          o.renderOrder = -1;
        }
      });
      return g;
    }
    const r1 = cloneForMirror(islandGroup, 0.30);
    mirrorGroup.add(r1);
    const r2 = cloneForMirror(treeGroup, 0.26);
    mirrorGroup.add(r2);
  }
  // 花瓣海不反射，跳过倒影克隆
  // buildReflection();

  applyFitView();
  applyTime('dusk');   // 默认黄昏，贴近参考图氛围
  setWeather('sunny');


  /* ---------- 18c. 音频氛围 + 樱花五声古筝/八音盒 BGM（WebAudio 程序化，默认静音） ---------- */
  let actx = null;
  function initAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    // 3 秒布朗噪声缓冲
    const len = Math.floor(ctx.sampleRate * 3);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;

    // 低通 → 海浪感
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 0.6;

    const gWaves = ctx.createGain();
    gWaves.gain.value = 0.36;

    src.connect(lp); lp.connect(gWaves); gWaves.connect(master);

    // 缓慢起伏（浪的呼吸）
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.085;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.18;
    lfo.connect(lfoAmt); lfoAmt.connect(gWaves.gain);

    // 第二层：高通风声，更"沙沙"
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const gWind = ctx.createGain();
    gWind.gain.value = 0.038;
    const src2 = ctx.createBufferSource();
    src2.buffer = buf; src2.loop = true;
    src2.connect(hp); hp.connect(gWind); gWind.connect(master);

    // 第三层：立体声延迟混响总线 + 樱花五声/平调子（Koto & Celesta）治愈系旋律与温暖弦垫
    const bgmBus = ctx.createGain();
    bgmBus.gain.value = 0.78;
    bgmBus.connect(master);

    const delayL = ctx.createDelay(2.0);
    const delayR = ctx.createDelay(2.0);
    delayL.delayTime.value = 0.36;
    delayR.delayTime.value = 0.52;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const wet = ctx.createGain();
    wet.gain.value = 0.34;
    const dFilter = ctx.createBiquadFilter();
    dFilter.type = 'lowpass';
    dFilter.frequency.value = 2200;
    bgmBus.connect(delayL);
    delayL.connect(dFilter);
    dFilter.connect(delayR);
    delayR.connect(fb);
    fb.connect(delayL);
    delayL.connect(wet);
    delayR.connect(wet);
    wet.connect(master);

    // 柔和温暖的 D 大调五声环境垫音（D3 + A3 + F#4）
    const padFreqs = [146.83, 220.00, 369.99];
    for (let k = 0; k < padFreqs.length; k++) {
      const pOsc = ctx.createOscillator();
      pOsc.type = 'sine';
      pOsc.frequency.value = padFreqs[k];
      const pGain = ctx.createGain();
      pGain.gain.value = 0.045;
      pOsc.connect(pGain);
      pGain.connect(bgmBus);
      pOsc.start();
    }

    // 拨弦古筝 / 空灵八音盒旋律序列（D 大调与都节五声交融）
    const phrase = [
      { f: 587.33, d: 0.75 }, { f: 659.25, d: 0.75 }, { f: 739.99, d: 1.20 }, { f: 880.00, d: 0.90 },
      { f: 739.99, d: 0.75 }, { f: 659.25, d: 0.75 }, { f: 587.33, d: 1.35 }, { f: 440.00, d: 1.05 },
      { f: 493.88, d: 0.75 }, { f: 587.33, d: 0.75 }, { f: 659.25, d: 1.20 }, { f: 493.88, d: 0.90 },
      { f: 440.00, d: 0.85 }, { f: 369.99, d: 0.85 }, { f: 293.66, d: 1.65 }, { f: 440.00, d: 1.15 },
    ];
    let stepIdx = 0;
    function pluckNote(freq, dur, isBell) {
      if (!audioOn || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = isBell ? 'sine' : 'triangle';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(freq, now);
      osc2.frequency.setValueAtTime(freq * 2.0, now);

      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(freq * 4.5, now);
      flt.frequency.exponentialRampToValueAtTime(freq * 1.3, now + dur * 1.4);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(isBell ? 0.11 : 0.16, now + 0.018);
      env.gain.exponentialRampToValueAtTime(0.0008, now + dur * 1.85);

      const g2 = ctx.createGain();
      g2.gain.value = 0.25;
      osc1.connect(flt);
      osc2.connect(g2);
      g2.connect(flt);
      flt.connect(env);
      env.connect(bgmBus);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + dur * 1.9);
      osc2.stop(now + dur * 1.9);
    }

    function scheduleNext() {
      const note = phrase[stepIdx % phrase.length];
      pluckNote(note.f, note.d, stepIdx % 4 === 2);
      if (stepIdx % 4 === 0) {
        pluckNote(note.f * 0.5, note.d * 1.6, false);
      }
      stepIdx++;
      setTimeout(scheduleNext, Math.round(note.d * 720));
    }
    setTimeout(scheduleNext, 300);

    src.start(); src2.start(); lfo.start();
    return { ctx, master };
  }

  let audioOn = false, audioRef = null;
  function toggleAudio() {
    if (!audioRef) audioRef = initAudio();
    if (!audioRef) return false;
    const { ctx, master } = audioRef;
    if (ctx.state === 'suspended') ctx.resume();
    audioOn = !audioOn;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(audioOn ? 0.32 : 0.0, t, 0.35);
    return audioOn;
  }
  /* ---------- 18d. 点击互动：点树落花瓣 / 点灯笼亮灭 ---------- */
  const petalBurst = (function () {
    const N = 150;
    const geo = new T.CircleGeometry(0.032, 5);
    geo.scale(0.72, 1.0, 1.0);
    const mat = new T.MeshStandardMaterial({
      color: 0xffc6da, roughness: 0.9, metalness: 0,
      side: T.DoubleSide, emissive: 0xffb0cc, emissiveIntensity: 0.14,
    });
    const inst = new T.InstancedMesh(geo, mat, N);
    inst.instanceMatrix.setUsage(T.DynamicDrawUsage);
    inst.frustumCulled = false;
    inst.visible = false;
    scene.add(inst);
    const data = [];
    for (let i = 0; i < N; i++) {
      data.push({
        life: 0, maxLife: 1,
        p: new T.Vector3(), v: new T.Vector3(),
        rx: 0, ry: 0, rz: 0, rs: 0, sc: 1,
      });
    }
    return { inst, data, dummy: new T.Object3D() };
  })();

  function triggerPetalBurst() {
    let emitted = 0;
    for (const pt of petalBurst.data) {
      if (pt.life > 0) continue;
      const a = Math.random() * TAU;
      const rr = Math.pow(Math.random(), 0.7) * 2.8;
      // 树冠范围（世界坐标，树冠中心约 y=4~7）
      pt.p.set(TREE.x + Math.cos(a) * rr, 6.2 + Math.random() * 2.4, TREE.z + Math.sin(a) * rr);
      pt.v.set((Math.random() - 0.5) * 1.1, -0.5 - Math.random() * 1.1, (Math.random() - 0.5) * 1.1);
      pt.maxLife = 2.4 + Math.random() * 1.4;
      pt.life = pt.maxLife;
      pt.rx = Math.random() * TAU; pt.ry = Math.random() * TAU; pt.rz = Math.random() * TAU;
      pt.rs = (Math.random() - 0.5) * 5.0;
      pt.sc = 0.7 + Math.random() * 0.9;
      if (++emitted >= 80) break;
    }
    petalBurst.inst.visible = true;
  }

  function updatePetalBurst(dt) {
    const d = petalBurst;
    if (!d.inst.visible) return;
    let alive = 0;
    const dummy = d.dummy;
    for (let i = 0; i < d.data.length; i++) {
      const pt = d.data[i];
      if (pt.life > 0) {
        pt.life -= dt;
        pt.v.y -= 1.1 * dt;                       // 重力
        pt.v.x += WIND.vec.x * 0.55 * dt;         // 顺风
        pt.v.z += WIND.vec.y * 0.55 * dt;
        pt.p.addScaledVector(pt.v, dt);
        pt.rx += pt.rs * dt; pt.ry += pt.rs * 0.6 * dt;
        if (pt.p.y < 0.10) pt.life = 0;
        alive++;
      }
      const s = pt.life > 0 ? pt.sc : 0;
      dummy.position.copy(pt.p);
      dummy.rotation.set(pt.rx, pt.ry, pt.rz);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      d.inst.setMatrixAt(i, dummy.matrix);
    }
    d.inst.instanceMatrix.needsUpdate = true;
    if (alive === 0) d.inst.visible = false;
  }

  // 灯笼整体亮灭
  let lanternsOn = true;
  function toggleLanterns() {
    lanternsOn = !lanternsOn;
    if (typeof lanternMats !== 'undefined') {
      for (const m of lanternMats) {
        m.emissiveIntensity = lanternsOn ? 1.9 : 0.06;
      }
    }
  }

  // 射线拾取
  const _ray = new T.Raycaster();
  const _ndc = new T.Vector2();
  let _downPt = null;
  const _dom = renderer.domElement;
  _dom.addEventListener('pointerdown', (e) => { _downPt = { x: e.clientX, y: e.clientY }; });
  _dom.addEventListener('pointerup', (e) => {
    if (!_downPt) return;
    const moved = Math.hypot(e.clientX - _downPt.x, e.clientY - _downPt.y);
    _downPt = null;
    if (moved > 8) return;                       // 拖动不算点击
    const r = _dom.getBoundingClientRect();
    _ndc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -(((e.clientY - r.top) / r.height) * 2 - 1)
    );
    _ray.setFromCamera(_ndc, camera);

    // ① 先判灯笼（小目标，单独一组）
    if (typeof lanternGroups !== 'undefined' && lanternGroups.length) {
      const lh = _ray.intersectObjects(lanternGroups, true);
      if (lh.length) { toggleLanterns(); return; }
    }

    // ② 再判树冠：用一个数学球体包住树冠，比逐面拾取稳定得多
    const canopy = new T.Sphere(new T.Vector3(TREE.x, 5.8, TREE.z), 3.6);
    if (_ray.ray.intersectsSphere(canopy)) { triggerPetalBurst(); return; }
  });

  /* ---------- 19. 自适应 ---------- */
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    post.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  /* ---------- 20. 主循环 ---------- */
  const clock = new T.Clock();
  let elapsed = 0;
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    updateWind(elapsed);              // 统一风场（决定下面所有摆动）

    blossomUniforms.uTime.value = elapsed;
    grassUniforms.uTime.value = elapsed;
    waterUniforms.uTime.value = elapsed;
    skyUniforms.uTime.value = elapsed;
    if (typeof shaftUniforms !== 'undefined') shaftUniforms.uTime.value = elapsed;
    if (typeof updateBeams === 'function') updateBeams();
    updateSpray(elapsed, dt);
    updateFireflies(elapsed, dt);
    updateDust(elapsed);
    updateCreatures(elapsed, dt);
    updatePetalBurst(dt);
    updateRibbon(elapsed, dt);
    petalUniforms.uTime.value = elapsed;

    updateIntro();
    updateWeather(dt);
    updatePetals(elapsed, dt);

    // 小动物轻微呼吸/摇头
    for (const a of animals) {
      a.obj.position.y = a.baseY + Math.sin(elapsed * 1.6 + a.ph) * a.amp;
      a.obj.rotation.y += Math.sin(elapsed * 0.7 + a.ph) * 0.0012;
    }

    if (controls.enabled) {
      controls.autoRotate = state.autoRotate;
      controls.update();
    }

    // ---- 太阳在屏幕上的位置（用于逆光星芒） ----
    // 花瓣 SSS 用的太阳方向
    blossomUniforms.uSunDir.value.copy(skyUniforms.uSunDir.value);



    // ---- 丁达尔光束：太阳屏幕位置 ----
    {
      const sunFar = camera.position.clone().addScaledVector(skyUniforms.uSunDir.value, 400);
      const sp = sunFar.project(camera);
      post.uniforms.uSunScreen.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
      // 太阳只要在画面内就出光束（之前的方向点积判断有误，会把光束整个关掉）
      const facing = true;
      const inView = sp.z < 1 && Math.abs(sp.x) < 1.2 && Math.abs(sp.y) < 1.2;
      const wet = Math.max(weather.rainAmt, weather.snowAmt);
      // 黄昏最强，正午较弱
      const strength = (skyUniforms.uSunset.value * 1.55 + 0.22);
      post.uniforms.uSunStr.value = (facing && inView) ? strength * (1 - wet * 0.9) : 0;
    }

    post.render(dt);

    /* ---- 自适应质量：每 1.8 秒统计一次帧率，连续偏低就降一档 ---- */
    if (QUALITY.auto) {
      QUALITY._accT += dt;
      QUALITY._accN += 1;
      QUALITY._window += dt;
      if (QUALITY._window >= 1.8) {
        const fps = QUALITY._accN / Math.max(QUALITY._accT, 1e-3);
        QUALITY._accT = 0; QUALITY._accN = 0; QUALITY._window = 0;
        if (fps < 40 && QUALITY.tier > 0) {
          QUALITY._lowStreak++;
          if (QUALITY._lowStreak >= 2) {
            QUALITY.tier--;
            applyQuality();
            QUALITY._lowStreak = 0;
          }
        } else {
          QUALITY._lowStreak = 0;
        }
      }
    }

    if (window.__DIORAMA_READY__ === undefined) window.__DIORAMA_READY__ = true;
  }

  // 调试：直接跳到最终机位
  if (location.hash.indexOf('snap') >= 0) {
    introT = INTRO_DUR;
    camera.copy(camera);
    controls.enabled = true;
    applyFitView();
    post.uniforms.uFade.value = 1;
    const ld = document.getElementById('loader');
    if (ld) ld.classList.add('done');
    window.__DIORAMA_READY__ = true;
  }

  PROG(92, '编译着色器');
  await yieldFrame();
  renderer.compile(scene, camera);

  applyQuality();                    // 应用当前质量档（默认高）

  const TOUR_MODE = location.hash.indexOf('tour') >= 0;
  let tourCaptionEl = null;
  if (TOUR_MODE) {
    introT = INTRO_DUR;
    controls.enabled = true;
    applyFitView();
    post.uniforms.uFade.value = 1;
    const ld = document.getElementById('loader');
    if (ld) ld.classList.add('done');
    QUALITY.auto = false;
    setQualityTier(2); // 录制视频固定最高画质

    // 宣传片右上角精致毛玻璃特性导览角标
    tourCaptionEl = document.createElement('div');
    tourCaptionEl.style.cssText = [
      'position:fixed', 'top:26px', 'right:32px', 'z-index:30',
      'padding:10px 18px', 'border-radius:999px',
      'background:rgba(28,18,26,0.52)', 'backdrop-filter:blur(12px)',
      'border:1px solid rgba(255,216,230,0.32)',
      'color:#fff5f8', 'font:500 13px/1.4 "PingFang SC","Microsoft YaHei",sans-serif',
      'letter-spacing:0.06em', 'box-shadow:0 8px 28px rgba(0,0,0,0.28)',
      'pointer-events:none', 'transition:opacity 0.25s ease'
    ].join(';');
    document.body.appendChild(tourCaptionEl);
  }

  // 确定性逐帧步进：供宣传片录制脚本按帧号 i / total 精确驱动全场景动画、镜头与特效
  window.__TOUR_SEEK__ = function (i, total) {
    const N = Math.max(2, total || 300);
    const u = clamp(i / (N - 1), 0, 1);
    const dt = 1 / 25;
    elapsed = i * dt + 4.0;
    introT = INTRO_DUR;
    post.uniforms.uFade.value = 1;

    // 四幕产品亮点编排
    let capText = '';
    if (u < 0.28) {
      if (state.time !== 'dusk') applyTime('dusk');
      if (state.weather !== 'sunny') setWeather('sunny');
      ribbon.on = false;
      ribbon.hover = false;
      capText = '01 · 巨冠垂枝樱 × 翻涌花瓣海 × 3D 飞鸟群';
    } else if (u < 0.56) {
      const wantT = u < 0.41 ? 'dusk' : 'afternoon';
      if (state.time !== wantT) applyTime(wantT);
      if (state.weather !== 'sunny') setWeather('sunny');
      ribbon.on = false;
      ribbon.hover = false;
      capText = '02 · 抓地盘根 × 成簇立体春草 × 厚木倒角长椅 × 樱饼野餐';
    } else if (u < 0.78) {
      if (state.time !== 'morning') applyTime('morning');
      if (state.weather !== 'sunny') setWeather('sunny');
      if (i === Math.floor(N * 0.57) || i === Math.floor(N * 0.66)) {
        triggerPetalBurst();
      }
      ribbon.on = true;
      ribbon.hover = true;
      const ru = (u - 0.56) / 0.22;
      const rAng = ru * TAU * 1.35;
      ribbon.ndc.set(Math.cos(rAng) * 0.42, Math.sin(rAng * 2.0) * 0.24 + 0.04);
      capText = '03 · 3D 绸缎丝带穿林 × 点树摇落花雨 × 晨昏晴雨实时切换';
    } else {
      const wantNight = u < 0.91;
      const tMode = wantNight ? 'night' : 'dusk';
      if (state.time !== tMode) applyTime(tMode);
      ribbon.on = false;
      ribbon.hover = false;
      fireflyAmt = wantNight ? 1.0 : 0.0;
      capText = wantNight
        ? '04 · 静谧星夜 · 八盏和纸提灯暖光 × 260 只流萤绕树飞舞'
        : '樱花树下 · Sakura Isle · 单文件离线 3D 微缩世界';
    }
    if (tourCaptionEl) tourCaptionEl.textContent = capText;
    const btnR = document.getElementById('btnRibbon');
    if (btnR) btnR.classList.toggle('on', ribbon.on);

    // 电影感平滑运镜轨迹（全景大远景 -> 树下长椅/盘根/野餐微距特写 -> 丝带飞舞中景 -> 星夜与黄昏全景主视觉收束）
    const smoothU = (a, b, x) => smoothstep(a, b, x);
    let angle, rad, camY, tgtX, tgtY, tgtZ;
    if (u < 0.28) {
      const k = smoothU(0.0, 0.28, u);
      angle = lerp(0.26, -0.14, k);
      rad   = lerp(18.80, 16.50, k);
      camY  = lerp(1.55, 1.45, k);
      tgtX  = lerp(0.12, -0.05, k);
      tgtY  = lerp(4.35, 3.95, k);
      tgtZ  = 0.0;
    } else if (u < 0.56) {
      const k = smoothU(0.28, 0.56, u);
      const arch = Math.sin(k * Math.PI);
      angle = lerp(-0.14, 0.34, k);
      rad   = lerp(16.50, 6.45, arch);
      camY  = lerp(1.45, 1.38, arch);
      tgtX  = lerp(-0.05, 0.18, k);
      tgtY  = lerp(3.95, 1.08, arch);
      tgtZ  = lerp(0.0, 0.45, arch);
    } else if (u < 0.78) {
      const k = smoothU(0.56, 0.78, u);
      angle = lerp(0.34, -0.24, k);
      rad   = lerp(9.20, 13.80, k);
      camY  = lerp(1.75, 1.65, k);
      tgtX  = lerp(0.15, 0.0, k);
      tgtY  = lerp(2.35, 3.65, k);
      tgtZ  = lerp(0.20, 0.0, k);
    } else {
      const k = smoothU(0.78, 1.0, u);
      angle = lerp(-0.24, 0.038, k);
      rad   = lerp(13.80, 18.60, k);
      camY  = lerp(1.65, 1.32, k);
      tgtX  = 0.0;
      tgtY  = lerp(3.65, 4.35, k);
      tgtZ  = 0.0;
    }

    camera.position.set(Math.sin(angle) * rad, camY, Math.cos(angle) * rad);
    controls.target.set(tgtX, tgtY, tgtZ);
    camera.lookAt(tgtX, tgtY, tgtZ);
    camera.updateMatrixWorld();

    updateWind(elapsed);
    blossomUniforms.uTime.value = elapsed;
    grassUniforms.uTime.value = elapsed;
    waterUniforms.uTime.value = elapsed;
    skyUniforms.uTime.value = elapsed;
    if (typeof shaftUniforms !== 'undefined') shaftUniforms.uTime.value = elapsed;
    if (typeof updateBeams === 'function') updateBeams();
    updateSpray(elapsed, dt);
    updateFireflies(elapsed, dt);
    updateDust(elapsed);
    updateCreatures(elapsed, dt);
    updatePetalBurst(dt);
    updateRibbon(elapsed, dt);
    petalUniforms.uTime.value = elapsed;
    updateWeather(dt);
    updatePetals(elapsed, dt);
    blossomUniforms.uSunDir.value.copy(skyUniforms.uSunDir.value);
    post.render(dt);
    window.__TOUR_FRAME__ = i;
    return true;
  };

  INTRO_START = performance.now();   // 分帧构建会耗时，开场动画从真正开始时计时
  PROG(100, '就绪');
  window.__hideLoader && window.__hideLoader();
  window.__TOUR_READY__ = true;
  if (!TOUR_MODE) {
    animate();
  } else {
    window.__TOUR_SEEK__(0, 300);
  }

  window.__sakura = {
    setTime: applyTime,
    setWeather: setWeather,
    setCamera(px, py, pz, tx, ty, tz) {
      introT = INTRO_DUR;
      camera.position.set(px, py, pz);
      controls.target.set(tx || 0, ty || 1.25, tz || 0);
      controls.enabled = true;
      controls.update();
      post.uniforms.uFade.value = 1;
    },
    scene, camera, renderer, post, ribbon,
    setQuality(t) { QUALITY.auto = false; setQualityTier(t); },
    autoQuality(on) { QUALITY.auto = !!on; },
    qualityInfo() { return { tier: QUALITY.tier, name: QUALITY.tiers[QUALITY.tier].name, items: INST_REGISTRY.map(r => r.label + ':' + r.mesh.count + '/' + r.max) }; },
    stats() { return { blossoms: blossomSpots.length, triangles: renderer.info.render.triangles }; },
  };
})();
