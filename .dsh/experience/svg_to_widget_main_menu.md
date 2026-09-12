---
name: svg_to_widget_main_menu
task_type: feature/ui-asset
outcome: success
date: 2026-09-12
prefix: [projects/warm-current/asset/ui/warm-main-menu.svg, projects/warm-current/asset/blueprints/ui/main_menu.widget.html, e2e/warm/main_menu.spec.ts]
---
## Summary

把 warm-main-menu.svg 设计稿落地为主菜单 widget（保留 Btn_new/Btn_load 脚本契约，SETTINGS/EXIT 按用户决策占位禁用），MCP HTTP 直调 ui_compile 过零错误门禁，截图发现白色行星球与标题不渲染两个视觉 bug，变量隔离实验定位根因修复，新增契约 vitest 12 例 + 运行时 e2e 4 例全绿，warm 全量回归零新增红。

## Lessons

有效路径：① SVG→引擎 CSS 近似手法：radial-gradient 不可用→对角 linear-gradient；辉光→低透明同心圆叠层；SVG 椭圆轨道环→低透明填充盘面 + transform:rotate（编译发射 UITransform rotation.z，视觉旋转不参与布局）；圆形描边→同心圆叠层（圆角元素上 CSS border 发射直边条+警告）；行星表面波浪→overflow:hidden 的有色元素内放旋转条带。② 编译通道：编辑器 electron main 有 HTTP MCP API（127.0.0.1:9877 起，占用递增到 9927），POST /api/command {command:'ui_compile', params:{asset:'…widget.json'}} 带完整 assetLint 门禁——比 CLI（无门禁）靠谱，脚本探端口循环即可。③ e2e 两个新坑：page.evaluate 的 IIFE 字符串漏了调用括号 `()`（`(() => {...})` 形式 playwright 求值为函数→序列化 undefined）；对象属性里插辅助函数 `${FN}` 存的是函数本身，必须 `(FN)(arg)` 立即调用——两者都表现为 received undefined。④ 视觉 bug 排查利器：ai.setProperty 运行时变量隔离（bold on/off 逐项截图对比，一次锁定不渲染变量），配合 test-results 截图 clip 局部区域。⑤ 门禁基线口径：warm 全量 10 红 = 既有 5（点击冷却×2/二级按钮/航线多船/存档桥断言过时/开局取景）+ hologram/ring_tooltip 单跑绿（全量并行负载抖动）+ tmp_* 临时探针（并行会话已删）；工作区有并行功能线（hologram 矿产）未提交改动，甄别红因先看 git status 别误修别人的线。

## Effective Path

["projects/warm-current/asset/blueprints/ui/main_menu.widget.html", "e2e/warm/main_menu.spec.ts", "tests/warmMainMenuWidget.test.ts"]
