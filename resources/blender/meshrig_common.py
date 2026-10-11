"""Helpers shared by MeshRig's Blender scripts (save and heat weights)."""

import base64

import bpy
import numpy as np
from mathutils import Vector


def ensure_object_mode():
    if bpy.context.object is not None and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def make_active(obj):
    view_layer = bpy.context.view_layer
    if obj.name not in view_layer.objects:
        bpy.context.scene.collection.objects.link(obj)
    obj.hide_set(False)
    obj.hide_viewport = False
    view_layer.objects.active = obj


def build_bones(arm, bones):
    """
    Replaces every bone of `arm` with `bones` (world-space head/tail plus the
    world Z axis that fixes the roll). Leaves the armature in object mode.
    """
    ensure_object_mode()
    make_active(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for b in list(eb):
        eb.remove(b)
    inv = arm.matrix_world.inverted()
    rot = inv.to_3x3()
    made = {}
    for spec in bones:
        b = eb.new(spec["name"])
        b.head = inv @ Vector(spec["head"])
        b.tail = inv @ Vector(spec["tail"])
        if (b.tail - b.head).length < 1e-6:
            b.tail = b.head + Vector((0, 0, 0.01))
        z = spec.get("z")
        if z:
            b.align_roll(rot @ Vector(z))
        b.use_deform = bool(spec.get("deform", True))
        made[spec["name"]] = b
    for spec in bones:
        parent = spec.get("parent")
        if parent and parent in made:
            made[spec["name"]].parent = made[parent]
            made[spec["name"]].use_connect = bool(spec.get("connected"))
    bpy.ops.object.mode_set(mode="OBJECT")


def decode_weights(obj_payload, vertex_count):
    """(bone index [V*4], weight [V*4], bone names) from the base64 payload."""
    idx = np.frombuffer(base64.b64decode(obj_payload["index"]), dtype=np.uint16)
    w = np.frombuffer(base64.b64decode(obj_payload["weight"]), dtype=np.float32)
    if len(idx) != vertex_count * 4 or len(w) != vertex_count * 4:
        raise SystemExit(
            "MESHRIG_ERR weights for %s don't match its %d vertices; reopen the file"
            % (obj_payload["name"], vertex_count)
        )
    return idx, w, obj_payload["bones"]


def write_groups(obj, idx, w, bone_names, replace_names):
    """Writes skin weights as vertex groups, replacing groups named in `replace_names`."""
    for g in list(obj.vertex_groups):
        if g.name in replace_names:
            obj.vertex_groups.remove(g)
    verts = np.repeat(np.arange(len(idx) // 4), 4)
    live = (idx != 65535) & (w > 1e-4)
    for b, name in enumerate(bone_names):
        mask = live & (idx == b)
        if not mask.any():
            continue
        vg = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
        vs = verts[mask]
        ws = np.round(w[mask], 4)
        for value in np.unique(ws):
            sel = vs[ws == value]
            vg.add(sel.tolist(), float(value), "REPLACE")


def read_groups(obj, bone_names):
    """Top-4 normalized weights per vertex for groups named after `bone_names`."""
    me = obj.data
    V = len(me.vertices)
    index = {n: i for i, n in enumerate(bone_names)}
    group_bone = {g.index: index[g.name] for g in obj.vertex_groups if g.name in index}
    bi = np.full(V * 4, 65535, dtype=np.uint16)
    bw = np.zeros(V * 4, dtype=np.float32)
    if not group_bone:
        return bi, bw
    for v in me.vertices:
        inf = [(ge.weight, group_bone[ge.group]) for ge in v.groups if ge.group in group_bone and ge.weight > 0]
        if not inf:
            continue
        inf.sort(reverse=True)
        inf = inf[:4]
        total = sum(x for x, _ in inf) or 1.0
        for k, (x, b) in enumerate(inf):
            bi[v.index * 4 + k] = b
            bw[v.index * 4 + k] = x / total
    return bi, bw
