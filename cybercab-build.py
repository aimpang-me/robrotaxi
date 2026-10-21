# Tesla Cybercab for the RobroTaxi 3D city. Profiles measured from Alvin's reference photos
# (side photo scaled to the published 4.445 m length, 1.753 m width, 1.407 m height).
import bpy, bmesh, math, sys
from mathutils import Vector
out = sys.argv[-1]
LEVEL = int(sys.argv[-2]) if sys.argv[-2].isdigit() else 2
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def lerp_table(t, x):
    if x <= t[0][0]: return t[0][1]
    for (x0, y0), (x1, y1) in zip(t, t[1:]):
        if x <= x1: return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return t[-1][1]

L2 = 2.2225
# top silhouette (centre line), from the side photo
TOP = [(-2.205, 0.940), (-1.956, 1.025), (-1.674, 1.115), (-1.391, 1.202), (-1.109, 1.284), (-0.685, 1.366), (-0.403, 1.393),
       (-0.12, 1.407), (0.162, 1.404), (0.445, 1.380), (0.586, 1.339), (0.727, 1.257), (0.869, 1.161), (1.010, 1.052),
       (1.179, 0.915), (1.292, 0.874), (1.575, 0.820), (1.857, 0.751), (2.027, 0.697), (2.14, 0.642), (2.215, 0.585)]
# shoulder crease height: level from tail to A-pillar, then follows the hood edge down to the nose
SHO = [(-2.205, 0.935), (-1.2, 0.950), (0.0, 0.955), (1.05, 0.955), (1.18, 0.935), (1.40, 0.875), (1.60, 0.815),
       (1.86, 0.745), (2.03, 0.690), (2.14, 0.635), (2.215, 0.580)]
# underside
BOT = [(-2.205, 0.30), (-1.95, 0.22), (-1.6, 0.17), (1.6, 0.16), (1.95, 0.22), (2.215, 0.30)]
# max half width in plan
HW = [(-2.205, 0.790), (-2.1, 0.825), (-1.8, 0.862), (-1.39, 0.876), (-1.0, 0.870), (0.0, 0.855), (1.0, 0.860),
      (1.41, 0.866), (1.7, 0.852), (2.0, 0.800), (2.14, 0.730), (2.215, 0.640)]
# roof-edge half width: narrow greenhouse, widening along the fastback to meet the tail corners
HR = [(-2.205, 0.760), (-1.8, 0.700), (-1.2, 0.610), (-0.6, 0.575), (0.4, 0.575), (0.9, 0.640), (1.18, 0.720), (1.4, 0.70), (2.215, 0.55)]
GLASS_X = (-1.12, 1.18)        # side glass span
WIND_X = (0.48, 1.18)          # windscreen span on the top bands
def belt(x):                   # bottom edge of the side glass; rises to the quarter-window tip
    return 0.965 if x > -0.55 else 0.965 + (lerp_table(TOP, -1.12) - 0.08 - 0.965) * (-0.55 - x) / 0.57

def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)
def mat(name, hexc, metal=0.0, rough=0.5, emit=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb(hexc), 1); b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    if emit: b.inputs['Emission Color'].default_value = (*srgb(emit), 1); b.inputs['Emission Strength'].default_value = 1.0
    return m
M = {
  'Body': mat('Body', '#c4a46a', 0.45, 0.42),        # matte champagne gold
  'Glass': mat('Glass', '#101215', 0.2, 0.10),
  'Trim': mat('Trim', '#1b1b1c', 0.0, 0.6),
  'Tire': mat('Tire', '#151515', 0.0, 0.85),
  'Cover': mat('Cover', '#c9a96e', 0.45, 0.35),
  'Lamp': mat('Lamp', '#f4f2ea', 0, 0.3, '#f4f2ea'),  # front RGB light bar: the demo colours it by car state
  'LightRear': mat('LightRear', '#e5574a', 0, 0.3, '#e5574a'),
}
MI = {'Body': 0, 'Glass': 1, 'Trim': 2}

