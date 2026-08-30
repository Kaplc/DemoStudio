import { describe, expect, it } from 'vitest'
import { inspectSceneSchema } from '../src/tools/inspectScene.js'
import { spawnEntitySchema } from '../src/tools/spawnEntity.js'
import { runScenarioSchema } from '../src/tools/runScenario.js'
import { getGameStateSchema } from '../src/tools/getGameState.js'
import { setGameSpeedSchema } from '../src/tools/setGameSpeed.js'
import { cordisDefineRobustSchema } from '../src/tools/robustDefine.js'

describe('工具 schema 校验', () => {
  describe('inspectSceneSchema', () => {
    it('空对象合法（scenePath 可选）', () => {
      const result = inspectSceneSchema.safeParse({})
      expect(result.success).toBe(true)
    })

    it('带 scenePath 合法', () => {
      const result = inspectSceneSchema.safeParse({ scenePath: 'src/projects/eatfish/eatfish.scene.json' })
      expect(result.success).toBe(true)
      expect(result.data?.scenePath).toBe('src/projects/eatfish/eatfish.scene.json')
    })
  })

  describe('spawnEntitySchema', () => {
    it('空对象合法（字段均可选）', () => {
      const result = spawnEntitySchema.safeParse({})
      expect(result.success).toBe(true)
    })

    it('带 blueprint 合法', () => {
      const result = spawnEntitySchema.safeParse({ blueprint: 'asset/units/fish.unit.json' })
      expect(result.success).toBe(true)
    })

    it('带 baseClass 合法', () => {
      const result = spawnEntitySchema.safeParse({ baseClass: 'GenericActor' })
      expect(result.success).toBe(true)
    })

    it('带 position 三元组合法', () => {
      const result = spawnEntitySchema.safeParse({ position: [1, 2, 3] })
      expect(result.success).toBe(true)
    })

    it('position 二元组非法', () => {
      const result = spawnEntitySchema.safeParse({ position: [1, 2] })
      expect(result.success).toBe(false)
    })

    it('position 四元组非法', () => {
      const result = spawnEntitySchema.safeParse({ position: [1, 2, 3, 4] })
      expect(result.success).toBe(false)
    })
  })

  describe('runScenarioSchema', () => {
    it('空对象合法（有默认值）', () => {
      const result = runScenarioSchema.safeParse({})
      expect(result.success).toBe(true)
      expect(result.data?.durationMs).toBe(20_000)
      expect(result.data?.collectLogs).toBe(true)
    })

    it('自定义 durationMs', () => {
      const result = runScenarioSchema.safeParse({ durationMs: 5000 })
      expect(result.success).toBe(true)
      expect(result.data?.durationMs).toBe(5000)
    })

    it('durationMs 超出上限非法', () => {
      const result = runScenarioSchema.safeParse({ durationMs: 400_000 })
      expect(result.success).toBe(false)
    })

    it('durationMs 低于下限非法', () => {
      const result = runScenarioSchema.safeParse({ durationMs: 500 })
      expect(result.success).toBe(false)
    })

    it('durationMs 非整数非法', () => {
      const result = runScenarioSchema.safeParse({ durationMs: 1500.5 })
      expect(result.success).toBe(false)
    })
  })

  describe('getGameStateSchema', () => {
    it('空对象合法', () => {
      const result = getGameStateSchema.safeParse({})
      expect(result.success).toBe(true)
    })
  })

  describe('setGameSpeedSchema', () => {
    it('带 speed 合法', () => {
      const result = setGameSpeedSchema.safeParse({ speed: 2 })
      expect(result.success).toBe(true)
      expect(result.data?.speed).toBe(2)
    })

    it('speed=0 合法（暂停）', () => {
      const result = setGameSpeedSchema.safeParse({ speed: 0 })
      expect(result.success).toBe(true)
    })

    it('speed=10 合法（上限）', () => {
      const result = setGameSpeedSchema.safeParse({ speed: 10 })
      expect(result.success).toBe(true)
    })

    it('speed 超出上限非法', () => {
      const result = setGameSpeedSchema.safeParse({ speed: 11 })
      expect(result.success).toBe(false)
    })

    it('speed 为负数非法', () => {
      const result = setGameSpeedSchema.safeParse({ speed: -1 })
      expect(result.success).toBe(false)
    })

    it('带 durationMs 合法', () => {
      const result = setGameSpeedSchema.safeParse({ speed: 2, durationMs: 5000 })
      expect(result.success).toBe(true)
    })
  })

  describe('cordisDefineRobustSchema', () => {
    it('完整参数合法', () => {
      const result = cordisDefineRobustSchema.safeParse({
        pluginSpec: '{"kind":"new","idPrefix":"test"}',
        name: 'test-plugin',
        purpose: '测试插件',
      })
      expect(result.success).toBe(true)
    })

    it('带可选 hostCode/clientCode', () => {
      const result = cordisDefineRobustSchema.safeParse({
        pluginSpec: 'kind=new&idPrefix=test',
        name: 'test-plugin',
        purpose: '测试插件',
        hostCode: 'console.log("host")',
        clientCode: 'console.log("client")',
      })
      expect(result.success).toBe(true)
    })

    it('缺少必填字段非法', () => {
      const result = cordisDefineRobustSchema.safeParse({ pluginSpec: '{}' })
      expect(result.success).toBe(false)
    })
  })
})
