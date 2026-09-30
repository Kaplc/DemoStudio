---
name: dsh_tool_output_schema_no_null
description: DSH 工具 output.schema 严格校验：声明 number/string 的字段发 null 会整结果被拒——返回值只发实值或省略字段
type: project
prefix: [harness/ds-editor-tools/src/tools/editorScreenshot.ts]
---

**Problem:** 工具调用报 `value.<字段> must be a number/string`（整结果被拒），但功能实际已执行成功（如 editor_screenshot 截图已落盘），症状有迷惑性。

**Cause:** DSH 内核对工具返回值按 `output.schema` 严格校验；插件工具返回 `field: xxx ?? null` 这类写法，null 撞声明为 `number`/`string` 的字段即整结果被拒。schema 未声明 `required`，字段可省略但不可为 null。

**Solution:** 工具返回值契约：**要么实值、要么省略字段，绝不发 null**。可选数据（尺寸/文本等可能拿不到的）用条件赋值省略字段；失败路径只回 `{ ok: false, error }`。2026-09-30 已修 ds-editor-tools 四工具（screenshot/click/read/hover）。

**Applicable:** 所有 harness 插件工具的 execute 返回值设计（尤其 output.schema 声明了具体类型的字段）；新插件工具 code review 时先查 `?? null` 模式。
