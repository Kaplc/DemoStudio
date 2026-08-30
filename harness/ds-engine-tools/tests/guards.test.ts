import { describe, expect, it } from 'vitest'
import { getDecision, requiresApproval, type GuardDecision } from '../src/guards.js'

describe('guards - 工具守卫策略', () => {
  describe('getDecision', () => {
    it('返回配置中指定的决策', () => {
      const policy = { inspect_scene: 'allow' as GuardDecision }
      expect(getDecision('inspect_scene', policy)).toBe('allow')
    })

    it('高危工具默认返回 ask（未配置时）', () => {
      expect(getDecision('spawn_entity')).toBe('ask')
      expect(getDecision('run_scenario')).toBe('ask')
      expect(getDecision('set_game_speed')).toBe('ask')
    })

    it('低危工具默认返回 allow（未配置时）', () => {
      expect(getDecision('inspect_scene')).toBe('allow')
      expect(getDecision('get_game_state')).toBe('allow')
    })

    it('配置可以覆盖默认值', () => {
      const policy = {
        spawn_entity: 'allow' as GuardDecision,
        inspect_scene: 'deny' as GuardDecision,
      }
      expect(getDecision('spawn_entity', policy)).toBe('allow')
      expect(getDecision('inspect_scene', policy)).toBe('deny')
    })

    it('未知工具名默认返回 allow', () => {
      expect(getDecision('unknown_tool')).toBe('allow')
    })

    it('空策略使用默认值', () => {
      expect(getDecision('spawn_entity', {})).toBe('ask')
      expect(getDecision('inspect_scene', {})).toBe('allow')
    })
  })

  describe('requiresApproval', () => {
    it('ask 决策需要用户确认', () => {
      expect(requiresApproval('spawn_entity')).toBe(true)
      expect(requiresApproval('run_scenario')).toBe(true)
      expect(requiresApproval('set_game_speed')).toBe(true)
    })

    it('allow 决策不需要用户确认', () => {
      expect(requiresApproval('inspect_scene')).toBe(false)
      expect(requiresApproval('get_game_state')).toBe(false)
    })

    it('配置为 allow 的高危工具不需要确认', () => {
      const policy = { spawn_entity: 'allow' as GuardDecision }
      expect(requiresApproval('spawn_entity', policy)).toBe(false)
    })

    it('配置为 deny 的工具不需要确认（deny 是直接拒绝，不是 ask）', () => {
      const policy = { spawn_entity: 'deny' as GuardDecision }
      expect(requiresApproval('spawn_entity', policy)).toBe(false)
    })

    it('配置为 ask 的低危工具需要确认', () => {
      const policy = { inspect_scene: 'ask' as GuardDecision }
      expect(requiresApproval('inspect_scene', policy)).toBe(true)
    })
  })
})
