---
name: warm_gamemode_componentization
task_type: refactor/component-extraction
outcome: success
date: 2026-09-21
prefix: [projects/warm-current/gameplay/base/WarmCurrentGameMode.ts, playwright.e2e.config.ts, package.json]
---
## Summary

把 warm-current 的 WarmCurrentGameMode（3580 行）按 A/B/C 三层下沉为 10 个 BObjectComponent（sky/hit/feedback/vm/ship/payloadDesign/panels/fleet/holo/view），GameMode 保留生命周期+Esc 分发+暂停存档+指针胶水，其余公开 API 以薄转发门面保持 UI 脚本/e2e 调用面不变；门禁 tsc 归零、vitest 11 红/12 红全部对齐既有基线、e2e warm 12 红中 8 个对齐文档化基线、4 个存疑红经 HEAD 文件交换对照证实为既有基线红（HEAD 同样 7 红）。

## Lessons

1) 一次性脚本搬运大块代码（行级 marker 提取 + this.→this.owner. 正则适配 + EOL 保持）比手抄 900 行可靠得多；但 here-string 头 @' 后同行不能有内容、块注释里 Hud*/Xxx 的 */ 会提前终止注释——两处都炸过。2) 脚本绕过 edit 工具改文件后再用 edit 会报 "file changed since read"，重新 read 即可；PowerShell EIO(Win32 1175) 是瞬时错，原样重试即过（本 session 出现 5+ 次）。3) 拼接删除大方法块时收尾 } 的归属最容易错（旧赋值语句的 } 留在原地成孤儿），tsc 的 TS1005/TS1434 语法错就能定位。4) 字段下沉时 UI 脚本直读 mode.field 的地方用"只读 getter 门面"保调用面，写点改为组件方法调用；跨组件私有成员（pendingObserveClick/applyZoomFloor/clearObserveState）改 public 是可接受代价。5) e2e 门禁判定三大坑：①并行会话在重组 e2e（specs 迁 projects/<id>/e2e/、config 改 projects 模式）会让旧路径跑挂/worker 连坐（"Project not found"），跑前先 git status e2e/ 确认布局；②dev server 不是 playwright 自起，5173 无服务时后台任务静默挂死（无进程无产物），先 node fetch 探活；③"甄别基线红"的正解是文件交换式 HEAD 对照（备份哈希 + git show HEAD:file 换入 + 跑同 spec + 哈希校验还原），本仓实测可行——stash 往返才是禁区（见 memory:git_stash_pathspec_stale_snapshot_pitfall）；对照脚本里哈希清单别截断存储，前 12 位才比得回。6) "外层管道 Select-Object -Last N" 会让后台任务全程无输出，重定向落文件 + Select-String 轮询才可观察进度。

## Effective Path

projects/warm-current/gameplay/base/WarmCurrentGameMode.ts（门面+生命周期） || projects/warm-current/gameplay/systems/（10 组件） || 基线对照法：备份哈希 + git show HEAD 换入 + 同 spec 对照
