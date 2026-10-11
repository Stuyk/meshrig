"""
MeshRig: write a rig into a .blend.

Run as:  blender -b file.blend --python meshrig_save.py -- <payload.json> <out.blend>

The caller has already backed up the target. Creates (or rebuilds) one
armature, writes skin weights as vertex groups, adds an Armature modifier,
parents the meshes, adds IK, and stores MeshRig's own spec on the armature so
the rig opens again exactly as it was edited.

Payload:
{
  "armature": {"name": "Armature", "existing": "Armature" | null},
  "bones": [{"name", "head": [x,y,z], "tail": [...], "z": [...], "parent", "connected", "deform", "control"}],
  "ik": [{"owner", "target", "pole" | null, "chain"}],
  "copyRotation": [{"owner", "target"}],
  "objects": [{"name", "bones": [names], "index": b64 uint16[V*4], "weight": b64 float32[V*4]}],
  "replaceGroups": [names of vertex groups this save owns],
  "join": null | "Body",
  "spec": "<json>"
}
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from meshrig_common import build_bones, decode_weights, ensure_object_mode, write_groups  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
payload_path, out_path = argv[0], argv[1]
with open(payload_path) as f:
    payload = json.load(f)

ensure_object_mode()
scene = bpy.context.scene

# --- armature -------------------------------------------------------------------

arm_spec = payload["armature"]
existing = bpy.data.objects.get(arm_spec.get("existing") or "")
old_bone_names = set()
if existing is not None and existing.type == "ARMATURE":
    arm = existing
    old_bone_names = {b.name for b in arm.data.bones}
    # Constraints on bones that are about to be rebuilt would point at nothing.
    for pb in arm.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
    arm.name = arm_spec["name"]
else:
    data = bpy.data.armatures.new(arm_spec["name"])
    arm = bpy.data.objects.new(arm_spec["name"], data)
    scene.collection.objects.link(arm)

arm.data.display_type = "OCTAHEDRAL"
arm.show_in_front = True
arm["meshrig"] = 1
arm.data["meshrig_spec"] = payload.get("spec") or ""

build_bones(arm, payload["bones"])

# Bone collections: deform bones apart from controls, so controls are easy to find.
try:
    colls = arm.data.collections
    for name in ("Deform", "Controls"):
        if colls.get(name) is None:
            colls.new(name)
    for spec in payload["bones"]:
        b = arm.data.bones[spec["name"]]
        if spec.get("control"):
            colls["Controls"].assign(b)
            b.color.palette = "THEME09"
        else:
            colls["Deform"].assign(b)
except Exception as e:  # noqa: BLE001 - cosmetic, older Blender
    print("MESHRIG_WARN bone collections: %s" % e)

# --- IK -----------------------------------------------------------------------------

pose = arm.pose
for spec in payload.get("copyRotation", []):
    c = pose.bones[spec["owner"]].constraints.new("COPY_ROTATION")
    c.name = "MeshRig Rotation"
    c.target = arm
    c.subtarget = spec["target"]

rest_tails = {pb.name: arm.matrix_world @ pb.bone.tail_local for pb in pose.bones}


def chain_of(owner, count):
    out = []
    pb = pose.bones[owner]
    while pb is not None and len(out) < count:
        out.append(pb)
        pb = pb.parent
    return out


def chain_error(chain):
    bpy.context.view_layer.update()
    mw = arm.matrix_world
    return sum((mw @ pb.tail - rest_tails[pb.name]).length for pb in chain)


for spec in payload.get("ik", []):
    pb = pose.bones[spec["owner"]]
    c = pb.constraints.new("IK")
    c.name = "MeshRig IK"
    c.target = arm
    c.subtarget = spec["target"]
    c.chain_count = int(spec.get("chain", 2))
    if spec.get("pole"):
        c.pole_target = arm
        c.pole_subtarget = spec["pole"]
        # The right pole angle depends on each bone's roll. Rather than derive
        # it, find the angle that leaves the chain at rest: coarse, then fine.
        chain = chain_of(spec["owner"], c.chain_count)
        best, best_err = 0.0, float("inf")
        for deg in range(-180, 180, 15):
            c.pole_angle = math.radians(deg)
            err = chain_error(chain)
            if err < best_err:
                best, best_err = deg, err
        for step in (3, 1, 0.25):
            centre = best
            for k in range(-5, 6):
                deg = centre + k * step
                c.pole_angle = math.radians(deg)
                err = chain_error(chain)
                if err < best_err:
                    best, best_err = deg, err
        c.pole_angle = math.radians(best)
        print("MESHRIG_POLE %s %.2f err=%.5f" % (spec["owner"], best, best_err))

# --- meshes -------------------------------------------------------------------------

replace = set(payload.get("replaceGroups", [])) | old_bone_names
bound = []
for op in payload.get("objects", []):
    obj = bpy.data.objects.get(op["name"])
    if obj is None or obj.type != "MESH":
        print("MESHRIG_WARN object not found: %s" % op["name"])
        continue
    idx, w, names = decode_weights(op, len(obj.data.vertices))
    write_groups(obj, idx, w, names, replace)

    mod = None
    for m in obj.modifiers:
        if m.type == "ARMATURE" and (m.object is None or m.object == arm or m.object == existing):
            mod = m
            break
    if mod is None:
        mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    mod.use_vertex_groups = True
    mod.use_bone_envelopes = False
    # Deform before Subdivision and friends, but after Mirror (which makes the
    # other half of the weights from .L/.R group names).
    mods = list(obj.modifiers)
    want = 0
    for i, m in enumerate(mods):
        if m.type == "MIRROR":
            want = i + 1
    have = mods.index(mod)
    if want > have:
        want -= 1
    if have != want:
        try:
            obj.modifiers.move(have, want)
        except Exception:  # noqa: BLE001 - very old API
            with bpy.context.temp_override(object=obj, active_object=obj):
                bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=want)

    # Parent to the armature, keeping where the mesh is. Meshes parented to
    # something else (another mesh, an empty) keep that parent.
    if obj.parent is None or obj.parent == arm or obj.parent.type == "ARMATURE":
        mw = obj.matrix_world.copy()
        obj.parent = arm
        obj.parent_type = "OBJECT"
        obj.matrix_world = mw
    bound.append(obj)

# --- join ------------------------------------------------------------------------------

join_name = payload.get("join")
if join_name and len(bound) > 1:
    target = bpy.data.objects.get(join_name) or bound[0]
    if target not in bound:
        target = bound[0]
    for o in bound:
        make_visible = o.name in bpy.context.view_layer.objects
        if not make_visible:
            scene.collection.objects.link(o)
        o.hide_set(False)
        o.hide_viewport = False
    with bpy.context.temp_override(
        active_object=target,
        object=target,
        selected_objects=bound,
        selected_editable_objects=bound,
    ):
        bpy.ops.object.join()
    print("MESHRIG_JOINED %s" % target.name)

bpy.ops.wm.save_as_mainfile(filepath=out_path, check_existing=False, copy=False)
print("MESHRIG_OK")
