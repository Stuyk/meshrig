# Changelog

## v0.2.0

### Placing bones

- Flat (orthographic) view: front, side and top views (Numpad 1/3/7) go flat automatically, with a grid in the view plane; orbiting returns to perspective. Numpad 5 (or 5) switches by hand, and the View menu and viewport bar have a Perspective/Flat button.
- Snapping menu in the viewport: snap to other joints (J), to the grid (G, automatic or fixed size) and to angle steps (A). Hold Shift while dragging to place freely.
- Bones that hang off a parent without touching it (disconnected children): Shift+click with Add bone, or press D on any bone to connect or disconnect it.
- Add bone preview: a ghost bone follows the cursor. Holding Shift shows a dashed start, the dotted link to the parent and a "hangs off …" badge.
- Relationship lines are drawn like Blender's: short dashes from a child's head to its parent's tail, blue when either bone is selected.
- The Bone panel says when a bone is mirrored with its twin, with a button to edit one side only.

### Parts

- Select several pieces (Shift+click, in the list or the viewport) and join them into one object (Ctrl+J), optionally welding touching vertices. Joins happen in a working copy until you save, and can be undone.
- Pieces view (P): colour every attached piece by its bone. Hover or select a bone and its pieces light up while the rest go dark.
- The bone list shows how many pieces each bone carries; the Bone panel lists them, with Select, Detach and Detach all.
- The Parts list has a colour dot per piece, a ✕ to detach it, and Detach all for the selected bone.
- Objects parented to a bone in Blender open as attached to that bone.
- The bone dropdown lists every bone; attaching a piece to a bone that doesn't deform switches it to deforming.

### Fixes

- The symmetry plane comes from the skeleton's left/right pairs (or x = 0), so a lopsided model no longer mirrors edits to the wrong place.
- Bones that don't deform show a tooltip explaining the gold icon.

### Other

- New app icon: the skeleton is drawn inside the figure's silhouette.

## v0.1.0

First release of MeshRig: fast rigging for meshes in `.blend` files. It is built on the shell of MeshAnimate (Blender bridge, viewport, interface), with the animation tools replaced by rigging.

### Skeleton

- Starting skeletons fitted to the model: Humanoid (optional mitten or five-finger hands), Four legs (with tail), Chain, One bone, and Empty. Spine, neck, tail and chain bone counts are adjustable.
- Joints snap to the middle of the mesh under the cursor. Ctrl places them freely.
- Symmetry: .L/.R bones are edited in pairs, and new off-centre bones get a mirrored twin.
- Add bone tool, Draw chain tool, bone tree, and a bone inspector (name, kind, parent, connected, deform, IK, roll).
- Auto IK, Mirror L → R, Center in mesh, Delete branch. Full undo and redo.

### Parts

- Bind objects or loose pieces rigidly to a bone by clicking them.
- Bone per object, or bone per loose piece, chained by which pieces touch.
- Leave objects out of the rig.

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
