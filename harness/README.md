# DemoStudio Harness

DemoStudio 仓库内的 agent 工作台：VS Code 扩展 + DSH 内核集成 + 引擎特化 agent 插件包。

> 完整设计文档：[`../doc/harness_system.md`](../doc/harness_system.md)

## 三分区结构

```
harness/
├── vscode-ext/    # VS Code 扩展工程（命令面板 + 侧边栏聊天 + 状态栏）
├── ds-engine-tools/    # DSH 插件包（5 个引擎特化工具 + 守卫 + 事件联动 + UI 槽）
├── profile/       # DSH Profile（bundles 清单 + persona 提示词 + skills 目录）
└── dsh-source/    # DSH 源码（git clone，不提交；构建后作为 vscode-ext 依赖）
```

## 实施阶段（M0-M4）

| 阶段 | 内容 | 状态 |
|---|---|---|
| **M0** | 扩展骨架：7 个命令 + 空聊天 WebviewView + 状态栏 + OutputChannel + VSIX 打包 | ✅ 当前 |
| M1 | 引擎桥（端口探测/自动拉起）+ 编辑器 SSE 推送通道 | ⏳ |
| M2 | 内核接入（dsh-headless 进程内运行）+ 事件流透传 + React 聊天 UI | ⏳ |
| M3 | 闭环（EngineBridge 工具注入 agent + 5 个引擎特化工具） | ⏳ |
| M4 | 守卫策略 + 事件联动 + 专家 persona + UI 槽 + 引擎知识技能 + 更新检查器 | ⏳ |

## M0 快速验证

```bash
cd harness/vscode-ext
npm install
npm run build      # esbuild 编译 extension.js
npm run package    # vsce package 产出 .vsix

# 安装到 VS Code
code --install-extension demostudio-harness-0.1.0.vsix

# 启动 Extension Development Host（F5）开发调试
# 打开 DemoStudio 仓库 → 侧边栏点开 DSH → 命令面板执行 7 个 DSH 命令
```

## 核心边界（架构红线）

- 扩展上层（UI/命令/EngineBridge）只依赖 `KernelAdapter` 接口（`vscode-ext/src/dsh/adapter.ts`），不感知 DSH 内部
- 工具实现只依赖 EngineBridge 或编辑器 HTTP API，不依赖 DSH 内部 API
- DSH 源码 (`harness/dsh-source/`) 只 clone 不改
- 编辑器 HTTP/SSE 端口仅绑定 `127.0.0.1`
