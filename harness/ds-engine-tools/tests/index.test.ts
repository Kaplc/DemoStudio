import { describe, expect, it, vi } from 'vitest'
import { name, inject, ALL_TOOLS } from '../src/index.js'

describe('ds-engine-tools 插件入口', () => {
  it('导出正确的插件名', () => {
    expect(name).toBe('@demostudio/ds-engine-tools')
  })

  it('声明 inject = ["tools"]', () => {
    expect(inject).toEqual(['tools'])
  })

  it('ALL_TOOLS 包含 9 个工具', () => {
    expect(ALL_TOOLS).toHaveLength(9)
  })

  it('每个工具都有 name/description/parameters/execute', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool).toHaveProperty('name')
      expect(tool).toHaveProperty('description')
      expect(tool).toHaveProperty('parameters')
      expect(tool).toHaveProperty('execute')
      expect(typeof tool.name).toBe('string')
      expect(typeof tool.description).toBe('string')
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('工具名列表正确', () => {
    const names = ALL_TOOLS.map(t => t.name).sort()
    expect(names).toEqual([
      'emit_ai_event',
      'get_assets',
      'get_hud',
      'get_scene_outline',
      'get_ui_outline',
      'key_press',
      'mouse_click',
      'mouse_drag',
      'mouse_move',
    ])
  })

  describe('apply 函数', () => {
    it('通过 effect 注册工具', async () => {
      const { apply } = await import('../src/index.js')
      const registered: unknown[] = []
      const ctx = {
        tools: { register: (tool: unknown) => registered.push(tool) },
        effect: (fn: () => void) => fn(),
      }
      apply(ctx)
      expect(registered).toHaveLength(9)
    })

    it('直接注册工具（无 effect）', async () => {
      const { apply } = await import('../src/index.js')
      const registered: unknown[] = []
      const ctx = {
        tools: { register: (tool: unknown) => registered.push(tool) },
      }
      apply(ctx)
      expect(registered).toHaveLength(9)
    })

    it('tools 为空时不注册', async () => {
      const { apply } = await import('../src/index.js')
      const ctx = {}
      // 不应抛错
      expect(() => apply(ctx)).not.toThrow()
    })
  })
})
