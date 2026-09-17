/**
 * Mock 桥三纯函数单测 — doc-dev/projects-root-unification 方案 §3.2
 *
 * normalizeGlobPath（mockPath）：glob key → IPC 相对路径，双前缀收窄为单前缀终态。
 * scanProjectsFrom（mockProjectScan）：Mock 工程发现，source 字段随双轨退役删除。
 * mergeProjects（projectMerge）：双参合流退化为单参按 folder 去重。
 * 三者均为纯函数模块（无 vite / engine 依赖），直接实例级断言。
 */
import { describe, it, expect } from 'vitest'
import { normalizeGlobPath } from '../src/editor/mockPath'
import { scanProjectsFrom } from '../src/editor/mockProjectScan'
import { mergeProjects } from '../src/stores/projectMerge'

describe('A. normalizeGlobPath 单前缀翻译', () => {
  it('A1: 外部根 key 剥两层上跳', () => {
    expect(normalizeGlobPath('../../projects/foo/project.json')).toBe('projects/foo/project.json')
    expect(normalizeGlobPath('../../projects/fish/asset/blueprints/ui/x.widget.html'))
      .toBe('projects/fish/asset/blueprints/ui/x.widget.html')
  })
  it('A2: Windows 反斜杠 key 先归一正斜杠再剥前缀', () => {
    expect(normalizeGlobPath('..\\..\\projects\\warm-current\\asset\\a.widget.json'))
      .toBe('projects/warm-current/asset/a.widget.json')
  })
  it('A3: 已是仓库根相对形态时幂等', () => {
    expect(normalizeGlobPath('projects/x/y.json')).toBe('projects/x/y.json')
  })
  it('A4: 旧内置前缀 ../projects/** 不再翻译成 src/**（内置轨退役锁）', () => {
    expect(normalizeGlobPath('../projects/fish/project.json')).toBe('../projects/fish/project.json')
  })
})

describe('B. scanProjectsFrom Mock 工程发现', () => {
  it('B1: 单前缀 key 提取 folder 与元数据', () => {
    const projects = scanProjectsFrom([
      ['../../projects/fish/project.json',
       { name: 'ClashMaster', defaultScene: 'projects/fish/asset/fish_menu.scene.json' }],
    ])
    expect(projects).toHaveLength(1)
    expect(projects[0].folder).toBe('fish')
    expect(projects[0].name).toBe('ClashMaster')
    expect(projects[0].defaultScene).toBe('projects/fish/asset/fish_menu.scene.json')
  })
  it('B2: source 字段退役（双轨合流不再存在）', () => {
    const projects = scanProjectsFrom([['../../projects/hello/project.json', {}]])
    expect('source' in projects[0]).toBe(false)
  })
  it('B3: 旧内置形态 key（src/projects/**）不被识别', () => {
    expect(scanProjectsFrom([['src/projects/fish/project.json', { name: 'X' }]])).toHaveLength(0)
  })
  it('B4: 坏条目跳过不影响其他工程（与主进程容错语义一致）', () => {
    const projects = scanProjectsFrom([
      ['../../projects/bad/project.json', null],
      ['../../projects/good/project.json', { name: 'Good' }],
    ])
    expect(projects.map(p => p.folder)).toEqual(['good'])
  })
  it('B5: 缺省字段兜底（version=1.0.0、tags=[]）', () => {
    const [p] = scanProjectsFrom([['../../projects/empty/project.json', {}]])
    expect(p.version).toBe('1.0.0')
    expect(p.tags).toEqual([])
  })
})

describe('C. mergeProjects 单参去重', () => {
  it('C1: folder 重复保留首个，顺序稳定', () => {
    const merged = mergeProjects([
      { name: 'A', folder: 'a' },
      { name: 'B', folder: 'b' },
      { name: 'A2', folder: 'a' },
    ])
    expect(merged.map(p => p.folder)).toEqual(['a', 'b'])
    expect(merged[0].name).toBe('A')
  })
  it('C2: 空列表安全', () => {
    expect(mergeProjects([])).toEqual([])
  })
})
