"""
MeshRig: read a .blend for rigging.

Run as:  blender -b file.blend --python meshrig_load.py -- <out_dir>

Writes, into <out_dir>:
  meta.json        objects, materials, any existing armature and its IK, the
                   saved MeshRig spec (if this file was rigged by MeshRig before)
  mesh_<i>.bin     raw geometry per mesh object, in world space, keeping
                   Blender's own vertex order so weights map back 1:1
  weights_<i>.bin  existing skin weights (top 4 per vertex), when there are any
  tex_<n>.png      base colour textures, for display only

Nothing is saved back to the .blend.

mesh_<i>.bin layout (little endian, each block 4-byte aligned, offsets in meta):
  positions  float32 [V*3]
  triangles  uint32  [T*3]   vertex indices
  triMat     uint32  [T]     material slot per triangle
  uvs        float32 [T*3*2] per corner (optional)
  normals    float32 [T*3*3] per corner, world space (optional)

weights_<i>.bin: uint16 bone index [V*4] (65535 = none), then float32 [V*4].
"""

import bpy
import json
import os
import sys

import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
out_dir = argv[0]
os.makedirs(out_dir, exist_ok=True)

scene = bpy.context.scene
warnings = []


def write_meta(meta):
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump(meta, f)


# --- armature ---------------------------------------------------------------

def mesh_users(arm):
    out = []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        if o.parent == arm or any(m.type == "ARMATURE" and m.object == arm for m in o.modifiers):
            out.append(o)
    return out


armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
arm = None
if armatures:
    # A MeshRig armature wins, then the one that drives geometry, then the biggest.
    arm = max(
        armatures,
        key=lambda a: (bool(a.get("meshrig")), len(mesh_users(a)) > 0, len(a.data.bones)),
    )


def vec(v):
    return [float(v[0]), float(v[1]), float(v[2])]


armature_meta = None
bone_index = {}
if arm is not None:
    mw = arm.matrix_world
    bones = []
    for i, b in enumerate(arm.data.bones):
        bone_index[b.name] = i
        ml = mw @ b.matrix_local
        bones.append({
            "name": b.name,
            "head": vec(mw @ b.head_local),
            "tail": vec(mw @ b.tail_local),
            # World Z axis of the bone: rebuilds the roll exactly.
            "z": vec(ml.col[2].to_3d().normalized()),
            "parent": b.parent.name if b.parent else None,
            "connected": bool(b.use_connect),
            "deform": bool(b.use_deform),
        })
    ik = []
    for pb in arm.pose.bones:
        for c in pb.constraints:
            if c.type == "IK" and c.target == arm and c.subtarget:
                ik.append({
                    "owner": pb.name,
                    "target": c.subtarget,
                    "pole": c.pole_subtarget if c.pole_target == arm and c.pole_subtarget else None,
                    "chain": int(c.chain_count),
                })
    spec = arm.data.get("meshrig_spec")
    armature_meta = {
        "name": arm.name,
        "bones": bones,
        "ik": ik,
        "spec": spec if isinstance(spec, str) else None,
    }


# --- materials and textures ---------------------------------------------------

texture_files = {}


def save_texture(img):
    """Writes an image as PNG for display; returns its file name or None."""
    if img is None:
        return None
    if img.name in texture_files:
        return texture_files[img.name]
    name = "tex_%d.png" % len(texture_files)
    path = os.path.join(out_dir, name)
    try:
        if img.size[0] == 0 or img.size[1] == 0:
            return None
        copy = img.copy()
        copy.filepath_raw = path
        copy.file_format = "PNG"
        copy.save()
        bpy.data.images.remove(copy)
    except Exception as e:  # noqa: BLE001 - display only, never fatal
        print("MESHRIG_WARN texture %s: %s" % (img.name, e))
        name = None
    texture_files[img.name] = name
    return name


def material_info(mat):
    if mat is None:
        return {"name": "", "color": [0.8, 0.8, 0.8, 1.0], "texture": None}
    color = list(mat.diffuse_color)
    texture = None
    if mat.use_nodes and mat.node_tree:
        for node in mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                inp = node.inputs.get("Base Color")
                if inp is None:
                    continue
                if inp.is_linked:
                    src = inp.links[0].from_node
                    if src.type == "TEX_IMAGE":
                        texture = save_texture(src.image)
                else:
                    color = list(inp.default_value)
                break
    return {"name": mat.name, "color": [float(c) for c in color], "texture": texture}


# --- meshes ---------------------------------------------------------------------

def align4(f):
    pad = (-f.tell()) % 4
    if pad:
        f.write(b"\0" * pad)