ROCK = [(-2.205, 0.38), (-0.9, 0.37), (1.85, 0.27), (2.215, 0.27)]
def section(x):
    zb, zs, zt = lerp_table(BOT, x), lerp_table(SHO, x), lerp_table(TOP, x)
    hw, hr, zk = lerp_table(HW, x), lerp_table(HR, x), lerp_table(ROCK, x)
    hs = hw - 0.03
    half = [(0, zb), (hw - 0.10, zb), (hw - 0.03, zb + 0.06), (hw - 0.006, zk), (hw, zk + 0.35 * (zs - zk)), (hw - 0.012, zs - 0.12), (hs, zs)]
    if zt > zs + 0.03:   # cabin or fastback: narrow shoulder shelf, then tumblehome up to the roof edge
        hr = min(hr, hs - 0.08)
        shelf = (hs - 0.05, zs + 0.015)
        half += [shelf, (hr, max(zt - 0.035, shelf[1] + 0.01)), (hr * 0.5, zt - 0.008), (0, zt)]
    else:                # hood: gentle crown from the fender edge to the centre
        c = max(zt, zs) - zs
        half += [(hs * 0.86, zs + 0.004 + c * 0.35), (hs * 0.62, zs + 0.008 + c * 0.65), (hs * 0.32, zs + 0.012 + c * 0.9), (0, zs + 0.015 + c)]
    return half

XS = [-2.205] + [round(-2.10 + 0.12 * i, 3) for i in range(36)] + [2.215]
XS = sorted(set(x for x in XS if -2.205 <= x <= 2.215))
bm = bmesh.new()
crease = bm.edges.layers.float.new('crease_edge')
def ringpts(x, scale=1.0, dx=0.0, zc=None):
    half = section(x)
    if zc is None: zc = (half[0][1] + half[-1][1]) / 2
    pts = [(x, y, z) for y, z in half] + [(x, -y, z) for y, z in reversed(half[1:-1])]
    return [(px + dx, py * scale, zc + (pz - zc) * scale) for px, py, pz in pts]
rings = [[bm.verts.new(p) for p in ringpts(x)] for x in XS]
n = len(rings[0]); NH = len(section(0))
SHO_K = 6
def band(k): return k if k < NH - 1 else (2 * (NH - 1)) - k - 1
def paint(f, xm, kk, cap=None):
    mi = MI['Body']
    if kk <= 2: mi = MI['Trim']                                        # underbody and black lower band
    if (xm < -1.80 or cap == 'tail') and kk <= 3: mi = MI['Trim']      # tall black rear bumper
    if (xm > 2.0 or cap == 'nose') and kk <= 2: mi = MI['Trim']        # front lower lip
    if kk in (SHO_K + 2, SHO_K + 3) and WIND_X[0] < xm < WIND_X[1] and cap is None: mi = MI['Glass']
    f.material_index = mi
def bridge(a, b, xm, cap=None):
    for k in range(n):
        f = bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
        paint(f, xm, band(k), cap)
for i in range(len(rings) - 1):
    a, b = rings[i], rings[i + 1]
    bridge(a, b, (XS[i] + XS[i + 1]) / 2)
    for k in (SHO_K, n - SHO_K):
        e = bm.edges.get((a[k], b[k]));  e[crease] = 0.85
    for k in (SHO_K + 2, n - SHO_K - 2):
        e = bm.edges.get((a[k], b[k]));  e[crease] = 0.4
