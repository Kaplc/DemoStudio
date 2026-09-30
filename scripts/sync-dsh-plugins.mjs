/**
 * sync-dsh-plugins.mjs — editor.bat 启动前调用
 *
 * 职责：生成 cordis.patch.yml 到项目 .dsh/profiles/（纯文件写入），
 * 并"合并写入"home 侧运行时目录（~/.dsh/profiles/ 与 ~/.dsh/cordis.patch.yml）：
 * 生成块为准 + 保留内核设置写入/用户手工添加的条目（见 scripts/dsh-patch-merge.mjs）。
 * 编译和 junction 创建由 editor.bat 在 cmd 环境下完成。
 *
 * ⚠️ 内核 0.1.7 起 settings.yaml 已移除：供应商面板/设置页的 settings.mutate 直接写
 * 活动 profile patch（~/.dsh/profiles/web/cordis.patch.yml）。这里绝不能整文件覆盖
 * home 侧——否则编辑器重启后自定义供应商/默认模型全部丢失（2026-09-30 修复）。
 *
 * 用法：node scripts/sync-dsh-plugins.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname, normalize } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { mergeProfilePatch } from './dsh-patch-merge.mjs'

// ─── 常量 ───
const __file = fileURLToPath(import.meta.url)
const PROJECT_ROOT = resolve(dirname(__file), '..')
const DSH_HOME = join(homedir(), '.dsh')

function toYamlPath(p) {
  return normalize(p).replace(/\\/g, '/')
}

// ─── 主流程 ───
console.log('[Deploy] 生成 cordis.patch.yml...')

const yamlPath = toYamlPath(PROJECT_ROOT)
const sessionQueryPath = toYamlPath(join(DSH_HOME, 'session-query', 'index.sqlite'))

const patchContent = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
# 此文件由 scripts/sync-dsh-plugins.mjs 在 editor.bat 启动时动态生成

# ── DemoStudio 记忆系统 ──
- insert:
    - id: ds-memory
      name: '@demostudio/ds-memory'
      config:
        memoryDir: '${yamlPath}/.dsh/memory'

# ── DemoStudio 启动同步 ──
- insert:
    - id: ds-sync
      name: '@demostudio/ds-sync'
      config:
        projectRoot: '${yamlPath}'

# ── DemoStudio 引擎工具 ──
- insert:
    - id: ds-engine-tools
      name: '@demostudio/ds-engine-tools'

# ── DemoStudio 插件管理器 ──
- insert:
    - id: ds-plugin-manager
      name: '@demostudio/ds-plugin-manager'

# ── DemoStudio 目录指令 ──
- insert:
    - id: ds-instructions
      name: '@demostudio/ds-instructions'
      config:
        projectRoot: '${yamlPath}'

# ── DemoStudio 反馈飞轮 ──
- insert:
    - id: ds-feedback
      name: '@demostudio/ds-feedback'
      config:
        ruleDir: '${yamlPath}/.dsh/rules'
        lossDir: '${yamlPath}/.dsh/loss'
        gradientDir: '${yamlPath}/.dsh/gradient'
        reminderDir: '${yamlPath}/.dsh/reminder'

# ── DemoStudio 行为飞轮 ──
- insert:
    - id: ds-experience
      name: '@demostudio/ds-experience'
      config:
        experienceDir: '${yamlPath}/.dsh/experience'

# ── DemoStudio 回合末提醒 ──
# reminders 为全量替换（缺省 = 内置两条默认提醒）；新增提醒 = 在此加条目 + .dsh/reminder/ 放文案文件
- insert:
    - id: ds-reminder
      name: '@demostudio/ds-reminder'
      config:
        reminderDir: '${yamlPath}/.dsh/reminder'
        reminders:
          - id: memory-end-of-turn
            file: memory-end-of-turn.md
            channel: steer
            skipTools: [memory_write, memory_reinforce]
            summary: 回合末记忆提醒
          - id: experience-end-of-turn
            file: experience-end-of-turn.md
            channel: inject
            skipTools: [experience_save, experience_reinforce]
            summary: 回合末经验提醒
          - id: doc-update-reminder
            file: 文档更新提醒.md
            channel: inject
            summary: 文档更新提醒

# ── 行为飞轮：持久会话索引 ──
- id: session-query-sqlite
  config:
    path: '${sessionQueryPath}'
    openAt: first-search

# ── DemoStudio 编辑器工具 ──
- insert:
    - id: ds-editor-tools
      name: '@demostudio/ds-editor-tools'
`

// 写入项目 .dsh/profiles/ 目录（editor.bat 会 copy 到 ~/.dsh/profiles/）
for (const profile of ['web', 'headless']) {
  const templatePath = join(PROJECT_ROOT, '.dsh', 'profiles', profile, 'cordis.patch.yml')
  try {
    mkdirSync(dirname(templatePath), { recursive: true })
    writeFileSync(templatePath, patchContent, 'utf-8')
    console.log(`  [${profile}] cordis.patch.yml 已生成`)
  } catch (e) {
    console.error(`  [${profile}] 写入失败: ${e.message}`)
  }
}

// 生成项目 .dsh/profiles/cordis.patch.yml（用户级 agent-presets 配置）
// 0.1.7 起 dsh-agent-presets 目录扫描器插件已移除：预设改为在 cordis 组合里显式声明——
// 一个 '@deepseek-ai/dsh-agent-preset-registry' 条目提供 agentPresets 服务（default 指向缺省预设），
// 每个预设一个 '@deepseek-ai/dsh-agent-preset' 条目（id/plugins 即组合；!!js 表达式由内核
// entryListSchema 解析，这里纯文本内联不做 YAML 解析）。
import { readFileSync, readdirSync, existsSync } from 'node:fs'

function parsePresetMeta(presetDir) {
  const meta = { name: undefined, description: undefined, order: undefined }
  const file = join(presetDir, 'preset.yml')
  if (!existsSync(file)) return meta
  try {
    // preset.yml 是平铺的三字段元数据（无 !!js），轻量行解析即可，避免引入 yaml 依赖
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^(name|description|order):\s*(.*)$/.exec(line)
      if (!m) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      meta[m[1]] = m[1] === 'order' ? Number(v) : v
    }
  } catch { /* 元数据缺失时用目录名兜底 */ }
  return meta
}

