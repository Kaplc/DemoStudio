# DemoStudio 项目约定

## UI 布局资产修改规则

1. **严禁直接编辑 `assets/layouts/` 目录下的 JSON 文件**
2. 所有 UI 布局资产的创建和修改必须使用 `core/assets/tools/layout_patcher.py` 提供的 API 进行操作

## UI 控件操作规则

1. 使用 `mcp_demostudio_wi_*` 工具获取控件当前状态和信息，再做出修改决策
