---
description: 使用 core/assets/tools 修改 UI 布局资产
name: edit-ui
argument-hint: 要修改的布局文件和具体操作
agent: agent
---

# 编辑 UI 布局资产

DemoStudio 的 UI 布局资产位于 `assets/layouts/` 目录，以 JSON 格式存储。
**严禁直接编辑 JSON 文件**，必须使用 `core/assets/tools` 提供的 Python API 进行修改。

## 工具入口

```python
from core.assets.tools import (
    LayoutBuilder,     # 链式 API 构建 UI 节点树
    LayoutPatcher,     # 修改已有布局（增/删/改节点）
    LayoutMerger,      # 合并多个布局
    UIPresetLibrary,   # 预制控件模板
    build_from_dict,   # 从 dict 创建 Builder
    dump_layout,       # 打印布局到控制台
    batch_patch,       # 批量修改多个布局
    print_hierarchy,   # 打印层级树
    list_widgets,      # 列出所有控件 ID
)
```

## 布局文件位置

| 文件 | 说明 |
|---|---|
| `assets/layouts/main_menu.json` | 主菜单 |
| `assets/layouts/inspector_panel.json` | 属性检查器面板 |
| `assets/layouts/settings_panel.json` | 设置面板 |

## 常见操作示例

### 1. 修改已有控件的属性

```python
from core.assets.tools import LayoutPatcher

patcher = LayoutPatcher('assets/layouts/main_menu.json')
patcher.set_prop('start_btn', 'text', '▶ 开始游戏')
patcher.set_props('start_btn', {
    'color': '#4a9f6a',
    'font_size': 0.6,
})
patcher.add_binding('start_btn', 'on_click', 'launch_game')
patcher.save()
```

### 2. 添加新控件

```python
from core.assets.tools import LayoutPatcher, UIPresetLibrary

patcher = LayoutPatcher('assets/layouts/main_menu.json')

# 使用预制模板
btn = UIPresetLibrary.accent_button('save_btn', '保存')
patcher.add_widget_node(btn, parent_id='main_win')

# 或自定义控件
patcher.add_widget(
    id='volume_slider',
    type='UISlider',
    parent_id='settings_panel',
    text='音量',
    min=0, max=100, default=50,
    anchor='TOP_LEFT', offset=[0, -0.1], size=[0.2, 0.04],
)
patcher.save()
```

### 3. 从零构建新布局

```python
from core.assets.tools import LayoutBuilder

builder = LayoutBuilder('my_panel', 'UIWindow')
builder.set_title('自定义面板').set_anchor('CENTER').set_size(0.3, 0.4)
builder.add_child('title_label', 'UIText').set_text('标题').set_font_size(0.6)
builder.add_child('ok_btn', 'UIButton').set_text('确定').set_color('#4a9f6a')
builder.save('assets/layouts/my_panel.json')
```

### 4. 删除控件

```python
patcher = LayoutPatcher('assets/layouts/main_menu.json')
patcher.remove_widget('old_btn')
patcher.save()
```

### 5. 批量修改多个布局

```python
from core.assets.tools import batch_patch

# 把所有布局中的普通按钮改为强调色
batch_patch(
    'assets/layouts/*.json',
    changes={
        'start_btn': {'color': '#4a9f6a'},
        'quit_btn': {'color': '#c0392b'},
    },
)
```

### 6. 预览布局结构

```python
from core.assets.tools import dump_layout, print_hierarchy, list_widgets

# 打印完整布局
dump_layout('assets/layouts/main_menu.json')

# 打印层级树
print_hierarchy('assets/layouts/main_menu.json')

# 列出所有控件 ID
print(list_widgets('assets/layouts/main_menu.json'))
```

## JSON 布局结构说明

```json
{
    "$schema": "1.0",
    "metadata": { "name": "...", "version": "1.0" },
    "variables": { "my_var": "#ff0000" },
    "ui": {
        "type": "UIWindow",
        "id": "root",
        "children": [ ... ]
    },
    "bindings": {
        "btn_id": { "on_click": "handler_name" }
    }
}
```

- 支持变量引用：`$var_name` 从 variables 或主题解析
- 支持主题色：`$accent`, `$button.normal`, `$window.title_bar`
- 支持 18 种控件类型（UIButton, UIToggle, UISlider, UIInputField 等）

## 规则

1. **禁止直接修改 `.json` 布局文件** — 必须通过 Python API 操作
2. 修改后执行 `patcher.save()` 写回文件
3. 添加新控件优先使用 `UIPresetLibrary` 预制模板
4. 复杂布局用 `LayoutBuilder` 链式构建，清晰可读
5. 运行 `dump_layout()` 预览修改结果
