# -*- coding: utf-8 -*-
import io, sys, os

P = r"E:\AIGC\html\sakura\src\app_part1.js"
s = io.open(P, encoding="utf-8").read()
orig = s


def rep(old, new, tag):
    global s
    if old not in s:
        print("MISS:", tag)
        sys.exit(1)
    s = s.replace(old, new, 1)
    print("ok:", tag)


# 1) 岛半径放大 + 土层变薄
rep("islandR: 4.15,      // 岛半径", "islandR: 5.20,      // 岛半径", "islandR")
rep("seatY: -0.92,       // 土层厚度（岛底）", "seatY: -0.58,       // 土层厚度（岛底）", "seatY")

# 2) 相机基准距离
rep("const BASE_DIST = CAM_END.distanceTo(VIEW_TARGET) * 1.62;",
    "const BASE_DIST = CAM_END.distanceTo(VIEW_TARGET) * 1.70;", "BASE_DIST")

# 3) 岛顶边缘露土过渡
rep("""        // 靠近边缘略深
        cTmp.multiplyScalar(lerp(1.0, 0.78, smoothstep(0.82, 1.0, t)));""",
    """        // 靠近边缘略深
        cTmp.multiplyScalar(lerp(1.0, 0.78, smoothstep(0.82, 1.0, t)));
        // 岛缘露土：草地到侧壁之间加一圈土色过渡
        cTmp.lerp(new T.Color(0.34, 0.25, 0.15), smoothstep(0.90, 1.0, t) * 0.60);""",
    "top-edge-soil")

# 4) 侧壁：轮廓起伏 + 侵蚀沟 + 纵向条纹
old_side = """    for (let ri = 0; ri <= SR; ri++) {
      const t = ri / SR;
      for (let si = 0; si < segs; si++) {
        const th = (si / segs) * TAU;
        const edge = 1 + 0.018 * fbm(Math.cos(th) * 2.2, 0.7, Math.sin(th) * 2.2, 2);
        // 侧面轻微内收，底部收圆
        const shrink = 1 - 0.10 * Math.pow(t, 1.6);
        const r = WORLD.islandR * edge * shrink;
        const x = Math.cos(th) * r, z = Math.sin(th) * r;
        const y = lerp(0.0, WORLD.seatY, Math.pow(t, 0.9));
        sidePos.push(x, y, z);

        const n = fbm(x * 1.4 + 10, y * 2.2, z * 1.4, 3);"""

new_side = """    for (let ri = 0; ri <= SR; ri++) {
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

        const n = fbm(x * 1.4 + 10, y * 2.2, z * 1.4, 3);"""

rep(old_side, new_side, "side-shape")

rep("""        cTmp.offsetHSL(0, 0, n * 0.045);
        sideCol.push(cTmp.r, cTmp.g, cTmp.b);""",
    """        // 纵向深浅条纹：泥土分层感
        const stripe = 0.5 + 0.5 * Math.sin(th * 26.0 + fbm(x * 2.0, 3.0, z * 2.0, 2) * 4.0);
        cTmp.multiplyScalar(0.80 + stripe * 0.32);
        cTmp.offsetHSL(0, 0, n * 0.045);
        sideCol.push(cTmp.r, cTmp.g, cTmp.b);""",
    "side-stripe")

# 5) 接地软阴影 + 岸边落花带（插在 buildIsland(); 之后）
old_call = """  buildIsland();

  PROG(22, '堆起小岛');"""
new_call = """  buildIsland();

  /* ---------- 6a. 岛下接地软阴影（水面不吃实时阴影，手贴一张径向渐变） ---------- */
  (function buildGroundShadow() {
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g2 = cv.getContext('2d');
    const grd = g2.createRadialGradient(S / 2, S / 2, S * 0.16, S / 2, S / 2, S * 0.50);
    grd.addColorStop(0.00, 'rgba(22,26,24,0.58)');
    grd.addColorStop(0.50, 'rgba(22,26,24,0.30)');
    grd.addColorStop(1.00, 'rgba(22,26,24,0.00)');
    g2.fillStyle = grd;
    g2.fillRect(0, 0, S, S);
    const tx = new T.CanvasTexture(cv);
    tx.colorSpace = T.SRGBColorSpace;
    const size = WORLD.islandR * 2.9;
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
    const N = 1600;
    const geo = makeSeaPetalGeo();
    const mat = new T.MeshStandardMaterial({
      color: 0xffd9e7,
      roughness: 0.92,
      metalness: 0.0,
      side: T.DoubleSide,
      emissive: 0xff9fc2,
      emissiveIntensity: 0.10,
    });
    const inst = new T.InstancedMesh(geo, mat, N);
    inst.frustumCulled = false;
    const dummy = new T.Object3D();
    for (let i = 0; i < N; i++) {
      // 越靠岛缘越密
      const rr = WORLD.islandR * 1.01 + Math.pow(R(), 1.75) * 1.55;
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

  PROG(22, '堆起小岛');"""
rep(old_call, new_call, "shadow+shore")

assert s != orig
io.open(P, "w", encoding="utf-8", newline="\n").write(s)
print("written", len(s))
