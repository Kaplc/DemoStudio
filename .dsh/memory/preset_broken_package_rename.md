---
name: preset_broken_package_rename
description: 内核升级包改名后 preset 卡片挂「加载失败」的根因（健康检查包解析）与修复路径
type: project
prefix: [.dsh/presets/game-editor/agent.cordis.yml, doc/harness/preset-sync-mechanism.md]
---

**Problem:** 2026-09-30 发现设置页 `game-editor` preset 卡片挂红色「加载失败」徽章，preset 文件本身没人动过。
**Cause:** 健康检查（`dsh-agent-presets/discovery.ts` 的 `compositionProblem`）对每个启用行做 `packageInstalled` 上行 node_modules 解析，一个死行拖垮整卡。内核 2026-09-29 升到 0.1.7-rc.2 时下线了 `@deepseek-ai/dsh-workflow-worker-thread`，而 preset 按旧内核 0.1.2 的 standard 抄了该行 → 解析失败 → broken。
**Solution:** 对照运行中内核自带的 `dsh/node_modules/@deepseek-ai/dsh-web-app/presets/*.patch.yml` 找新包名（worker 行现为 `@deepseek-ai/dsh-workflow-ptc` + `provider: spawn`），替换死行；roster 每次读取都重扫，改完无需重启。改 home 权威拷贝（`~/.dsh/.agent-presets/`）后镜像到项目 `.dsh/presets/`。
**Applicable:** `~/.dsh/.agent-presets/*/agent.cordis.yml`、`.dsh/presets/` 镜像、`doc/harness/preset-sync-mechanism.md` §6（坑 8）；任何内核升级后 preset「加载失败」的排查。

