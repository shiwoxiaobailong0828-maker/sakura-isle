"""树皮材质预览：一根锥形树干 + HDRI 光照，Cycles GPU 渲染
用法: blender --background --python preview_bark.py -- <texdir> <outpng>
"""
import bpy, math, sys, os

argv = sys.argv
argv = argv[argv.index("--") + 1:] if "--" in argv else []
TEX = argv[0]
OUT = argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)

# 清场景
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

# 树干：锥形圆柱，加细分让法线贴图有几何
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.35, depth=2.2, location=(0, 0, 1.1))
trunk = bpy.context.object
# 锥度：上细下粗
me = trunk.data
for v in me.vertices:
    z = v.co.z + 1.1
    f = 0.62 + 0.38 * (1.0 - z / 2.2)
    v.co.x *= f; v.co.y *= f
# 平滑着色
for p in me.polygons:
    p.use_smooth = True

# 材质
mat = bpy.data.materials.new("Bark")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]

def load(name):
    p = os.path.join(TEX, name)
    img = bpy.data.images.load(p)
    if name.endswith("normal.png") or name.endswith("rough.png") or name.endswith("ao.png"):
        img.colorspace_settings.name = 'Non-Color'
    return img

alb = nt.nodes.new("ShaderNodeTexImage"); alb.image = load("bark_albedo.png")
nrm = nt.nodes.new("ShaderNodeTexImage"); nrm.image = load("bark_normal.png")
rgh = nt.nodes.new("ShaderNodeTexImage"); rgh.image = load("bark_rough.png")
aot = nt.nodes.new("ShaderNodeTexImage"); aot.image = load("bark_ao.png")

nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = 1.0
nt.links.new(nrm.outputs["Color"], nm.inputs["Color"])
nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
nt.links.new(alb.outputs["Color"], bsdf.inputs["Base Color"])
nt.links.new(rgh.outputs["Color"], bsdf.inputs["Roughness"])

def add_tile(tex_node, sx, sy):
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (sx, sy, 1.0)
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    nt.links.new(uv.outputs["UV"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], tex_node.inputs["Vector"])
    return mp
add_tile(alb, 3.0, 2.0)
add_tile(nrm, 3.0, 2.0)
add_tile(rgh, 3.0, 2.0)
add_tile(aot, 3.0, 2.0)
trunk.data.materials.append(mat)

# 相机
cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (1.9, -2.4, 1.55)
cam_data.lens = 60
bpy.context.scene.camera = cam
# 对准树干
tgt = bpy.data.objects.new("Tgt", None)
bpy.context.collection.objects.link(tgt)
tgt.location = (0, 0, 1.15)
con = cam.constraints.new('TRACK_TO')
con.target = tgt
con.track_axis = 'TRACK_NEGATIVE_Z'
con.up_axis = 'UP_Y'

# 世界：HDRI
world = bpy.data.worlds.new("W")
bpy.context.scene.world = world
world.use_nodes = True
wn = world.node_tree
bg = wn.nodes["Background"]
env = wn.nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(os.path.join(TEX, "sunset_hdri.jpg"))
wn.links.new(env.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 1.0

# 太阳
sun_data = bpy.data.lights.new("Sun", 'SUN')
sun_data.energy = 3.0
sun_data.color = (1.0, 0.85, 0.65)
sun = bpy.data.objects.new("Sun", sun_data)
bpy.context.collection.objects.link(sun)
sun.rotation_euler = (math.radians(62), 0, math.radians(35))

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'ONEAPI'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = 'GPU'
except Exception as e:
    print("GPU setup failed:", e)
    sc.cycles.device = 'CPU'
sc.cycles.samples = 256
sc.render.resolution_x = 700
sc.render.resolution_y = 900
sc.render.film_transparent = False
sc.render.filepath = OUT
sc.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print("PREVIEW DONE", OUT)
