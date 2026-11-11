# -*- coding: utf-8 -*-
import io, sys, shutil, os

p = r"E:\AIGC\html\sakura\src\app_part2.js"
s = io.open(p, encoding="utf-8").read()
shutil.copyfile(p, p + ".bak_wind")

anchor = "    const barkMat = new T.MeshStandardMaterial({"
assert anchor in s

ins = r"""    // 统一树风场：枝干与花朵共用同一套位移场，花才会跟着枝条一起摆
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
        d.x = ( uWindDir.x * gk * 0.55 + s1 * 0.72 + s2 * 0.24 ) * 0.100 * wgt * uWind;
        d.z = ( uWindDir.y * gk * 0.55 + s1 * 0.48 - s2 * 0.22 ) * 0.084 * wgt * uWind;
        d.y = s1 * 0.016 * wgt * uWind;
        return d;
      }
    `;

"""
s = s.replace(anchor, ins + anchor, 1)

bark_old = "    if (barkNrm) { barkMat.normalScale.set(3.2, 3.2); barkMat.bumpScale = 0.09; }"
assert bark_old in s
bark_new = bark_old + r"""
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
    };"""
s = s.replace(bark_old, bark_new, 1)

u_old = "    uTime: { value: 0 },\n    uWind: { value: 1.20 },"
assert u_old in s, "uWind uniform anchor not found"
s = s.replace(u_old, "    uTime: TREE_WIND.uTime,\n    uWind: TREE_WIND.uWind,", 1)

vert_old = r"""        ` + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           vBUv = uv;
           vBRand = aRand;
           #ifdef USE_INSTANCING
             vec4 biO = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
             vec4 biW = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
           #else
             vec4 biO = modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
             vec4 biW = modelMatrix * vec4( transformed, 1.0 );
           #endif
           vBWPos = biW.xyz;
           // 垂枝末梢（低处）摆得更明显，树冠中等
           float hh = clamp( biO.y / 7.0, 0.0, 1.0 );
           float h = mix( 1.95, 0.70, hh );
           float s1 = sin( uTime * 1.25 + biO.x * 0.85 + biO.z * 0.70 );
           float s2 = sin( uTime * 2.30 + biO.y * 0.75 + aRand * 6.28 );
           // 统一风场：整体顺风倾斜 + 阵风颤动
           float gustK = 0.55 + uGust * 0.85;
           transformed.x += ( uWindDir.x * gustK * 0.240 + s1 * 0.175 + s2 * 0.080 ) * h * uWind;
           transformed.z += ( uWindDir.y * gustK * 0.240 + s1 * 0.110 - s2 * 0.095 ) * h * uWind;
           transformed.y += sin( uTime * 3.0 + biO.x * 1.6 + biO.z * 1.3 ) * 0.050 * h * uWind;
         }`
      );"""
assert vert_old in s, "vertex block anchor not found"

vert_new = r"""        ` + sh.vertexShader.replace(
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
      );"""
s = s.replace(vert_old, vert_new, 1)

hdr_old = """      sh.vertexShader = `
        uniform float uTime; uniform float uWind; uniform float uGust;
        uniform vec2 uWindDir;
        attribute float aRand;"""
assert hdr_old in s, "vertex header anchor not found"
hdr_new = """      sh.vertexShader = WIND_FIELD_GLSL + `
        attribute float aRand;"""
s = s.replace(hdr_old, hdr_new, 1)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("patched ok")
