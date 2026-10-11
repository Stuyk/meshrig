"""
MeshRig: join mesh objects into one, in a working copy of the .blend.

Run as:  blender -b file.blend --python meshrig_join.py -- <payload.json> <out.blend>

The source file is not changed; the result is saved to <out.blend>, which
MeshRig then rigs (and writes into the real file when you save).

Payload: {"objects": ["Body", "Arm"], "target": "Body", "weld": 0.0005}
  objects  meshes to join (two or more, or one to weld only)
  target   the object the others are joined into; it keeps its name
  weld     merge vertices closer than this (world units), 0 = no welding
"""

import json
import sys

import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
payload_path, out_path = argv[0], argv[1]
with open(payload_path) as f:
    payload = json.load(f)

if bpy.context.object is not None and bpy.context.object.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")

objs = [bpy.data.objects.get(n) for n in payload["objects"]]
objs = [o for o in objs if o is not None and o.type == "MESH"]
if not objs:
    raise SystemExit("MESHRIG_ERR none of the objects to join were found")
target = bpy.data.objects.get(payload.get("target") or "") or objs[0]
if target not in objs:
    target = objs[0]

scene = bpy.context.scene
for o in objs:
    if o.name not in bpy.context.view_layer.objects:
        scene.collection.objects.link(o)
    o.hide_set(False)
    o.hide_viewport = False

if len(objs) > 1:
    with bpy.context.temp_override(
        active_object=target,
        object=target,
        selected_objects=objs,
        selected_editable_objects=objs,
    ):
        bpy.ops.object.join()

weld = float(payload.get("weld") or 0)
merged = 0
if weld > 0:
    # Weld in world units: the object may be scaled.
    scale = max(target.matrix_world.to_scale()) or 1.0
    bm = bmesh.new()
    bm.from_mesh(target.data)
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld / scale)
    merged = before - len(bm.verts)
    bm.to_mesh(target.data)
    bm.free()
    target.data.update()

print("MESHRIG_JOINED %s %d" % (target.name, merged))
bpy.ops.wm.save_as_mainfile(filepath=out_path, check_existing=False, copy=True)
print("MESHRIG_OK")
