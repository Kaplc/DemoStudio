import { describe, expect, it } from 'vitest'
import { CORRECTION_HINT_PATTERN, MAX_HINT_EXCERPTS, screenTranscript } from '../src/preScreen.js'
import { rulesSectionText } from '../src/ruleTypes.js'

describe('CORRECTION_HINT_PATTERN 预筛', () => {
  it('命中典型纠正表述', () => {
    for (const text of [
      '不对，移动判定必须服务端权威，别在客户端算位置',
      '别再直接改 dist 产物了',
      '记住：配置表字段一律 snake_case',
      '以后都先跑 assetLint 再交付',
      '回滚这次改动，重新来',
      '搞反了，坐标系是 Y 向下的',
      'this is wrong, revert it please',
    ]) {
      expect(CORRECTION_HINT_PATTERN.test(`[用户] ${text}`)).toBe(true)
    }
  })

  it('普通任务消息不命中', () => {
    for (const text of [
      '把鱼塘场景的背景色改成深蓝',
      '新建一个炮台蓝图，放到场景里',
      '跑一下测试然后交',
      '这个需求的验收标准如下',
    ]) {
      expect(CORRECTION_HINT_PATTERN.test(`[用户] ${text}`)).toBe(false)
    }
  })
})

describe('screenTranscript', () => {
  it('只取 [用户] 行，命中保留最近 2 条', () => {
    const transcript = [
      '[用户] 不对，必须服务端权威',
      '[助手] 已改为服务端权威判定。',
      '[用户] 把鱼塘场景的背景色改成深蓝',
      '[助手] 已改好。',
      '[用户] 搞反了，Y 轴是向下的',
    ].join('\n')
    expect(screenTranscript(transcript)).toEqual([
      '不对，必须服务端权威',
      '搞反了，Y 轴是向下的',
    ])
  })

  it('超过保留上限时丢弃更早的命中', () => {
    const lines = Array.from({ length: 5 }, (_, i) => `[用户] 错了${i}`)
    expect(screenTranscript(lines.join('\n'))).toHaveLength(MAX_HINT_EXCERPTS)
    expect(screenTranscript(lines.join('\n'))[0]).toBe('错了3')
  })

  it('剥前缀并截断超长摘录', () => {
    const long = `错了${'长'.repeat(300)}`
    const [excerpt] = screenTranscript(`[用户] ${long}`)
    expect(excerpt!.length).toBeLessThan(long.length)
    expect(excerpt!.endsWith('…')).toBe(true)
  })

  it('无命中返回空数组', () => {
    expect(screenTranscript('[用户] 把背景色改成深蓝\n[助手] 已改好。')).toEqual([])
  })
})

describe('rulesSectionText 纠正提示', () => {
  const rules = [{ name: 'server_authoritative_movement', content: '移动判定一律服务端权威' }]

  it('有 hint 时末尾出现提示块（回合号 + 原话摘录 + 提案-确认制要求）', () => {
    const text = rulesSectionText(rules, undefined, {
      turn: 7,
      excerpts: ['不对，必须服务端权威'],
    })
    expect(text).toContain('## ⚠ 回合末纠正提示（7 号回合，待判定）')
    expect(text).toContain('> 不对，必须服务端权威')
    expect(text).toContain('rule_propose')
    expect(text).toContain('直接忽略本提示')
  })

  it('无 hint 时不出现提示块', () => {
    const text = rulesSectionText(rules, undefined)
    expect(text).not.toContain('## ⚠ 回合末纠正提示')
  })

  it('hint.excerpts 为空时不出现提示块', () => {
    const text = rulesSectionText(rules, undefined, { turn: 7, excerpts: [] })
    expect(text).not.toContain('## ⚠ 回合末纠正提示')
  })
})
