/**
 * dsh-patch-merge.mjs — cordis.patch.yml 项目→home 合并写入的纯函数
 *
 * 背景（2026-09-30）：DSH 内核 0.1.7 起 settings.yaml 已移除，设置页/供应商面板的
 * settings.mutate 直接写活动 profile 的 patch 文件（~/.dsh/profiles/web/cordis.patch.yml）
 * 顶层的 `- id: <ns>` config 覆盖条目（自定义供应商、默认模型 agent-default-model、
 * 欢迎通知 ui-settings-general 都落在这里）。启动管线若用 copy /Y 整文件覆盖 home 侧，
 * 这些条目全部丢失——即"编辑器添加的第三方配置重启就丢"的根因。合并规则：
 * - DemoStudio 托管块（生成器模板内的全部条目：ds-* 插件 insert、preset-* 预设 insert、
 *   session-query-sqlite 覆盖）以新生成内容为准；
 * - 其余顶层条目（内核设置写入 + 用户手工添加）原样保留，追加在生成内容之后。
 */

/** 托管块判定：块内出现 `- id: ds-* / preset-* / session-query-sqlite` 形态的 id 行即托管（兼容 insert 块内 4 空格缩进的嵌套 id） */
const MANAGED_ID_RE = /^[ \t]*-[ \t]+id:[ \t]*(?:ds-[\w-]+|preset-[\w-]+|session-query-sqlite)[ \t]*$/m

/**
 * 按 YAML 顶层序列项切块：列 0 的 `- ` 开启新块，块前紧邻的注释归属该块。
 * 空行一律丢弃（不归属任何块）——否则合并输出的块间空行会在二次合并时被吸附进
 * 块首，破坏 mergeProfilePatch 的幂等性。纯文本切块不做 YAML 解析，因此 `!!js`
 * 表达式等原始内容原样保留。
 * @param text - cordis.patch.yml 全文（顶层必须是序列）。
 * @returns 顶层块文本数组（每块含归属注释，去除尾随空白）；文件头注释不属于任何块，丢弃。
 */
/**
 * 按 YAML 顶层序列项切块：列 0 的 `- ` 开启新块，块前紧邻的注释归属该块
 * （含文件头 banner——正常合并里首块总是托管块会被丢弃，无副作用）。
 * 空行一律丢弃（不归属任何块）——否则合并输出的块间空行会在二次合并时被吸附进
 * 块首，破坏 mergeProfilePatch 的幂等性。纯文本切块不做 YAML 解析，因此 `!!js`
 * 表达式等原始内容原样保留。
 * @param text - cordis.patch.yml 全文（顶层必须是序列）。
 * @returns 顶层块文本数组（每块含归属注释，去除尾随空白）。
 */
export function splitTopLevelBlocks(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const blocks = []
  let current = null
  let pending = []
  for (const line of lines) {
    const isItem = /^-[ \t]/.test(line) || line === '-'
    if (isItem) {
      if (current) blocks.push(current)
      current = pending
      pending = []
      current.push(line)
    } else if (/^[ \t]*$/.test(line)) {
      // 空行丢弃，已挂到 pending 的注释保留
    } else if (/^#/.test(line)) {
      pending.push(line)
    } else if (current) {
      current.push(line)
    }
    // 首个条目之前的非注释行（异常内容）丢弃
  }
  if (current) blocks.push(current)
  return blocks.map(block => block.join('\n').trimEnd())
}

/**
 * 判定一个顶层块是否 DemoStudio 托管（生成器每次重建，无需保留旧版）。
 * @param block - splitTopLevelBlocks 产出的单块文本。
 */
export function isManagedBlock(block) {
  return MANAGED_ID_RE.test(block)
}

/**
 * 合并项目侧新生成的 patch 与 home 侧现有 patch：生成内容在前，
 * home 侧非托管块（内核设置写入/用户手工条目）原样保留在后。
 * @param generated - 项目侧新生成的 patch 全文。
 * @param existing - home 侧现有 patch 全文；null/空文件视为不存在。
 * @returns 合并后的 patch 全文（幂等：对合并结果再合并一次输出不变）。
 */
export function mergeProfilePatch(generated, existing) {
  const base = String(generated ?? '').trimEnd()
  const preserved = splitTopLevelBlocks(String(existing ?? '')).filter(block => !isManagedBlock(block))
  if (preserved.length === 0) return base + '\n'
  // 不插入分隔注释：新增的注释行会在二次合并时被当作"块前注释"吸附进首个用户块，
  // 逐次累积破坏幂等性；保留块自带各自的归属注释，足以区分类别。
  return base + '\n\n' + preserved.join('\n\n') + '\n'
}
