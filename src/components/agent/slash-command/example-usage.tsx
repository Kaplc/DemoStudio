/**
 * 斜杠命令系统使用示例
 * 
 * 展示如何在 DemoStudio 中使用斜杠命令功能
 */

import React, { useEffect } from 'react'
import { commandRegistry, registerBuiltinCommands, SlashMenu, useSlashCommand } from './index'
import type { SlashCommand } from './types'

// ═══════════════════════════════════════════════════════════════
// 示例 1：注册自定义命令
// ═══════════════════════════════════════════════════════════════

// 在应用启动时注册命令
const myCustomCommands: SlashCommand[] = [
  {
    name: 'create-actor',
    description: '创建新的 Actor',
    icon: '🎭',
    argumentHint: '<name>',
    handler: (args) => {
      console.log(`Creating actor: ${args}`)
      // 创建 Actor 的逻辑
    },
  },
  {
    name: 'add-component',
    description: '添加组件到选中对象',
    icon: '🧩',
    argumentHint: '<type>',
    handler: (args) => {
      console.log(`Adding component: ${args}`)
      // 添加组件的逻辑
    },
  },
  {
    name: 'set-position',
    description: '设置对象位置',
    icon: '📍',
    argumentHint: '<x> <y> <z>',
    handler: (args) => {
      const [x, y, z] = args?.split(' ').map(Number) ?? [0, 0, 0]
      console.log(`Setting position to: ${x}, ${y}, ${z}`)
      // 设置位置的逻辑
    },
  },
]

// 注册命令
commandRegistry.registerAll(myCustomCommands)


// ═══════════════════════════════════════════════════════════════
// 示例 2：在组件中使用斜杠命令
// ═══════════════════════════════════════════════════════════════

interface ChatInputProps {
  onSend: (text: string) => void
}

export const ChatInputExample: React.FC<ChatInputProps> = ({ onSend }) => {
  const inputRef = React.useRef<HTMLTextAreaElement>(null)

  const {
    isMenuOpen,
    hit,
    candidates,
    highlightIndex,
    handleInput,
    handleKeyDown,
    selectCommand,
    closeMenu,
    moveHighlight,
  } = useSlashCommand({
    inputRef,
    onCommand: (command, args) => {
      console.log(`Command executed: /${command.name}`, args)
      // 命令已经由各自的 handler 处理
    },
  })

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const caret = e.target.selectionStart ?? value.length
    handleInput(value, caret)
  }

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={inputRef}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        placeholder="输入 / 查看可用命令..."
      />
      <SlashMenu
        open={isMenuOpen}
        hit={hit}
        candidates={candidates}
        highlightIndex={highlightIndex}
        onSelect={selectCommand}
        onClose={closeMenu}
        onMove={moveHighlight}
      />
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════
// 示例 3：注册来自 DSH 的 skill 命令
// ═══════════════════════════════════════════════════════════════

// 模拟从 DSH 获取的 skill 列表
const dshSkills = [
  { name: 'skl-create-blueprint-asset', description: '创建蓝图资产' },
  { name: 'skl-create-config-asset', description: '创建配置表资产' },
  { name: 'skl-create-scene-asset', description: '创建场景资产' },
]

// 注册 skill 命令来源
commandRegistry.registerSource({
  name: 'dsh-skills',
  trigger: '/',
  order: 10,
  candidates: async (query) => {
    return dshSkills
      .filter(skill => skill.name.includes(query))
      .map(skill => ({
        name: skill.name,
        description: skill.description,
        icon: '🎯',
        handler: () => {
          console.log(`Loading skill: ${skill.name}`)
          // 加载 skill 的逻辑
        },
      }))
  },
})


// ═══════════════════════════════════════════════════════════════
// 示例 4：动态注册/注销命令
// ═══════════════════════════════════════════════════════════════

export const DynamicCommandsExample: React.FC = () => {
  useEffect(() => {
    // 动态注册一个命令
    const dispose = commandRegistry.register({
      name: 'dynamic-cmd',
      description: '这是一个动态注册的命令',
      icon: '⚡',
      handler: () => {
        console.log('Dynamic command executed!')
      },
    })

    // 组件卸载时注销命令
    return () => {
      dispose()
    }
  }, [])

  return <div>动态命令示例</div>
}


// ═══════════════════════════════════════════════════════════════
// 示例 5：监听命令注册变化
// ═══════════════════════════════════════════════════════════════

export const CommandListExample: React.FC = () => {
  const [commands, setCommands] = React.useState<SlashCommand[]>([])

  useEffect(() => {
    // 获取初始命令列表
    setCommands(commandRegistry.getAll())

    // 监听变化
    const unsubscribe = commandRegistry.subscribe(() => {
      setCommands(commandRegistry.getAll())
    })

    return unsubscribe
  }, [])

  return (
    <div>
      <h3>可用命令 ({commands.length})</h3>
      <ul>
        {commands.map(cmd => (
          <li key={cmd.name}>
            {cmd.icon} /{cmd.name} - {cmd.description}
          </li>
        ))}
      </ul>
    </div>
  )
}
