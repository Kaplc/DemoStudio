---
name: open_clash_level1_asset
task_type: feature/asset-open
outcome: success
date: 2026-08-31
---
## Summary

用户要求打开部落冲突 level1 资产，助手通过 glob 定位到 fish_level1.scene.json，发现 editor_emit 不可用且连接到的是 Chrome DevTools 而非编辑器，最终改用 emit_ai_event 成功打开场景预览。

## Lessons

先 glob 找路径再操作资产是有效路径；editor_emit 失败时不要盲目重试，应先检查编辑器连接状态（read title 可识别当前页面）；一旦发现连到 DevTools，直接用 emit_ai_event 绕过 UI 层，注意 payload 需传字符串而非对象。

## Effective Path

src/projects/fish/asset/fish_level1.scene.json
