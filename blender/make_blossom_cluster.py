"""
樱花簇 alpha 贴图渲染（第 1 批 · 试验节点）
输出透明 PNG，供 Three.js 做花 Cards。
用法： blender --background --python make_blossom_cluster.py -- <out.png> [size] [samples]
"""
import bpy
import math
import random
import sys
from mathutils import Vector, Euler

argv = sys.argv
argv = argv[argv.index("--") + 1:] if "--" in argv else []
OUT = argv[0] if len(argv) > 0 else "E:/AIGC/html/sakura/textures/blossom_cluster.png"
SIZE = int(argv[1]) if len(argv) > 1 else 1024
SAMPLES = int(argv[2]) if len(argv) > 2 else 72

random.seed(20261110)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def new_material(name, rgb, rough=0.95):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    for key in ("Subsurface Weight", "Subsurface"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = 0.18
            break
    return m


MATS = [
    new_material("petal_light", (0.985, 0.870, 0.915)),
    new_material("petal_mid",   (0.965, 0.735, 0.825)),
    new_material("petal_deep",  (0.940, 0.610, 0.735)),
]
MAT_CENTER = new_material("center", (0.96, 0.88, 0.62), 0.75)


def make_petal(L=1.0, W=0.60, NU=16, NV=6, notch=0.13):
    """单片花瓣：圆润轮廓 + 尖端小缺口 + 杯状上翻（细分足够，便于平滑着色）"""
    verts, faces, rows = [], [], []
    for iu in range(NU + 1):
        u = iu / NU
        r = u * L
        halfW = W * math.pow(math.sin(math.pi * math.pow(u, 0.62)), 0.72) * (0.84 + 0.16 * u)
        if u > 0.84:
            halfW *= (1.0 - notch * ((u - 0.84) / 0.16) ** 1.5)
        row = []
        for iv in range(NV * 2 + 1):
            v = (iv / (NV * 2)) * 2 - 1
            x = halfW * v
            # 杯状：中心低、两侧翘；沿长度上翻
            y = 0.20 * (u ** 2.1) - 0.13 * (v * v) * math.sin(math.pi * u)
            row.append(len(verts))
            verts.append((x, y, r))
        rows.append(row)
    for iu in range(NU):
        for iv in range(NV * 2):
            a = rows[iu][iv]; b = rows[iu][iv + 1]
            c = rows[iu + 1][iv]; d = rows[iu + 1][iv + 1]
            faces.append((a, b, d, c))
    return verts, faces


PETAL_CACHE = [make_petal() for _ in range(3)]   # 三种尺寸复用


def add_mesh_obj(verts, faces, mat):
    me = bpy.data.meshes.new("petal")
    me.from_pydata(verts, [], faces)
    me.update()
    for poly in me.polygons:
        poly.use_smooth = True          # 平滑着色，去掉折纸感
    ob = bpy.data.objects.new("petal", me)
    ob.data.materials.append(mat)
    scene.collection.objects.link(ob)
    return ob


def make_blossom(center, scale, mat_index, tilt_dir):
    """一朵五瓣花：花瓣绕花心排布，花盘大体朝 tilt_dir 方向"""
    objs = []
    for k in range(5):
        verts, faces = PETAL_CACHE[0]
        ob = add_mesh_obj(verts, faces, MATS[mat_index])
        ob.scale = (scale, scale, scale)
        # 花瓣张开角 + 绕芯排布
        open_ang = math.radians(random.uniform(48, 60))
        ob.rotation_euler = Euler((open_ang, 0.0,
                                   k * (2 * math.pi / 5) + random.uniform(-0.07, 0.07)), 'XYZ')
        ob.location = center
        objs.append(ob)

    # 花蕊：一圈细小锥体
    for si in range(5):
        ang = si * (2 * math.pi / 9) + random.uniform(-0.1, 0.1)
        rr = 0.042 * scale
        bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=0.010 * scale,
                                        radius2=0.0, depth=0.065 * scale)
        st = bpy.context.object
        st.data.materials.append(MAT_CENTER)
        st.location = (center[0] + math.cos(ang) * rr,
                       center[1] + 0.015 * scale,
                       center[2] + math.sin(ang) * rr)
        st.rotation_euler = Euler((math.radians(random.uniform(8, 26)), 0.0, ang), 'XYZ')
        objs.append(st)

    # 整朵朝向：用空物体做父级旋转太麻烦，直接把花瓣对象组合旋转
    if tilt_dir is not None:
        from mathutils import Quaternion
        q = Vector((0, 0, 1)).rotation_difference(tilt_dir.normalized())
        for ob in objs:
            ob.location = center
            ob.rotation_mode = 'QUATERNION'
            ob.rotation_quaternion = q @ ob.rotation_quaternion if ob.rotation_mode == 'QUATERNION' else q
            # 用矩阵方式更稳：绕 center 旋转
    return objs


