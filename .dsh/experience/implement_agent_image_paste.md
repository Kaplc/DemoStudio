---
name: implement_agent_image_paste
task_type: feature
outcome: success
date: 2026-09-10
prefix: src/components/agent || src/editor
---
## Summary

给编辑器 agent 面板实现 Ctrl+V 粘贴图片随消息发送：InputBox paste 拦截 → 面板按会话图片草稿 → AgentService 编码 base64 组装 session.prompt content（image part + text part），vitest 全分支 + Playwright e2e（拦截 session.prompt 断言请求体）双验证通过；上线后用户实测发现缩略图空白，根因是 CSP img-src 缺 blob:，已修复并把「naturalWidth>0 断言」补进 e2e。

## Lessons

有效路径：① 协议别自创——DSH WebUI 参考实现集中在 dsh-client-ui-conversation/lib/client.js 的 sendSession/serializeImages/encodeImage（image part 线上格式 {type:'image', mediaType, data 纯base64, name?}，图片 parts 在前 text 在后，MIME 白名单 png/jpeg/webp/gif），grep 'paste|addImages|imageIds' 顺藤摸瓜；② 编辑器侧只动 5 处：types（PendingImage/PromptContentPart/Message.images）、AgentService.buildPromptContent、InputBox（paste+缩略图 rail+isEmpty 含图）、AgentPanel（按会话草稿 map，对齐 draftsBySession 模式）、MessageBubble（user 消息渲染缩略图）；③ e2e 无副作用模式：页面内 hook window.fetch 拦 '/api/session.prompt' 记录 init.body 返回伪响应 {result:{ok:true,value:{}}}，可直接断言 RPC 请求体而不触发真回合；'?agentWindow=1' 直进 agent 面板无需打开工程。踩坑：④ blob: 图片必须进 CSP——agent.html/index.html 的 img-src 原来只有 'self' data:，createObjectURL 的缩略图被拦成空白框（rail 出现但图不渲染）；用户实测截图暴露，e2e 的 toBeVisible 抓不住（CSP 拦截时 img 容器仍有尺寸），必须断言 img.complete && naturalWidth > 0，且用「回滚修复→断言失败→恢复修复→断言通过」双向证明断言有效；⑤ jsdom 测试里 Uint8Array.from(atob(s)) 把字母变 NaN→0（长度对内容全零），须 charCodeAt 映射，别误诊成环境 bug；⑥ tests/e2e 的 playwright.config.ts 在 tests/e2e/ 目录下（testDir '.'），根目录跑要 -c tests/e2e/playwright.config.ts + 名字过滤；dev server 常只监听 ::1:5173（IPv6 回环）。
