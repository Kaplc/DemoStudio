---
name: worktree_junction_remove_deletes_target
description: git worktree remove --force 跟随 Windows junction 递归删除目标内容——曾把主仓 node_modules 整个删空；worktree 内放 junction 后必须先手动 rmdir junction 再 remove
type: project
prefix: [package-lock.json, package.json]
---

**Problem:** git worktree remove --force 跟随 Windows junction 递归删除目标内容——2026-09-17（工程单根化迁移会话，**第二次踩坑**）为跨工作区跑 vitest 把主仓 node_modules junction 进 worktree，remove --force 后主仓 node_modules 整个删空（所有依赖消失）；更早会话已踩过一次并立此存照，但仍复发。

**Cause:** git 不理解 Windows junction/ReparsePoint——remove --force 递归删除 worktree 内容时穿透 junction 删除目标的真实内容。与 git_stash_pathspec_stale_snapshot_pitfall 同族：git 操作对 Windows 链接语义不设防。

**Solution:** 恢复：package-lock.json 完好时 `npm ci` 全量重建。预防：**worktree 内绝不放指向主仓的 junction**；已放则必须先删链接本身（`(Get-Item <junction>).Delete()` 或 cmd `rmdir`，绝不用递归删除工具）再 remove worktree；删除前 `Get-Item <path> | Select LinkType` 确认无 Junction/ReparsePoint。替代路线：跨工作区跑测试优先用 `npm ci` 独立安装或 vite `server.fs.allow` 配置，不走 junction。

**Applicable:** 一切 git worktree + node_modules 共享场景（vitest 跨工作区验证等）；Windows 上任何"目录联接 + 递归删除工具"组合（rimraf、git clean 同理需警惕）。