# ---- 直接用矩阵变换实现整体朝向（更可靠） ----
def blossom_transformed(center, scale, mat_index, normal_dir):
    from mathutils import Matrix, Quaternion
    objs = []
    q = Vector((0, 0, 1)).rotation_difference(normal_dir.normalized())
    M = Matrix.Translation(center) @ q.to_matrix().to_4x4() @ Matrix.Scale(scale, 4)

    for k in range(5):
        verts, faces = PETAL_CACHE[0]
        ob = add_mesh_obj(verts, faces, MATS[mat_index])
        open_ang = math.radians(random.uniform(46, 58))
        Re = Euler((open_ang, 0.0,
                    k * (2 * math.pi / 5) + random.uniform(-0.07, 0.07)), 'XYZ').to_matrix().to_4x4()
        ob.matrix_world = M @ Re
        objs.append(ob)

    for si in range(5):
        ang = si * (2 * math.pi / 9) + random.uniform(-0.1, 0.1)
        rr = 0.042
        bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=0.010, radius2=0.0, depth=0.065)
        st = bpy.context.object
        st.data.materials.append(MAT_CENTER)
        Rc = Euler((math.radians(random.uniform(10, 26)), 0.0, ang), 'XYZ').to_matrix().to_4x4()
        Tc = Matrix.Translation(Vector((math.cos(ang) * rr, 0.015, math.sin(ang) * rr)))
        st.matrix_world = M @ Tc @ Rc
        objs.append(st)
    return objs


# ---------------- 生成一簇花（球团状，紧实） ----------------
N_BLOSSOMS = 130
for i in range(N_BLOSSOMS):
    # 球内均匀分布（立方根），内部也要有花，避免空心
    while True:
        x, y, z = (random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))
        dd = math.sqrt(x * x + y * y + z * z)
        if 0.05 < dd <= 1.0:
            break
    nrm = Vector((x, y, z)).normalized()
    rr = (random.random() ** 0.42) * 0.96                 # 略偏外层，中心不空但轮廓饱满
    p = nrm * rr
    s = random.uniform(0.115, 0.195) * (1.05 - 0.18 * rr)   # 小而密 → 成一团花
    mat_i = random.choices([0, 1, 2], weights=[0.42, 0.38, 0.20])[0]
    blossom_transformed(p, s, mat_i, nrm)

# ---------------- 灯光 ----------------
def add_area(name, loc, rot, size, energy, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, 'AREA')
    d.shape = 'DISK'
    d.size = size
    d.energy = energy
    d.color = color
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = Euler(rot, 'XYZ')
    scene.collection.objects.link(o)


add_area("key", (-3.2, -4.2, 3.6), (math.radians(52), 0, math.radians(-37)), 7.0, 780, (1.0, 0.965, 0.94))
add_area("fill", (4.2, -3.0, 0.4), (math.radians(84), 0, math.radians(56)), 6.5, 240, (0.90, 0.94, 1.0))
add_area("rim", (0.6, 4.6, 2.4), (math.radians(-58), 0, math.radians(6)), 5.0, 520, (1.0, 0.90, 0.96))

world = bpy.data.worlds.new("W")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.06, 0.07, 0.10, 1.0)
bg.inputs[1].default_value = 0.55
scene.world = world

# ---------------- 相机 ----------------
cam_data = bpy.data.cameras.new("cam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.30
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (0.0, -6.0, 0.0)
cam.rotation_euler = Euler((math.radians(90), 0, 0), 'XYZ')
scene.collection.objects.link(cam)
scene.camera = cam

# ---------------- 渲染 ----------------
scene.render.engine = 'CYCLES'
try:
    scene.cycles.device = 'CPU'
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
except Exception as e:
    print("cycles warn:", e)

scene.render.film_transparent = True
scene.render.resolution_x = SIZE
scene.render.resolution_y = SIZE
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = OUT
try:
    scene.view_settings.view_transform = 'Standard'
except Exception:
    pass

bpy.ops.render.render(write_still=True)
print("RENDERED:", OUT)

# 存一份 .blend，方便在 GUI 里转着看
try:
    blend = OUT.rsplit(".", 1)[0] + ".blend"
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print("SAVED_BLEND:", blend)
except Exception as e:
    print("save blend warn:", e)
