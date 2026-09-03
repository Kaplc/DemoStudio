/**
 * sync-dsh-plugins.mjs — editor.bat 启动前调用
 *
 * 职责：生成 cordis.patch.yml 到项目 .dsh/profiles/（纯文件写入）
 * 编译和 junction 创建由 editor.bat 在 cmd 环境下完成。
 * 运行时目录（~/.dsh/profiles/）的复制由 editor.bat 的 copy 命令完成。
 *
 * 用法：node scripts/sync-dsh-plugins.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname, normalize } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

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

# ── DemoStudio 行为飞轮 ──
- insert:
    - id: ds-experience
      name: '@demostudio/ds-experience'
      config:
        experienceDir: '${yamlPath}/.dsh/experience'

# ── 行为飞轮：持久会话索引 ──
- id: session-query-sqlite
  config:
    path: '${sessionQueryPath}'
    openAt: first-search

# ── DemoStudio 编辑器工具 ──
- insert:
    - id: ds-editor-tools
      name: '@demostudio/ds-editor-tools'

# ── DemoStudio 上下文警告 ──
- insert:
    - id: ds-context-warning
      name: '@demostudio/ds-context-warning'
      config:
        projectRoot: '${yamlPath}'
        thresholdsK: [100,200,250,300]
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
const rootPatchPath = join(PROJECT_ROOT, '.dsh', 'profiles', 'cordis.patch.yml')
const rootPatchContent = `# DemoStudio 自定义配置补丁
# 由 scripts/sync-dsh-plugins.mjs 在 editor.bat 启动时动态生成

- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
  config:
    default: standard
    roots:
      - path: '${yamlPath}/.dsh/presets'
        trust: user
`
try {
  writeFileSync(rootPatchPath, rootPatchContent, 'utf-8')
  console.log(`  [root] cordis.patch.yml 已生成`)
} catch (e) {
  console.error(`  [root] 写入失败: ${e.message}`)
}

console.log('[Deploy] 配置文件生成完成（位于项目 .dsh/profiles/，editor.bat 会复制到运行时目录）')