# end caps as nested rings, so the subdivided surface stays clean: a flat crisp tail and a blunt rounded nose
def cap(ring, x, steps, sign, rim, zc, kind):
    # nested rings shrink toward the paint break height, so the black/body boundary stays a level line
    prev = ring
    for i in range(n): bm.edges.get((ring[i], ring[(i + 1) % n]))[crease] = rim
    for sc, dx in steps:
        nxt = [bm.verts.new(p) for p in ringpts(x, sc, dx * sign, zc)]
        if sign < 0: bridge(nxt, prev, x, kind)
        else: bridge(prev, nxt, x, kind)
        prev = nxt
    c = bm.verts.new((x + steps[-1][1] * sign * 1.05, 0, zc))
    for k in range(n):
        tri = (prev[k], prev[(k + 1) % n], c) if sign > 0 else (prev[(k + 1) % n], prev[k], c)
        f = bm.faces.new(tri); paint(f, x, band(k), kind)
cap(rings[0], XS[0], [(0.94, 0.004), (0.75, 0.008), (0.45, 0.010)], -1, 0.95, section(XS[0])[4][1], 'tail')
cap(rings[-1], XS[-1], [(0.90, 0.020), (0.70, 0.034), (0.40, 0.040)], 1, 0.15, section(XS[-1])[3][1], 'nose')
bm.normal_update()
me = bpy.data.meshes.new('Body'); bm.to_mesh(me); bm.free()
body = bpy.data.objects.new('Body', me); scene.collection.objects.link(body)
for k in ['Body', 'Glass', 'Trim']: me.materials.append(M[k])
for p in me.polygons: p.use_smooth = True
bpy.context.view_layer.objects.active = body; body.select_set(True)
sub = body.modifiers.new('sub', 'SUBSURF'); sub.levels = LEVEL; bpy.ops.object.modifier_apply(modifier='sub')

AX = (1.41, -1.39); R = 0.375
for ax in AX:
    for side in (1, -1):
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.44, depth=0.7, location=(ax, side * 1.02, 0.395), rotation=(math.pi / 2, 0, 0))
        cut = bpy.context.active_object
        mod = body.modifiers.new('arch', 'BOOLEAN'); mod.object = cut; mod.operation = 'DIFFERENCE'; mod.solver = 'EXACT'
        bpy.context.view_layer.objects.active = body; bpy.ops.object.modifier_apply(modifier='arch')
        bpy.data.objects.remove(cut)
for p in body.data.polygons: p.use_smooth = True

