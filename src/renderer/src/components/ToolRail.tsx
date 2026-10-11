import { For, type JSX } from 'solid-js'
import { rig, type Tool } from '../rig/store'
import { BindIcon, BoneIcon, ChainIcon, MagnetIcon, MirrorIcon, SelectIcon, TagIcon } from './icons'
import { IconButton } from './ui'
import { t } from '../i18n'

const TOOLS: { value: Tool; key: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { value: 'select', key: 'Q', Icon: SelectIcon },
  { value: 'add', key: 'E', Icon: BoneIcon },
  { value: 'chain', key: 'C', Icon: ChainIcon },
  { value: 'bind', key: 'B', Icon: BindIcon }
]

/** Picks a tool, switching to the step it belongs to. */
export function chooseTool(tool: Tool): void {
  const panel = rig.panel()
  if (tool === 'bind' && panel !== 'parts') {
    rig.setPanel('parts')
  } else if (tool !== 'bind' && panel !== 'skeleton' && panel !== 'parts') {
    rig.setPanel('skeleton')
  }
  rig.setTool(tool)
  rig.setPendingHead(null)
}

export default function ToolRail(): JSX.Element {
  return (
    <div class="w-11 min-w-11 flex flex-col items-center gap-1.5 py-2 bg-[var(--bg-panel-header)] border-r border-[var(--border-color)]">
      <For each={TOOLS}>
        {(tool) => (
          <IconButton
            size="md"
            active={rig.view() !== 'pose' && rig.tool() === tool.value}
            tooltip={t('tools.withKey', {
              label: t(`tools.${tool.value}.label`),
              key: tool.key,
              help: t(`tools.${tool.value}.help`)
            })}
            shortcut={tool.key}
            onClick={() => chooseTool(tool.value)}
          >
            <tool.Icon size={17} />
          </IconButton>
        )}
      </For>
      <div class="w-6 h-px bg-[var(--border-color)] my-1" />
      <IconButton
        size="md"
        toggled={rig.symmetry()}
        tooltip={t('tools.symmetry')}
        shortcut="X"
        onClick={() => rig.setSymmetry(!rig.symmetry())}
      >
        <MirrorIcon size={17} />
      </IconButton>
      <IconButton
        size="md"
        toggled={rig.snapInside()}
        tooltip={t('tools.snapInside')}
        shortcut="S"
        onClick={() => rig.setSnapInside(!rig.snapInside())}
      >
        <MagnetIcon size={17} />
      </IconButton>
      <IconButton
        size="md"
        toggled={rig.showNames()}
        tooltip={t('tools.names')}
        shortcut="N"
        onClick={() => rig.setShowNames(!rig.showNames())}
      >
        <TagIcon size={17} />
      </IconButton>
    </div>
  )
}
