---
name: add_provider_model_context_vision_config
task_type: feature
outcome: success
date: 2026-09-28
prefix: [src/components/agent/SettingsPanel.tsx, agent.html, e2e/agent/provider-model-config.spec.ts]
---
## Summary

给编辑器供应商设置面板加模型行编辑器（每模型上下文大小 + 视觉勾选）和已有供应商编辑入口，写回走 settings.mutate（llm-pi-ai.providers）；2026-09-30 面板改为仅渲染用户级自定义第三方（预设目录不再展示，getLlmProviders/ProviderInfo 已删），e2e 3 例全绿，tsc 零错。

## Lessons

1. rowToModel 的合并底必须是 existing.models 原始数组（保留 maxTokens 等未知字段）；换成裁剪投影对象会静默丢字段——首版真 bug，靠"载荷 toEqual 精确断言"逮住。空上下文=删 contextWindow 键（跟随默认，不是继承旧值），取消视觉=删 input 键（回退目录默认模态）。2. vitest globals:false 下 @testing-library/react 不自动 cleanup，组件测试必须 afterEach(cleanup)，否则 DOM 跨用例泄漏报 "Found multiple elements"（该单测文件 settingsPanelModels.test.tsx 已下线，合并语义现由 e2e「编辑 glm2」用例锁定）。3. e2e 落点在仓库根 e2e/（入口 /agent.html）；addInitScript 写 localStorage 'demostudio.dsh.session' 命中 recovering 路径，fetch 钩子按 body.method 分发合成 RPC，settings.mutate 记进 window.__dshMutations 供断言，全程不碰真 DSH；面板只吃 settings.describe 的 user.providers 后，stub 的 llm.providers 条目专门用于断言"预设不渲染"。4. 本仓 eslint 未装，lint 门禁实际跑 npx tsc --noEmit + 定向 playwright（见 memory:root_lint_script_broken、memory:targeted_regression_first）。5. harness/dsh-source/ 有完整 DSH 源码镜像，查 DSH 行为（schema/门禁/merge 语义）先查它，别再扒打包 bundle。

## Effective Path

src/components/agent/SettingsPanel.tsx; e2e/agent/provider-model-config.spec.ts; doc/editor/integration/agent_panel_system.md §13
