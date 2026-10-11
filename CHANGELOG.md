# Changelog

## v0.1.0

First release of MeshRig: fast rigging for meshes in `.blend` files. It is built on the shell of MeshAnimate (Blender bridge, viewport, interface), with the animation tools replaced by rigging.

### Skeleton
- Starting skeletons fitted to the model: Humanoid (optional mitten or five-finger hands), Four legs (with tail), Chain, One bone, and Empty. Spine, neck, tail and chain bone counts are adjustable.
- Joints snap to the middle of the mesh under the cursor. Ctrl places them freely.
- Symmetry: .L/.R bones are edited in pairs, and new off-centre bones get a mirrored twin.
- Add bone tool, Draw chain tool, bone tree, and a bone inspector (name, kind, parent, connected, deform, IK, roll).
- Flat (orthographic) views with a view-plane grid; front/side/top views go flat automatically and orbiting returns to perspective.
- Snapping to joints, to the grid (automatic or fixed size) and to angle steps; Shift+drag places freely.
- Auto IK, Mirror L → R, Center in mesh, Delete branch. Full undo and redo.

### Parts
- Bind objects or loose pieces rigidly to a bone by clicking them.
- Bone per object, or bone per loose piece, chained by which pieces touch.
- Leave objects out of the rig.
- Select several pieces (Shift+click) and join them into one object (Ctrl+J), optionally welding touching vertices. Joins happen in a working copy until you save, and can be undone.

### Skin
- Automatic weights (geodesic voxel binding), Blender bone heat with gap filling, Rigid pieces, and Nearest bone.
- Smoothing, falloff, voxel resolution and bones-per-vertex settings. Small loose pieces follow one bone.
- Weight heat map per bone, or all bones in their own colours.
- Weight brush: Add, Subtract, Smooth, mirrored with symmetry, undoable.

### Test
- Pose the skinned rig: swing bones, drag IK hands and feet, move the root.
- Stress test that bends every joint in turn.

### Save
- Writes one armature with Deform and Controls bone collections, vertex groups, Armature modifiers and parenting.
- IK targets and poles are generated, with the pole angle calibrated in Blender so the rest pose holds.
- Optional joining of all rigged meshes. Backups in `.meshrig-backups/`.
- MeshRig's skeleton is stored on the armature, so a rig reopens exactly as it was edited. Armatures made elsewhere can be opened and rebuilt.
