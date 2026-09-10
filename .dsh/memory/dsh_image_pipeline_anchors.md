---
name: dsh_image_pipeline_anchors
description: DSH 图像→模型链路锚点：能力门禁/附件化/请求构建/模型模态声明的关键包与行号；模型读不了图先查 settings.yaml input 声明
type: project
prefix: harness/ds-editor-tools
---


规则：DSH 把图像送进模型请求 = 能力门禁 → sharp 归一化落盘 → 历史只存 attachmentId 引用 → 构建请求时按路由预算重编码 → base64 内联进 user message。做截图/vision 类功能先查这条，避免重新在打包产物里翻链路。

**Why:** 实现都在 `~\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\` 的打包 bundle 里（node_modules 下 3 万+文件），无源码地图，重新定位要多次试错。关键锚点（2026-09-10 核对）：
- 门禁：`node_modules\@deepseek-ai\dsh-tool-fs\lib\index.js:934` `assertImageCapableRoute`，查 `inputModalities.includes("image")`；报错文案锚点 "declare image input"
- 归一化：`dsh-attachment-local\lib\index.js`（sharp，saveImage/normalizeImage，错误码 IMAGE_TOO_LARGE 等）
- 请求构建：`dsh-llm-pi-ai\lib\index.js:1072`（base64 内联 user message）+ `:1721`（请求时二次门禁 `model.input.includes("image")`）
- 默认请求预算 2048×2048 px / 1 MiB（同文件 :845-847）；编码阶梯 palette-PNG→WebP→JPEG，超预算按比例缩边循环
- 模型模态声明源：`~/.dsh/settings.yaml` → `llm-pi-ai.providers.<route>.models[].input`（如 `[text, image]`）；pi-ai 内置目录 `dsh\node_modules\@earendil-works\pi-ai\dist\providers\data\*.json`（zai 目录 glm-5v-turbo 为 text+image，无 glm-5.3-flash 条目）；schema `dsh-llm-pi-ai\lib\types\config.d.ts`（手工声明且目录无同名条目时 input 默认 `["text"]` 兜底）

**How to apply:** ① 截图/vision 工具不用自己控尺寸，harness 自动缩放转码；② 模型读不了图 = 模态声明问题，先查 settings.yaml 的 `models[].input`——glm-5.3-flash 官方就是 VLM（docs.z.ai/guides/vlm/），2026-09-10 已补 `input: [text, image]` 修复，settings.yaml 热加载改完即生效无需重启；③ 历史里图像只有 user 角色可回放，assistant 带图会抛 UNSUPPORTED_CONTENT；④ 在打包产物里定位实现，用会话中的真实报错文案作 grep 锚点最快。