objects = []
view_layer = bpy.context.view_layer
mesh_objects = [o for o in scene.objects if o.type == "MESH"]
for idx, obj in enumerate(mesh_objects):
    me = obj.data
    V = len(me.vertices)
    if V == 0:
        continue
    me.calc_loop_triangles()
    T = len(me.loop_triangles)

    co = np.empty(V * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    mw = np.array(obj.matrix_world, dtype=np.float64)
    pts = co.reshape(-1, 3).astype(np.float64)
    world = (pts @ mw[:3, :3].T + mw[:3, 3]).astype(np.float32)

    tri_verts = np.empty(T * 3, dtype=np.uint32)
    me.loop_triangles.foreach_get("vertices", tri_verts)
    tri_loops = np.empty(T * 3, dtype=np.uint32)
    me.loop_triangles.foreach_get("loops", tri_loops)
    tri_mat = np.empty(T, dtype=np.uint32)
    me.loop_triangles.foreach_get("material_index", tri_mat)

    uvs = None
    if me.uv_layers.active is not None and len(me.loops) > 0:
        loop_uv = np.empty(len(me.loops) * 2, dtype=np.float32)
        me.uv_layers.active.data.foreach_get("uv", loop_uv)
        uvs = loop_uv.reshape(-1, 2)[tri_loops]

    normals = None
    try:
        cn = np.empty(len(me.loops) * 3, dtype=np.float32)
        me.corner_normals.foreach_get("vector", cn)
        nmat = np.array(obj.matrix_world.to_3x3().inverted_safe().transposed(), dtype=np.float64)
        n = cn.reshape(-1, 3)[tri_loops].astype(np.float64) @ nmat.T
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        normals = n.astype(np.float32)
    except Exception:  # noqa: BLE001 - older Blender: the app computes normals itself
        normals = None

    name = "mesh_%d.bin" % idx
    offsets = {}
    with open(os.path.join(out_dir, name), "wb") as f:
        offsets["positions"] = f.tell()
        f.write(world.tobytes())
        offsets["triangles"] = f.tell()
        f.write(tri_verts.tobytes())
        offsets["triMat"] = f.tell()
        f.write(tri_mat.tobytes())
        if uvs is not None:
            align4(f)
            offsets["uvs"] = f.tell()
            f.write(uvs.astype(np.float32).tobytes())
        if normals is not None:
            align4(f)
            offsets["normals"] = f.tell()
            f.write(normals.tobytes())

    # Existing weights, for groups that name a bone of the chosen armature.
    weights_file = None
    if arm is not None and obj.vertex_groups and bone_index:
        group_bone = {}
        for g in obj.vertex_groups:
            if g.name in bone_index:
                group_bone[g.index] = bone_index[g.name]
        if group_bone:
            bi = np.full(V * 4, 65535, dtype=np.uint16)
            bw = np.zeros(V * 4, dtype=np.float32)
            any_weight = False
            for v in me.vertices:
                inf = [(ge.weight, group_bone[ge.group]) for ge in v.groups if ge.group in group_bone and ge.weight > 0]
                if not inf:
                    continue
                any_weight = True
                inf.sort(reverse=True)
                inf = inf[:4]
                total = sum(w for w, _ in inf) or 1.0
                for k, (w, b) in enumerate(inf):
                    bi[v.index * 4 + k] = b
                    bw[v.index * 4 + k] = w / total
            if any_weight:
                weights_file = "weights_%d.bin" % idx
                with open(os.path.join(out_dir, weights_file), "wb") as f:
                    f.write(bi.tobytes())
                    f.write(bw.tobytes())

    mods = [m.type for m in obj.modifiers]
    if "MIRROR" in mods:
        warnings.append("mirror:" + obj.name)

    objects.append({
        "name": obj.name,
        "file": name,
        "vertexCount": V,
        "triangleCount": T,
        "offsets": offsets,
        "materials": [material_info(s.material) for s in obj.material_slots] or [material_info(None)],
        "modifiers": mods,
        "visible": bool(obj.visible_get(view_layer=view_layer)),
        "parent": obj.parent.name if obj.parent else None,
        "parentBone": obj.parent_bone if obj.parent_type == "BONE" else None,
        "weights": weights_file,
        "shapeKeys": bool(me.shape_keys),
    })

if not objects:
    write_meta({"error": "noMesh"})
    print("MESHRIG_OK")
    sys.exit(0)

write_meta({
    "version": 1,
    "blender": bpy.app.version_string,
    "unitScale": float(scene.unit_settings.scale_length),
    "objects": objects,
    "armature": armature_meta,
    "warnings": warnings,
})
print("MESHRIG_OK")
