import { describe, expect, it } from 'vitest'
import { parseExtractionOutput } from '../src/extractExperience.js'

// 注意：extractFromSession（LLM 自动提炼）已被禁用并退役——经验保存完全由主 agent
// 自觉调用 experience_save 完成。此处仅保留其纯解析函数的回归测试。

const EPISODE_JSON = JSON.stringify({
  is_task: true,
  episode: {
    name: 'build_ds_experience_plugin',
    task_type: 'feature',
    outcome: 'success',
    summary: '新建 ds-experience 插件并 junction 挂载',
    lessons: 'defineTool 必须走规范 schema；junction 用 PowerShell',
    effective_path: 'harness/ds-experience',
  },
})

describe('parseExtractionOutput', () => {
  it('episode:null → null（成功，不落盘）；缺 episode 字段 → undefined', () => {
    expect(parseExtractionOutput('{"episode": null}')).toBeNull()
    expect(parseExtractionOutput('{"is_task": false}')).toBeUndefined()
  })
  it('合法 episode 逐字段校验并规范化', () => {
    const parsed = parseExtractionOutput(`前言 ${EPISODE_JSON} 后记`)
    expect(parsed).not.toBeNull()
    expect(parsed).toMatchObject({ name: 'build_ds_experience_plugin.md', outcome: 'success' })
  })
  it('缺字段/坏名/未知 outcome 兜底', () => {
    expect(parseExtractionOutput('{"is_task": true, "episode": {"name": "Bad Name"}}')).toBeUndefined()
    expect(parseExtractionOutput('{"is_task": true}')).toBeUndefined()
    const lenient = parseExtractionOutput(JSON.stringify({
      is_task: true,
      episode: { name: 'ok_name', task_type: 'debug', outcome: 'weird', summary: 's', lessons: 'l' },
    }))
    expect(lenient).not.toBeNull()
    expect(lenient!.outcome).toBe('success') // 未知 outcome 宽容降级
  })
  it('完全不是 JSON → undefined（失败重试）', () => {
    expect(parseExtractionOutput('好的')).toBeUndefined()
    expect(parseExtractionOutput('')).toBeUndefined()
  })
})
