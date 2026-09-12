---
name: memory_write_manual_flow
description: memory_write 半自动语义（2026-09-09 定稿）：工具直写 frontmatter + 同步索引，正文由 agent 按提醒手写；返回值禁显式 undefined 键；prefix 为文件数组（2026-09-12 改版）
type: project
prefix: [harness/ds-memory/src/tools.ts, harness/ds-memory/src/memoryTypes.ts]
---
规则：memory_write 为**半自动**（2026-09-09 用户定稿"工具专写 md 开头的 frontmatter 格式"）——工具做校验 + 按 name/description 查重后，**直接落盘 frontmatter**：新建文件只写头部格式（正文为空）；已有文件**原位更新头部、正文原样保留**，并同步 MEMORY.md 索引行（description + prefix 标注）。返回 `action: write_frontmatter` + `reminder`（`memoryTypes.ts` 的 `buildBodyWriteReminder`），agent 只剩两步：① write/edit 补写正文（条目格式）② 顺便全库过时检查。**prefix 必填**（2026-09-12 改版为文件数组）：声明联想触发的**具体文件路径数组**（如 `["src/engine/foo.ts"]`，落盘为 `prefix: [a.ts, b.md]`）；无联想或更新时保持原样填 `hold`（即 `["hold"]`/`[]`，大小写不敏感；hold 不落 frontmatter、更新=保留旧值）。experience_save 的 prefix 同语义。

**Why:** 格式确定性归工具、内容自由度归 agent（frontmatter 模板演进由代码收敛，不再靠 agent 手抄）。直接动机：内核对工具返回值有 **lossless JSON 边界**——显式 `undefined` 键（旧版新建路径的 `deduped_by`/`existing_file`）会被拒收报 `ToolOutputError: value is not lossless JSON`；可选字段必须条件展开（键缺席而非 undefined 值），测试用 `JSON.parse(JSON.stringify(v))) toStrictEqual v` 锁死。

**How to apply:** 调用 memory_write 后按 reminder 补写正文；查重命中（updated）时正文要合并而非覆盖。给 harness 工具写 execute 返回值时一律避免显式 undefined 键（ds-experience 的 experience_search `date` 字段同修）。语义沿革：全自动 → 手动三步（2026-09-09 上午）→ 半自动（同日定稿）。

**复发排查（2026-09-10 实测）**：若 dist 已是修复版（条件展开）但报错仍复现——是**运行中 agent 进程的内存里还是旧代码**（junction 代码随进程启动载入，重编译不影响运行中进程）。特征：仅「新建」路径报错、「已有文件/查重更新」路径正常。处置：手动三步落盘顶住，重启编辑器让进程加载新 dist 即恢复。
