"""
MeshRig: compute Blender's automatic (bone heat) weights for a skeleton.

Run as:  blender -b file.blend --python meshrig_heat.py -- <payload.json> <out_dir>

Nothing is saved. Builds a throwaway armature from the payload's deform bones,
parents the listed meshes with Automatic Weights, and writes the result as
weights_<i>.bin (same layout as meshrig_load.py) for each payload object, in
payload order. Some vertices may come back unweighted when Blender could
not find a solution (Blender prints "Bone Heat Weighting: failed"),
and the app fills those gaps itself.

Payload: {"bones": [...as meshrig_save.py...], "objects": ["Body", ...]}
"""

import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from meshrig_common import build_bones, ensure_object_mode, make_active, read_groups  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
payload_path, out_dir = argv[0], argv[1]
with open(payload_path) as f:
    payload = json.load(f)

ensure_object_mode()
scene = bpy.context.scene

bones = [b for b in payload["bones"] if b.get("deform", True)]
names = [b["name"] for b in bones]
# Parents outside the deform set would be dropped; that's fine for weights.
data = bpy.data.armatures.new("MeshRigHeat")
arm = bpy.data.objects.new("MeshRigHeat", data)
scene.collection.objects.link(arm)
build_bones(arm, bones)

objs = []
for name in payload["objects"]:
    o = bpy.data.objects.get(name)
    if o is None or o.type != "MESH":
        objs.append(None)
        continue
    # Weights from this run only: old groups and armature modifiers would mix in.
    for g in list(o.vertex_groups):
        if g.name in names:
            o.vertex_groups.remove(g)
    for m in list(o.modifiers):
        if m.type == "ARMATURE":
            o.modifiers.remove(m)
    o.parent = None
    objs.append(o)

live = [o for o in objs if o is not None]
for o in live:
    make_active(o)
bpy.ops.object.select_all(action="DESELECT")
for o in live:
    o.select_set(True)
arm.select_set(True)
make_active(arm)
bpy.ops.object.parent_set(type="ARMATURE_AUTO")

for i, o in enumerate(objs):
    if o is None:
        continue
    bi, bw = read_groups(o, names)
    with open(os.path.join(out_dir, "weights_%d.bin" % i), "wb") as f:
        f.write(bi.tobytes())
        f.write(bw.tobytes())

with open(os.path.join(out_dir, "bones.json"), "w") as f:
    json.dump(names, f)
print("MESHRIG_OK")