def strip(name, m, pts, h):
    bmx = bmesh.new(); top = []; bot = []
    for p, nrm in pts:
        q = p + nrm * 0.012
        top.append(bmx.verts.new(q + Vector((0, 0, h / 2)))); bot.append(bmx.verts.new(q - Vector((0, 0, h / 2))))
    for i in range(len(pts) - 1): bmx.faces.new((bot[i], bot[i + 1], top[i + 1], top[i]))
    mx = bpy.data.meshes.new(name); bmx.to_mesh(mx); bmx.free()
    o = bpy.data.objects.new(name, mx); scene.collection.objects.link(o); mx.materials.append(M[m])
    mid = pts[len(pts) // 2]
    if mx.polygons[len(mx.polygons) // 2].normal.dot(mid[1]) < 0: mx.flip_normals()
    return o
def wrap(centre, z_of, angles, name, m, h):
    pts = []
    for a in angles:
        d = Vector((math.cos(a), math.sin(a), 0)); z = z_of(a)
        o = Vector((centre[0], centre[1], z)) + d * 4
        ok, loc, nrm, _ = body.ray_cast(o, -d)
        if ok: pts.append((loc, d.lerp(nrm, 0.5).normalized()))
    return strip(name, m, pts, h)
def win_top(x):
    if x > 0.586: return 1.325 + (0.94 - 1.325) * (x - 0.586) / (1.094 - 0.586)
    return lerp_table(TOP, x) - 0.065
def win_bot(x):
    return 0.965 if x > -0.54 else 0.965 + (1.236 - 0.965) * (-0.54 - x) / (1.137 - 0.54)
def window(side):
    bmx = bmesh.new(); X0, X1, NU, NV = -1.137, 1.094, 60, 8
    grid = []
    for i in range(NU + 1):
        x = X0 + (X1 - X0) * i / NU
        lo, hi = win_bot(x), max(win_top(x), win_bot(x))
        row = []
        for j in range(NV + 1):
            z = lo + (hi - lo) * j / NV
            ok, loc, nrm, _ = body.ray_cast(Vector((x, side * 2.0, z)), Vector((0, -side, 0)))
            if not ok: loc, nrm = Vector((x, side * 0.6, z)), Vector((0, side, 0))
            row.append(bmx.verts.new(loc + nrm * 0.006))
        grid.append(row)
    for i in range(NU):
        for j in range(NV):
            q = (grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1])
            bmx.faces.new(q if side < 0 else tuple(reversed(q)))
    bmesh.ops.remove_doubles(bmx, verts=bmx.verts, dist=0.0005)
    mx = bpy.data.meshes.new('Window'); bmx.to_mesh(mx); bmx.free()
    o = bpy.data.objects.new('Window', mx); scene.collection.objects.link(o); mx.materials.append(M['Glass'])
    for p in mx.polygons: p.use_smooth = True
    return o
wins = [window(1), window(-1)]
deg = math.radians
# front light bar along the hood edge, wrapping back over the front wheels
front = wrap((1.55, 0), lambda a: 0.585 + 0.06 * (abs(a) / deg(78)) ** 2, [deg(-78 + 156 * i / 40) for i in range(41)], 'Lamp', 'Lamp', 0.045)
# rear light bar under the tail lip, plus the lower corner lamps
rear = wrap((-1.6, 0), lambda a: 0.875, [deg(180 - 48 + 96 * i / 40) for i in range(41)], 'LightRear', 'LightRear', 0.05)
lip = wrap((-1.6, 0), lambda a: 0.918, [deg(180 - 48 + 96 * i / 40) for i in range(41)], 'Lip', 'Trim', 0.03)
corners = [wrap((-1.6, 0), lambda a: 0.50, [deg(180 + s * (32 + 14 * i / 8)) for i in range(9)], 'LowLamp%d' % j, 'LightRear', 0.035) for j, s in enumerate((1, -1))]
# wheels: tyre with a flat aero cover in body colour and a small centre boss
parts = []
for ax in AX:
    for side in (1, -1):
        bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=R, depth=0.245, location=(ax, side * 0.735, R), rotation=(math.pi / 2, 0, 0))
        t = bpy.context.active_object; t.data.materials.append(M['Tire'])
        b = t.modifiers.new('bv', 'BEVEL'); b.width = 0.045; b.segments = 3; bpy.context.view_layer.objects.active = t; bpy.ops.object.modifier_apply(modifier='bv')
        bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=R - 0.05, depth=0.03, location=(ax, side * 0.855, R), rotation=(math.pi / 2, 0, 0))
        c = bpy.context.active_object; c.data.materials.append(M['Cover'])
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=0.035, location=(ax, side * 0.868, R))
        h = bpy.context.active_object; h.data.materials.append(M['Cover'])
        parts += [t, c, h]
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]; bpy.ops.object.join(); parts[0].name = 'Wheels'
# merge the rear lamps and lip into one object to keep the node count small
bpy.ops.object.select_all(action='DESELECT')
for o in [rear, lip] + corners: o.select_set(True)
bpy.context.view_layer.objects.active = rear; bpy.ops.object.join(); rear.name = 'Rear'
bpy.ops.object.select_all(action='DESELECT')
for o in wins: o.select_set(True)
bpy.context.view_layer.objects.active = wins[0]; bpy.ops.object.join(); wins[0].name = 'Windows'
for o in bpy.data.objects: o.data.name = o.name
root = bpy.data.objects.new('Cybercab', None); scene.collection.objects.link(root)
for o in list(bpy.data.objects):
    if o is not root: o.parent = root
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True, export_texcoords=False, export_normals=True)
print('faces', sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'))
bpy.ops.wm.save_as_mainfile(filepath=out.replace('.glb', '.blend'))
