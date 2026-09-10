---
name: dsh_image_pipeline_anchors
description: DSH 图像→模型链路锚点：能力门禁/附件化/请求变体/base64 内联的关键包与行号，vision 类任务先查这条
type: project
prefix: harness/ds-editor-tools
---

规则：DSH 把图像送进模型请求 = 能力门禁 → sharp 归一化落盘 → 历史只存 attachmentId 引用 → 构建请求时按路由预算重编码 → base64 内联进 user message。做截图/vision 类功能先查这条，避免重新在打包产物里翻链路。

**Why:** 实现都在 `~\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\` 的打包 bundle 里（node_modules 下 3 万+文件），无源码地图，重新定位要多次试错。关键锚点（2026-09-10 核对）：
- 门禁：`node_modules\@deepseek-ai\dsh-tool-fs\lib\index.js:934` `assertImageCapableRoute`，查 `inputModalities.includes("image")`；报错文案锚点 "declare image input"
- 归一化：`dsh-attachment-local\lib\index.js`（sharp，saveImage/normalizeImage，错误码 IMAGE_TOO_LARGE 等）
- 请求构建：`dsh-llm-pi-ai\lib\index.js:1072`（base64 内联 user message）+ `:1721`（请求时二次门禁 `model.input.includes("image")`）
- 默认请求预算 2048×2048 px / 1 MiB（同文件 :845-847）；编码阶梯 palette-PNG→WebP→JPEG，超预算按比例缩边循环

**How to apply:** ① 截图/vision 工具不用自己控尺寸，harness 自动缩放转码；② flash 系模型无 image 模态，read_image 在门禁即被拦，属模型路由问题不是工具 bug；③ 历史里图像只有 user 角色可回放，assistant 带图会抛 UNSUPPORTED_CONTENT；④ 在打包产物里定位实现，用会话中的真实报错文案作 grep 锚点最快。
