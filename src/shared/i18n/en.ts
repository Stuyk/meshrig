/**
 * English text for the whole app. Other languages copy this file and
 * translate the values; keys stay the same. `{name}` is filled in by the app.
 * Objects with `one` / `other` are plural forms picked by `{count}`.
 */
export const en = {
  common: {
    appName: 'MeshRig',
    blender: 'Blender',
    cancel: 'Cancel',
    discard: 'Discard',
    done: 'Done',
    dismiss: 'Dismiss',
    closeEsc: 'Close (Esc)',
    delete: 'Delete',
    search: 'Search...',
    clearSearch: 'Clear search',
    noFileOpen: 'No file open',
    untitled: 'Untitled'
  },

  files: {
    blend: 'Blender File',
    blenderExecutable: 'Blender Executable',
    allFiles: 'All Files'
  },

  menu: {
    file: { label: 'File', title: 'Open and save' },
    edit: { label: 'Edit', title: 'Undo and skeleton actions' },
    view: { label: 'View', title: 'Camera and display' },
    open: 'Open .blend…',
    reload: 'Reload from disk',
    save: 'Save',
    saveTo: 'Save to {file}',
    saveAs: 'Save As…',
    showInFolder: 'Show in folder',
    undo: 'Undo',
    redo: 'Redo',
    deleteBone: 'Delete bone',
    join: 'Join selected pieces',
    symmetrize: 'Symmetrize left to right',
    autoIk: 'Add IK automatically',
    computeWeights: 'Compute weights',
    front: 'Front',
    back: 'Back',
    rightSide: 'Right',
    leftSide: 'Left',
    top: 'Top',
    bottom: 'Bottom',
    frameModel: 'Frame model',
    perspective: 'Perspective view',
    orthographic: 'Flat (orthographic) view',
    showNames: 'Show bone names',
    hideNames: 'Hide bone names'
  },

  start: {
    tagline: 'Rig any mesh in minutes. Saves a normal Blender armature.',
    open: 'Open a .blend',
    recent: 'Recent',
    lookingForBlender: 'Looking for Blender…',
    blenderFound: 'Using {version}',
    blenderMissing: 'Blender not found. MeshRig needs it to read and write .blend files.',
    change: 'Change',
    locate: 'Locate Blender…'
  },

  steps: {
    skeleton: {
      label: 'Skeleton',
      help: 'Pick a starting skeleton, then drag joints into place (1)'
    },
    parts: {
      label: 'Parts',
      help: 'Attach separate pieces to bones, or give each piece its own bone (2)'
    },
    skin: { label: 'Skin', help: 'Compute how the mesh follows the bones (3)' },
    test: { label: 'Test', help: 'Pose the rig and run a stress test to check the deformation (4)' }
  },

  busy: {
    reading: 'Reading {file} with Blender…',
    saving: 'Writing the rig into {file}…'
  },

  toast: {
    opened: 'Opened {file}: {objects}. Pick a starting skeleton on the right.',
    openedRig: 'Opened {file}: your MeshRig rig with {bones}.',
    openedArmature: 'Opened {file} with its armature ({bones}). Saving rebuilds that armature.',
    objects: { one: '1 object', other: '{count} objects' },
    bones: { one: '1 bone', other: '{count} bones' },
    mirrorModifier:
      'Mirror modifier on {objects}: rig one side with .L/.R names and Blender mirrors the weights.',
    noMesh: '{file} has no mesh objects to rig.',
    openFailed: 'Could not open {file}: {error}',
    saved: 'Saved the rig into {file}.',
    saveFailed: 'Save failed: {error}',
    backupMade: 'The previous version is in .meshrig-backups.',
    joined: 'Meshes joined into {object}.',
    connected: 'Connected to its parent.',
    disconnected: 'Disconnected: still follows its parent, the head moves freely.',
    notBlender: 'That is not a Blender executable.',
    usingBlender: 'Using {version}.',
    foundBlender: 'Found {version}.',
    noBlender: 'Blender was not found. Locate it by hand.'
  },

  hints: {
    select: 'Drag a joint to move it. Drag a bone to move it whole.',
    add: 'Click to add a bone from the selected one. Shift+click starts a bone that hangs off the selected bone without touching it (dotted line); then click its end.',
    chain: 'Draw along a tail, tentacle or rope to make a chain of bones.',
    bind: 'Select a bone, then click pieces to attach them to it. Shift+click selects pieces to join.',
    pose: 'Drag joints to pose. Orange joints drag IK.',
    weights: 'Click a joint to see what its bone moves.',
    paint: 'Drag on the mesh to paint the selected bone. Click a joint to switch bones.',
    snap: 'Joints snap inside the mesh; hold {key} to place them freely',
    orbit: 'Right-drag: orbit',
    pan: 'Shift+right-drag: pan',
    zoom: 'Wheel: zoom'
  },

  dialogs: {
    unsaved: {
      title: 'Unsaved changes',
      body: 'The rig for {file} has changes that are not saved.',
      save: 'Save'
    },
    diskChanged: {
      title: '{file} changed on disk',
      body: 'The file was saved somewhere else (maybe in Blender) after MeshRig opened it. Saving now writes your rig over that newer version; a backup of it is kept.',
      overwrite: 'Save anyway'
    },
    recovery: {
      title: 'Restore unsaved rig?',
      body: 'MeshRig closed with unsaved changes to {file}. Restore them?',
      restore: 'Restore'
    }
  },

  header: {
    undo: 'Undo (Ctrl+Z)',
    redo: 'Redo (Ctrl+Shift+Z)',
    frameModel: 'Frame model (F)',
    devConsole: 'Developer console',
    help: 'Quick guide & hotkeys (?)',
    preferences: 'Preferences',
    lighting: 'Lighting: {label}. {subtitle}',
    lightingPreset: 'Lighting Preset'
  },

  lighting: {
    neutral: { label: 'Neutral', subtitle: 'Balanced 3-point studio' },
    flat: { label: 'Flat', subtitle: 'Even light, soft shadows' },
    outdoor: { label: 'Outdoor', subtitle: 'Sunlight & sky fill' },
    warm: { label: 'Warm', subtitle: 'Tungsten & amber glow' },
    cool: { label: 'Cool', subtitle: 'Blue hour & cyan rim' }
  },

  snapping: {
    title: 'Snapping',
    label: 'Snap',
    inside: 'Inside the mesh',
    joints: 'To other joints',
    grid: 'To the grid',
    angle: 'Bone angle',
    auto: 'Auto ({size})',
    autoOrtho: 'Front/side/top views go flat',
    help: 'Hold Shift while dragging to place a joint without snapping. Hold Ctrl to switch snapping inside the mesh for one drag.'
  },

  tools: {
    withKey: '{label} ({key}): {help}',
    select: { label: 'Select & move', help: 'click bones, drag joints into place' },
    add: { label: 'Add bone', help: 'click on the mesh to extend the selected bone' },
    chain: { label: 'Draw chain', help: 'draw a stroke along a tail or tentacle' },
    bind: { label: 'Bind pieces', help: 'click mesh pieces to attach them to the selected bone' },
    symmetry: 'Symmetry (X): edit both sides at once',
    snapInside: 'Snap inside (S): joints go to the middle of the mesh under the cursor',
    names: 'Bone names (N)'
  },

  viewport: {
    navCube: 'Click a side to change the view. Drag to orbit.',
    navFaces: {
      right: 'RIGHT',
      left: 'LEFT',
      top: 'TOP',
      bottom: 'BOTTOM',
      front: 'FRONT',
      back: 'BACK'
    },
    modes: {
      rig: 'Rig',
      rigHelp: 'Edit the skeleton',
      weights: 'Weights',
      weightsHelp: 'See which bone moves which part of the mesh',
      pose: 'Pose',
      poseHelp: 'Pose the skinned rig to test it'
    },
    xray: 'X-ray',
    xrayHelp: 'How see-through the mesh is while editing bones',
    noWeights: 'No weights yet. Compute them in the Skin step.',
    attached: 'Pieces',
    attachedHelp:
      'Colour the model by which bone each piece is attached to (P). Hover or select a bone to see its pieces.',
    offParent: 'hangs off {bone}',
    newChain: 'new chain',
    persp: 'Perspective',
    ortho: 'Flat',
    orthoHelp:
      'Flat (orthographic) view: no perspective, so bones line up exactly. Numpad 5 or 5 switches.'
  },

  templates: {
    humanoid: {
      label: 'Humanoid',
      help: 'Two arms, two legs, spine, neck and head. Finds them on the model.'
    },
    quadruped: {
      label: 'Four legs',
      help: 'Spine, neck, head, tail and four legs. The model should face -Y.'
    },
    chain: {
      label: 'Chain',
      help: 'A chain through the middle of the model: snakes, tails, tentacles, ropes.'
    },
    single: { label: 'One bone', help: 'A single bone for props that move as one piece.' },
    empty: { label: 'Empty', help: 'Start with no bones and build your own.' }
  },

  skeleton: {
    start: 'Starting skeleton',
    startHelp:
      'Pick what the model is. MeshRig fits a skeleton to it, then you drag what it got wrong.',
    options: 'Options',
    spine: 'Spine bones',
    neck: 'Neck bones',
    tail: 'Tail bones',
    chain: 'Chain bones',
    fingers: 'Fingers',
    fingerModes: { none: 'None', simple: 'Mitten', full: 'Five' },
    root: 'Root bone',
    rootHelp: 'A bone on the ground that moves the whole rig',
    ik: 'IK on arms and legs',
    ikHelp: 'Pose hands and feet by dragging them; elbows and knees follow',
    refit: 'Fit {template} again',
    fitted: '{template}: {count} bones. Drag joints to adjust; Ctrl+Z undoes.',
    cleared: 'Skeleton cleared. Use the Add bone tool (E) to build one.',
    bones: 'Bones',
    autoIk: 'Auto IK',
    autoIkHelp: 'Adds IK to limbs that reach the ground, and to forearms and shins',
    autoIkDone: { one: 'Added 1 IK chain.', other: 'Added {count} IK chains.' },
    autoIkNone: 'No new limbs for IK found.',
    attachedCount: { one: '1 piece attached', other: '{count} pieces attached' },
    symmetrize: 'Mirror L → R',
    symmetrizeHelp: 'Copies every left (.L) bone to the right side',
    clear: 'Clear',
    empty:
      'No bones yet. Pick a starting skeleton above, or draw bones with the Add bone (E) and Chain (C) tools.'
  },

  inspector: {
    title: 'Bone',
    nameHelp: 'Bone name. End it in .L or .R for a side; symmetry uses that.',
    role: 'Kind',
    parent: 'Parent',
    noParent: '(none)',
    connected: 'Connected',
    connectedHelp:
      'Head sits on the parent’s tail. Off: it still follows the parent but can sit anywhere (the dotted line). D switches.',
    deform: 'Deforms mesh',
    deformHelp: 'Off for helper bones that shouldn’t move the mesh',
    ik: 'IK',
    ikHelp: 'Drag this bone’s end to pose the chain above it',
    chain: 'Chain',
    chainBones: { one: '1 bone', other: '{count} bones' },
    pole: 'Bends toward',
    follow: 'Child follows target',
    followHelp: 'The hand or foot takes its rotation from the IK control',
    advanced: 'Advanced',
    roll: 'Roll',
    rollHelp: 'Extra twist around the bone, on top of the automatic roll',
    autoRoll: 'Use automatic roll',
    autoRollHelp:
      'This bone keeps the roll it had in the file. Switch to MeshRig’s automatic roll.',
    center: 'Center in mesh',
    centerHelp: 'Moves the joints to the middle of the mesh around them',
    frame: 'Frame',
    attached: { one: '1 attached piece', other: '{count} attached pieces' },
    noneAttached:
      'No pieces attached. In the Parts step, click pieces to attach them to this bone.',
    selectAttached: 'Select',
    detachAll: 'Detach all',
    detach: 'Detach (skin it normally)',
    deleteBranch: 'Delete branch',
    deleteBranchHelp: 'Deletes this bone and every bone under it'
  },

  roles: {
    root: 'Root',
    hips: 'Hips',
    spine: 'Spine',
    chest: 'Chest',
    neck: 'Neck',
    head: 'Head',
    jaw: 'Jaw',
    shoulder: 'Shoulder',
    arm: 'Upper arm',
    forearm: 'Forearm',
    hand: 'Hand',
    finger: 'Finger',
    thigh: 'Thigh',
    shin: 'Shin',
    foot: 'Foot',
    toe: 'Toe',
    tail: 'Tail / chain',
    wing: 'Wing',
    part: 'Part',
    // Not `other`: an object with an `other` key reads as plural forms.
    generic: 'Other'
  },

  poles: {
    auto: 'Automatic',
    forward: 'Forward (−Y)',
    back: 'Back (+Y)',
    up: 'Up',
    down: 'Down',
    left: 'Left (+X)',
    right: 'Right (−X)',
    none: 'No pole'
  },

  parts: {
    title: 'Pieces',
    help: 'Models made of separate pieces (armor, props, robot parts) rig fastest when each piece follows one bone rigidly. Pieces left on Auto are skinned smoothly.',
    bonePerObject: 'Bone per object',
    bonePerObjectHelp:
      'Adds a bone for every object, chained by which pieces touch, and binds each object to its bone',
    bonePerPiece: 'Bone per piece',
    bonePerPieceHelp: 'Same, but for every loose piece inside the objects too',
    bonesMade: {
      one: 'Added 1 bone and bound its piece.',
      other: 'Added {count} bones and bound their pieces.'
    },
    pickBone:
      'Select a bone (in the viewport or the Skeleton step), then click pieces to attach them to it.',
    clickToBind: 'Click pieces to attach them to {bone}. Click again to release.',
    objects: 'Objects',
    include: 'Include in the rig',
    exclude: 'Leave out of the rig',
    stats: '{verts} vertices, {pieces} loose pieces',
    splitHelp: 'List the loose pieces of this object one by one',
    auto: 'Auto (skinned)',
    piece: 'Piece {n} · {verts} verts',
    more: '…and {count} more. Click them in the viewport.',
    pieceOf: '{object} · piece {n}',
    multiHint: 'Shift+click pieces (here or in the viewport) to select several and join them.',
    selected: { one: '1 piece selected', other: '{count} pieces selected' },
    clearSelection: 'Clear',
    join: 'Join {count} objects',
    weldOnly: 'Weld {object}',
    pickTwo: 'Select two or more objects to join',
    weld: 'Weld touching vertices',
    weldHelp: 'Merges vertices that sit on top of each other, so joined pieces bend as one surface',
    joinHelp:
      'Joins into the biggest object. Your .blend changes only when you save the rig; Ctrl+Z separates them again.',
    joined: { one: 'Joined into {target}.', other: 'Joined {count} objects into {target}.' },
    welded: { one: 'Welded 1 vertex.', other: 'Welded {count} vertices.' },
    joinFailed: 'Join failed: {error}'
  },

  skin: {
    title: 'Skin weights',
    methods: {
      auto: {
        label: 'Automatic',
        help: 'Measures distance through the volume. Works on messy meshes, clothes and loose pieces.'
      },
      heat: {
        label: 'Blender heat',
        help: 'Blender’s own Automatic Weights. Smooth on clean, closed meshes; gaps are filled automatically.'
      },
      rigid: {
        label: 'Rigid pieces',
        help: 'Every loose piece follows one bone completely. Best for robots and hard-surface models.'
      },
      nearest: {
        label: 'Nearest bone',
        help: 'Straight-line distance only. Fast, and fine for simple shapes.'
      }
    },
    quality: 'Quality',
    qualities: { fast: 'Fast', good: 'Good', best: 'Best' },
    advanced: 'Advanced',
    falloff: 'Falloff',
    falloffHelp: 'Higher keeps each bone’s influence tight around it; lower blends joints more',
    smoothing: 'Smoothing',
    smoothingHelp: 'Smoothing passes over the mesh after the weights are made',
    rigidSmall: 'Small pieces move rigidly',
    rigidSmallHelp:
      'Eyes, buttons and other small loose pieces follow one bone instead of stretching',
    influences: 'Bones per vertex',
    influencesHelp: 'Most game engines take up to 4',
    resolution: 'Voxel resolution',
    resolutionHelp:
      'Cells along the model’s longest side. Higher is slower but keeps close parts (fingers) apart.',
    compute: 'Compute weights',
    recompute: 'Recompute weights',
    statusNone: 'No weights yet.',
    statusStale: 'The skeleton changed since the weights were made.',
    statusFresh: 'Weights are up to date ({method}).',
    statusFile: 'Using the weights from the file.',
    viewHelp:
      'Select a bone to see its weights as a heat map; with none selected, every bone shows in its own color.',
    done: 'Weights computed ({method}).',
    heatFailed: 'Blender could not solve some bones; MeshRig filled those areas in.',
    unweighted: { one: '1 vertex has no bone.', other: '{count} vertices have no bone.' },
    noBones: 'Add some deforming bones first.',
    failed: 'Skinning failed: {error}',
    stages: {
      start: 'Starting…',
      heat: 'Blender is computing bone heat…',
      voxelising: 'Voxelising the model…',
      filling: 'Filling the inside…',
      distances: 'Measuring distances to bones…',
      weights: 'Making weights…',
      smoothing: 'Smoothing…',
      done: 'Done'
    }
  },

  paint: {
    title: 'Paint weights',
    on: 'Weight brush',
    onHelp: 'Drag on the mesh to change the selected bone\u2019s weights',
    modes: { add: 'Add', subtract: 'Subtract', smooth: 'Smooth' },
    radius: 'Radius',
    strength: 'Strength',
    stale: 'The skeleton changed since skinning. Recompute the weights before painting.',
    pickBone: 'Select a bone to paint (click its joint, or pick it in the Skeleton step).',
    help: 'With symmetry on, the other side is painted too. Ctrl+Z undoes a stroke. Recomputing the weights replaces what you painted.'
  },

  test: {
    title: 'Test the rig',
    help: 'Pose the rig to check how the mesh bends. Nothing you pose here is saved.',
    skinFirst: 'Compute weights to start testing',
    stale: 'Skeleton changed since skinning.',
    stress: 'Stress test',
    restart: 'Restart test',
    reset: 'Reset',
    tipDrag: 'Drag a joint to swing its bone.',
    tipIk: 'Orange joints are IK: drag a hand or foot and the limb follows.',
    tipRoot: 'Drag the root’s base to move the whole rig.',
    tipFix:
      'Something bends badly? Move the joint in the Skeleton step, or bind the piece in Parts, then recompute.'
  },

  save: {
    armature: 'Armature',
    join: 'Join meshes',
    joinHelp: 'Merge all rigged objects into one when saving',
    button: 'Save rig to .blend'
  },

  help: {
    title: 'MeshRig quick guide',
    workflow: 'How to rig',
    steps: {
      open: 'Open a .blend with your model. The model should stand on the ground facing -Y (Blender’s front).',
      skeleton:
        'Skeleton step: pick Humanoid, Four legs, Chain or One bone. MeshRig fits it to the model.',
      adjust:
        'Drag joints that are off. Symmetry edits both sides; joints snap to the middle of the mesh.',
      parts:
        'Parts step: for armor or mechanical pieces, select a bone and click the pieces it should carry.',
      skin: 'Skin step: compute weights. Select a bone to see what it moves.',
      test: 'Test step: drag hands and feet or run the stress test to find bad bends.',
      save: 'Save writes a normal armature, vertex groups and IK into the .blend, with a backup.'
    },
    hotkeys: 'Keys',
    keys: {
      select: 'Select & move tool',
      add: 'Add bone tool',
      addFree: 'Start a bone off the selected one, not touching it (Add tool)',
      connect: 'Connect / disconnect from parent',
      chain: 'Draw chain tool',
      bind: 'Bind pieces tool',
      symmetry: 'Symmetry on/off',
      snap: 'Snap inside mesh on/off',
      snapFlip: 'Flip snapping for one drag',
      names: 'Bone names',
      attached: 'Show which bone each piece is attached to',
      delete: 'Delete bone',
      escape: 'Cancel / deselect',
      steps: 'Go to step',
      views: 'Front / side / top view',
      ortho: 'Flat / perspective view',
      grid: 'Grid snapping',
      angle: 'Angle snapping',
      jointSnap: 'Snap to joints',
      noSnap: 'Drag without snapping',
      frame: 'Frame model or bone',
      multi: 'Select several pieces (Parts)',
      join: 'Join selected pieces',
      undo: 'Undo',
      save: 'Save',
      open: 'Open',
      orbit: 'Orbit',
      pan: 'Pan',
      zoom: 'Zoom'
    }
  },

  prefs: {
    title: 'Preferences',
    blender: 'Blender',
    locate: 'Locate Blender…',
    autoDetect: 'Detect again',
    blenderHelp:
      'MeshRig runs Blender in the background to read and write .blend files and for Blender heat weights. Tested with Blender 5.2.',
    display: 'Display',
    names: 'Always show bone names'
  },

  errors: {
    blenderNotFound: 'Blender not found. Use "Locate Blender…" to pick it.',
    blenderDidNotFinish: 'Blender did not finish',
    fileNotFound: 'File not found: {path}',
    fileDoesNotExist: 'File does not exist',
    unknownBlenderVersion: 'Blender (unknown version)',
    invalidBlender: 'Invalid Blender executable',
    notValidBlender: 'The selected file is not a valid Blender executable.'
  },

  main: {
    recoveryDetail:
      'Changes since the last autosave (every 60 seconds) may be lost. Reload to restore the autosave from the start screen.',
    notResponding: 'MeshRig is not responding.',
    maybeBusy: 'It may still be working on something heavy. {detail}',
    outOfMemory: 'MeshRig ran out of memory.',
    stopped: 'MeshRig stopped ({reason}).',
    gpuLost: 'The graphics context was lost.',
    gpuDetail: 'The GPU driver reset or ran out of memory. {detail}',
    wait: 'Wait',
    reload: 'Reload',
    quit: 'Quit',
    closeAnyway: 'Close Anyway',
    selectBlender: 'Select Blender Executable'
  }
}
