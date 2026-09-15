---
name: add_image_lightbox_for_chat_thumbnails
task_type: feature
outcome: success
date: 2026-09-16
prefix: [src/components/agent/ImageLightbox.tsx, src/components/agent/MessageBubble.tsx, tests/imageLightbox.test.tsx, tests/e2e/agent/image-lightbox.spec.ts]
---
## Summary

给编辑器 agent 面板实现双击图片缩略图开浮动放大窗：模块级单例 store + AgentPanel 单宿主挂载 ImageLightbox，双击入口接 MessageBubble 用户消息图与 ToolCard read_image 图片视图，vitest 10 例 + e2e 3 例全绿

## Lessons

1. 改公共文件前先重读——本任务 ToolCard.tsx 已被并行会话实现成"read_image 渲染图片本体"，立即转增量模式：删掉自己刚建的冗余组件（ToolImagePreview/toolImage，其用的 dataUrl 契约与对方 {data,mime} 不符会 tsc 报错），只在其 img 上加 onDoubleClick。history_search 查"上次怎么做"时命中的可能是当前会话本身（刚说过同样的话），要看 session 日期甄别。2. 浮窗用模块级 store（openImageLightbox + listeners Set）+ 单宿主（AgentPanel 根部挂一次），避免 memo 化深层组件层层传 props；position fixed + z-index 20000（现有最高 16000）。3. vitest 大坑：模块级 setState（openImageLightbox 在 React 事件外调用）必须包 act()，否则 7 个用例同因"查询时 DOM 未刷"失败——fireEvent 本身被 act 包裹所以组件内 onDoubleClick 路径不受影响。4. 交互自定约定写进 doc §12.8（双击开、Esc/✕/遮罩/双击大图四条关闭路径、点击大图 stopPropagation 不关）；用户消息缩略图是 blob URL 无需 IPC，工具卡片图走 read-image-file IPC（主进程新 IPC 要重启编辑器才生效，交付时说明）。5. e2e 复用 stubAgentPage 合成历史模式（read_image 事件 + electronAPI.readImageFile stub 返回 1×1 PNG base64），naturalWidth===1 断言真渲染。

## Effective Path

src/components/agent/ImageLightbox.tsx + src/components/AgentPanel.tsx（挂载）+ tests/imageLightbox.test.tsx + tests/e2e/agent/image-lightbox.spec.ts
