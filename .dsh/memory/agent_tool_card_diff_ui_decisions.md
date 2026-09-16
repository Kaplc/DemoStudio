---
name: agent_tool_card_diff_ui_decisions
description: agent 面板工具卡片六条用户决策：默认展开/不折叠/行号配色/settled 无权威 hunk 也派生兜底/头部摘要多参数 key=value 全展示/read_image 展开渲染图片本体
type: project
prefix: [src/components/agent/ToolCard.tsx, src/components/agent/toolDiff.ts, tests/e2e/agent/tool-card-diff.spec.ts]
---


**规则（2026-09-10 用户三轮反馈敲定 + 2026-09-13 第四条 + 2026-09-15 第五、六条，改这块别再改回去）：** agent 面板 write/edit 工具卡片的 diff 视图必须 ① **默认自动展开**（`useState(() => isDiffToolName(tool.name))`，点击头部仍可收起）；② **不折叠**——长 diff 全量渲染，不要「… 其余 N 行」折叠按钮（DSH WebUI 默认折到 16 行，本项目按用户要求去掉）；③ **行号列配色**：ctx 白（`--dsw-alias-label-primary`）、del 红（`--dsw-alias-state-error-primary` 且行号带 `-` 前缀）、add 绿（`--dsw-alias-state-success-primary` 且带 `+` 前缀），del/add 行另有红/绿底色；④ **无权威 hunk 的 settled success 也派生 diff**（DSH write 新建文件 `meta.diffs` 为空数组，2026-09-13 用户反馈"创建文件第一次 write 就不是 diff"）——只有 failure 才退通用输入/输出视图；⑤ **头部摘要多参数 key=value 全展示**（2026-09-15 用户反馈"grep 只显示 include 漏了 pattern"）：≥2 个单行短字符串参数按入参序以 `key=value` 拼接展示，单个仍只显示值，多行/超长值（write content、长 old_string）不进摘要；⑥ **read_image 展开渲染图片本体**（2026-09-15 用户反馈"展开就渲染目标图片而不是显示这些"）：`<img>` data URL + 路径标注**替代**原始 JSON 输入/输出，图片经 IPC `read-image-file` 现读磁盘（main.ts，根路径防护 + 扩展名白名单 png/jpg/jpeg/gif/webp/bmp），加载中抑制通用视图防闪烁，任一环失败（浏览器模式/根外路径/格式不符/文件缺失）显示失败提示行（`.tool-image--missing`，2026-09-16 加，区分"功能未生效"与"文件已删"）后回退通用视图；卡片仍默认收起，非 diff 工具不自动展开；**data URL 走模块级会话缓存**（LRU 40 条，2026-09-16 用户需求）——文件被删后只要面板未刷新/编辑器未重启，已看过的图持续可见，只缓存成功读取。

**Why:** 用户参考的是带行号 gutter + 红绿行 + 符号前缀的 diff 风格（并非 DSH WebUI 的 DiffBlock——那个没有行号、且默认折 16 行）；卡片存在的意义就是"不用点开就能看清这次改了什么"——摘要同理：卡片头要一眼看清这次调用查了什么，参数不能只显第一个；图片卡片同理：看图就是看图，转义路径 + 截断 base64 文本没有信息量。

**How to apply:** 改 `src/components/agent/ToolCard.tsx` / `toolDiff.ts` / `.tool-diff*` / `.tool-image*` 样式前先读这六条；`tests/toolCardDiff.test.tsx`（收起/再展开、30 行全量渲染、write 新建文件兜底、摘要 key=value、图片视图成功/回退）与 `tests/e2e/agent/tool-card-diff.spec.ts`（computedStyle 精确 RGB 断言 + write 新建文件合成 history + grep 摘要 + read_image 真实解码 naturalWidth=1）是这六条决策的回归锁，改动要同步更新测试而不是绕过。线上根因见 memory:dsh_tool_result_diffs_wire 陷阱③。