// 单行/单双引号安全化：YAML 双引号标量转义
function yamlDoubleQuoted(v) {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function collectPresetEntries() {
  const presetsDir = join(PROJECT_ROOT, '.dsh', 'presets')
  if (!existsSync(presetsDir)) return { yaml: '', count: 0 }
  const blocks = []
  let count = 0
  for (const entry of readdirSync(presetsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const compositionFile = join(presetsDir, entry.name, 'agent.cordis.yml')
    if (!existsSync(compositionFile)) continue
    const meta = parsePresetMeta(join(presetsDir, entry.name))
    // 组合文件纯文本内联：config.plugins 键在 8 空格缩进，子序列必须 ≥8（这里取 10），
    // 低于父键缩进时 YAML 会把序列归属到上一级 insert 列表（2026-09-29 实证：plugins 静默变 null）
    const composition = readFileSync(compositionFile, 'utf8')
      .split(/\r?\n/)
      .map((line) => (line.trim() === '' ? '' : '          ' + line))
      .join('\n')
    blocks.push(`# ── Agent 预设：${meta.name ?? entry.name}（源 .dsh/presets/${entry.name}/，改文件后重跑 editor.bat） ──
- insert:
    - id: preset-${entry.name}
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: ${entry.name}
${meta.name ? `        name: ${yamlDoubleQuoted(meta.name)}\n` : ''}${meta.description ? `        description: ${yamlDoubleQuoted(meta.description)}\n` : ''}${meta.order !== undefined && !Number.isNaN(meta.order) ? `        order: ${meta.order}\n` : ''}        plugins:
${composition}`)
    count++
  }
  return { yaml: blocks.join('\n\n'), count }
}

const presets = collectPresetEntries()
// 内核已内置 agent-preset-registry（default: standard），无需注册；只 insert 预设条目。
// 注意 patch 语义：顶层条目 = override 已有 id；新增条目必须走 insert（2026-09-29 实证）。
const presetSection = presets.count > 0 ? `
${presets.yaml}
` : ''

const rootPatchPath = join(PROJECT_ROOT, '.dsh', 'profiles', 'cordis.patch.yml')
const rootPatchContent = `# DemoStudio 自定义配置补丁
# 由 scripts/sync-dsh-plugins.mjs 在 editor.bat 启动时动态生成
${presetSection}`
try {
  writeFileSync(rootPatchPath, rootPatchContent, 'utf-8')
  console.log(`  [root] cordis.patch.yml 已生成（预设 ${presets.count} 个）`)
} catch (e) {
  console.error(`  [root] 写入失败: ${e.message}`)
}

// 预设条目同时追加进 web/headless profile patch（launcher 只以 --profile web 启动，
// profile patch 是内核 composeLive 的确定加载路径；root patch 的 overlay 语义随版本漂移，不作依赖）
if (presets.count > 0) {
  for (const profile of ['web', 'headless']) {
    const templatePath = join(PROJECT_ROOT, '.dsh', 'profiles', profile, 'cordis.patch.yml')
    try {
      const base = readFileSync(templatePath, 'utf8')
      writeFileSync(templatePath, `${base}\n${presetSection}`, 'utf-8')
      console.log(`  [${profile}] 预设条目已追加（${presets.count} 个）`)
    } catch (e) {
      console.error(`  [${profile}] 预设追加失败: ${e.message}`)
    }
  }
}

// ── home 侧合并写入：生成块为准 + 保留内核设置写入/用户手工条目 ──
// 供应商面板/设置页的 settings.mutate（内核 0.1.7+）直接写 home 侧活动 profile patch 的
// `- id: <ns>` 覆盖条目（llm-pi-ai 自定义供应商 / agent-default-model / ui-settings-general），
// 必须合并保留，绝不能整文件覆盖。web/headless 读项目侧最终生成物；root 用 rootPatchContent。
console.log('[Deploy] 合并写入 home 侧 patch（保留内核/用户条目）...')
const DSH_HOME_DIR = join(homedir(), '.dsh')
const homeMergeTargets = [
  {
    label: 'web',
    homePath: join(DSH_HOME_DIR, 'profiles', 'web', 'cordis.patch.yml'),
    generated: () => readFileSync(join(PROJECT_ROOT, '.dsh', 'profiles', 'web', 'cordis.patch.yml'), 'utf8'),
  },
  {
    label: 'headless',
    homePath: join(DSH_HOME_DIR, 'profiles', 'headless', 'cordis.patch.yml'),
    generated: () => readFileSync(join(PROJECT_ROOT, '.dsh', 'profiles', 'headless', 'cordis.patch.yml'), 'utf8'),
  },
  {
    label: 'root',
    homePath: join(DSH_HOME_DIR, 'cordis.patch.yml'),
    generated: () => rootPatchContent,
  },
]
for (const target of homeMergeTargets) {
  try {
    mkdirSync(dirname(target.homePath), { recursive: true })
    const generated = target.generated()
    const existing = existsSync(target.homePath) ? readFileSync(target.homePath, 'utf8') : null
    writeFileSync(target.homePath, mergeProfilePatch(generated, existing), 'utf-8')
    console.log(`  [${target.label}] 已合并写入 ${target.homePath}`)
  } catch (e) {
    console.error(`  [${target.label}] 合并写入失败: ${e.message}`)
  }
}

console.log('[Deploy] 配置文件生成完成（项目侧 .dsh/profiles/ + home 侧合并写入）')
