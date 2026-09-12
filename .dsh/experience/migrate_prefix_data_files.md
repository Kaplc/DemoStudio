---
name: migrate_prefix_data_files
task_type: refactor/data-migration
outcome: success
date: 2026-09-12
prefix: [harness/ds-memory/src/associate.ts, harness/ds-experience/src/associate.ts]
---
## Summary

把 36 个记忆/经验文件的旧目录型 prefix（harness、src/engine、a || b 等）迁移为新文件数组语义：写一次性迁移脚本做 DRY-RUN 映射表人工过目后 APPLY，APPLY 的 frontmatter 重建切片 bug 损坏全部文件，靠 git HEAD/暂存区/会话内注入原文三层来源修复到逐文件 numstat 1/1 干净。

## Lessons

1. 批量改 frontmatter 的脚本**绝不能用"头尾切片拼回"**：本次 APPLY 用 `slice(0, m0.length - block.length)` 当头、`slice(m0.length)` 当尾，两个偏移基准不一致（一个含 name 片段、一个跳过收尾 fence），36 个文件全被吃掉收尾 `---` 且 name 行变成 namename。正确做法：`text.replace(/^prefix: .*$/m, ...)` 整行替换，或显式重建 `---\n` + block + `\n---`，其余字节不动。2. DRY-RUN 出映射表人工过目这一步救了质量：34/36 的自动提取（正文路径 token + 旧目录加权）直接可用，9 个 MANUAL/弱命中人工定夺；提取正则分组必须含扩展名（match[0] 而非 match[1]）。3. 写坏后评估损伤用 `git diff --numstat`：`1 1` = 只动了一行（干净），多行 = 需修复；修复来源三层：`git show HEAD:path`（已提交）→ `git show :path`（已暂存，本例 warm_design_direction_tension）→ 会话内被联想注入过的记忆全文（未跟踪文件无 git 底稿时的兜底，本次 warm_design 直接重建成功）。4. git show 对不存在于 HEAD 的路径报 fatal 但脚本要 continue 跳过（两个目录轮询同一文件名清单时大半是正常 miss）。5. PowerShell 内联正则的反斜杠/引号转义极易翻车（本次 (?<!...) 写崩整段校验），批量校验用 node -e 更稳。6. INDEX.md 的行 150 字符预算会把 `[联想 ...]` 标注整个截掉，索引标注只是展示、frontmatter 才是联想权威——迁移只需保证 frontmatter 正确。7. PowerShell 管道接 git show 会因单条命令失败把后续 WriteAllText 拖下水（本例把一个未跟踪文件写空），字节级操作一律走 node execFileSync。

## Effective Path

.dsh/memory/*.md + .dsh/experience/*.md frontmatter prefix；迁移脚本思路：全仓文件清单 + 正文路径 token 提取（唯一 basename 兜底解析）+ 旧目录加权 Top3 + DRY-RUN 人工过目 + OVERRIDES
