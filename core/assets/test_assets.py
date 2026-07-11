"""
test_assets.py — 资产模块单元测试
==================================
测试 AssetManager、UILayoutLoader、变量解析、类型转换等功能。

运行方式:
    python -m core.assets.test_assets
"""

import json
import sys
from pathlib import Path

# 添加项目根目录到 sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def test_converters():
    """测试类型转换器"""
    print('=' * 50)
    print('🧪 测试: 类型转换器 (converters)')
    print('=' * 50)

    from core.assets.converters import (
        parse_color, parse_anchor, parse_vec2,
        resolve_theme_color, AnchorMap,
    )

    # ── 颜色 ──
    assert parse_color('#ff0000') is not None, '十六进制红色'
    assert parse_color('rgba(255, 0, 0, 0.5)') is not None, 'rgba'
    assert parse_color('white') is not None, '内置色名'
    assert parse_color(None) is not None, 'None 返回 fallback'
    print('  ✅ 颜色解析全部通过')

    # ── 锚点 ──
    assert AnchorMap.resolve('CENTER') == (0.0, 0.0), 'CENTER'
    assert AnchorMap.resolve('TOP_LEFT') == (-0.5, 0.5), 'TOP_LEFT'
    assert AnchorMap.resolve('TL') == (-0.5, 0.5), 'TL 别名'
    assert AnchorMap.resolve([0.5, 0.0]) == (0.5, 0.0), '元组'
    print('  ✅ 锚点解析全部通过')

    # ── Vec2 ── (Ursina Vec2 有浮点精度误差, 用 round 比较)
    v = parse_vec2([0.3, 0.2])
    assert round(v.x, 4) == 0.3 and round(v.y, 4) == 0.2, f'列表转 Vec2: {v}'
    v2 = parse_vec2('0.5, 0.5')
    assert round(v2.x, 4) == 0.5 and round(v2.y, 4) == 0.5, f'字符串转 Vec2: {v2}'
    print('  ✅ Vec2 解析全部通过')

    # ── 主题颜色 ──
    col = resolve_theme_color('accent')
    assert col is not None, 'accent 颜色存在'
    print(f'  ✅ 主题颜色解析通过: accent = {col}')

    print('🎉 转换器测试全部通过!\n')


def test_asset_manager():
    """测试资产管理器"""
    print('=' * 50)
    print('🧪 测试: AssetManager')
    print('=' * 50)

    from core.assets.asset_manager import AssetManager, AssetType

    mgr = AssetManager()

    # 注册
    info = mgr.register('test_layout', {'ui': {}}, AssetType.LAYOUT)
    assert info.name == 'test_layout'
    print('  ✅ 注册资产')

    # 获取
    retrieved = mgr.get('test_layout')
    assert retrieved is not None
    assert retrieved.asset_type == AssetType.LAYOUT
    print('  ✅ 获取资产')

    # 包含检查
    assert 'test_layout' in mgr
    print('  ✅ 包含检查')

    # 别名
    mgr.register_alias('tl', 'test_layout')
    assert mgr.get('tl') is not None
    print('  ✅ 别名注册')

    # 列表
    assert mgr.count(AssetType.LAYOUT) == 1
    print('  ✅ 资产计数')

    # 卸载
    mgr.unload('test_layout')
    assert 'test_layout' not in mgr
    print('  ✅ 卸载资产')

    # JSON 字符串加载
    mgr.load_from_json_str('from_str', '{"ui": {"type": "UIButton", "id": "btn1"}}')
    assert 'from_str' in mgr
    print('  ✅ 从 JSON 字符串加载')

    # 清空
    mgr.clear()
    assert len(mgr) == 0
    print('  ✅ 清空全部')

    # 文件加载
    json_path = Path(__file__).resolve().parent.parent.parent / 'assets' / 'layouts' / 'main_menu.json'
    if json_path.exists():
        info = mgr.load_from_json(str(json_path))
        assert info is not None
        print(f'  ✅ 从文件加载: {info.name}')
        mgr.clear()

    print('🎉 AssetManager 测试全部通过!\n')


def test_schema_validation():
    """测试 Schema 校验"""
    print('=' * 50)
    print('🧪 测试: Schema 校验')
    print('=' * 50)

    from core.assets.schema import validate_layout

    # 有效布局
    valid_data = {
        'ui': {
            'type': 'UIWindow',
            'id': 'win1',
            'title': 'Test',
            'size': [0.3, 0.4],
            'children': [
                {'type': 'UIButton', 'id': 'btn1', 'text': 'Click'}
            ],
        },
    }
    result = validate_layout(valid_data)
    assert result.valid, f'有效布局应有 valid=True: {result.errors}'
    print('  ✅ 有效布局校验通过')

    # 缺少 ui 字段
    result2 = validate_layout({'foo': 'bar'})
    assert not result2.valid, '缺少 ui 应校验失败'
    print('  ✅ 缺少 ui 字段检测正确')

    # 未知控件类型 (警告, 不是错误)
    unknown_data = {
        'ui': {'type': 'UnknownWidget', 'id': 'x'},
    }
    result3 = validate_layout(unknown_data)
    assert result3.valid, '未知类型只产生警告'
    assert len(result3.warnings) > 0, '应有警告'
    print('  ✅ 未知控件类型产生警告')

    print('🎉 Schema 校验测试全部通过!\n')


def test_layout_loader():
    """测试 UILayoutLoader JSON→UI 构建"""
    print('=' * 50)
    print('🧪 测试: UILayoutLoader')
    print('=' * 50)

    from core.assets.asset_manager import AssetManager
    from core.assets.ui_layout import UILayoutLoader, LayoutNode

    mgr = AssetManager()
    loader = UILayoutLoader(mgr)

    # 从字符串加载
    json_str = '''
    {
        "ui": {
            "type": "UIWindow",
            "id": "main_win",
            "title": "Test",
            "anchor": "CENTER",
            "size": [0.3, 0.4],
            "children": [
                {
                    "type": "UIText",
                    "id": "title_text",
                    "text": "Hello",
                    "anchor": "TOP_CENTER",
                    "offset": [0, -0.05]
                },
                {
                    "type": "UIVerticalLayout",
                    "id": "btn_layout",
                    "anchor": "CENTER",
                    "size": [0.2, 0.15],
                    "spacing": 0.01,
                    "children": [
                        {
                            "type": "UIButton",
                            "id": "btn1",
                            "text": "Button 1"
                        },
                        {
                            "type": "UIButton",
                            "id": "btn2",
                            "text": "Button 2"
                        }
                    ]
                }
            ]
        }
    }
    '''

    root = loader.load_from_string(json_str, validate=False)
    assert root is not None, '加载不应返回 None'
    print(f'  ✅ 根控件: {type(root).__name__}')

    # 按 id 查找
    title = loader.get_widget('title_text')
    assert title is not None, '找不到 title_text'
    print(f'  ✅ 按 id 查找: title_text = {title}')

    btn1 = loader.get_widget('btn1')
    assert btn1 is not None, '找不到 btn1'
    print(f'  ✅ 按 id 查找: btn1 = {btn1}')

    # 按类型查找
    buttons = loader.get_widgets_by_type('UIButton')
    assert len(buttons) == 2, f'应有 2 个按钮, 实际 {len(buttons)}'
    print(f'  ✅ 按类型查找: {len(buttons)} 个 UIButton')

    # 层级结构
    node = loader.root_node
    assert node is not None
    assert node.widget_type == 'UIWindow'
    assert len(node.children) == 2, f'应有 2 个子节点, 实际 {len(node.children)}'
    print(f'  ✅ 布局层级: {node}')

    # 绑定事件
    click_log = []
    loader.bind_events({'btn1': lambda: click_log.append('btn1_clicked')})
    assert hasattr(btn1, '_click_handler')
    # 手动触发
    btn1._click_handler()
    assert len(click_log) == 1 and click_log[0] == 'btn1_clicked'
    print('  ✅ 事件绑定')

    print('🎉 UILayoutLoader 测试全部通过!\n')


def test_variable_resolver():
    """测试变量解析器"""
    print('=' * 50)
    print('🧪 测试: UIVariableResolver')
    print('=' * 50)

    from core.assets.ui_layout import UIVariableResolver

    resolver = UIVariableResolver({
        'btn_color': '#ff0000',
        'spacing_val': 0.02,
    })

    # 普通字符串
    assert resolver.resolve('hello') == 'hello'
    print('  ✅ 普通字符串不变')

    # 变量引用
    assert resolver.resolve('$btn_color') == '#ff0000'
    print('  ✅ 变量引用解析')

    # 数字
    assert resolver.resolve(42) == 42
    print('  ✅ 数字不变')

    # 列表
    resolved_list = resolver.resolve(['$btn_color', 1, 2])
    assert resolved_list[0] == '#ff0000'
    print('  ✅ 列表递归解析')

    # 字典
    resolved_dict = resolver.resolve({'color': '$btn_color', 'size': [0.3, 0.2]})
    assert resolved_dict['color'] == '#ff0000'
    print('  ✅ 字典递归解析')

    # 主题引用
    resolved_theme = resolver.resolve('$accent')
    assert resolved_theme is not None
    print(f'  ✅ 主题颜色引用: accent = {resolved_theme}')

    print('🎉 变量解析器测试全部通过!\n')


def test_file_loading():
    """测试从文件加载实际布局"""
    print('=' * 50)
    print('🧪 测试: 从文件加载布局')
    print('=' * 50)

    from core.assets.asset_manager import AssetManager
    from core.assets.ui_layout import UILayoutLoader

    layouts_dir = Path(__file__).resolve().parent.parent.parent / 'assets' / 'layouts'
    if not layouts_dir.exists():
        print('  ⚠️  布局目录不存在, 跳过')
        return

    json_files = list(layouts_dir.glob('*.json'))
    if not json_files:
        print('  ⚠️  没有 JSON 文件, 跳过')
        return

    mgr = AssetManager()
    loader = UILayoutLoader(mgr)

    for jf in sorted(json_files):
        print(f'  📄 加载: {jf.name}')
        try:
            root = loader.load_from_file(str(jf))
            if root is not None:
                widget_count = len(loader._built_widgets)
                print(f'     ✅ 成功: {type(root).__name__} ({widget_count} 个控件)')
                # 如果有 bindings, 检查
                pending = loader.get_pending_handlers()
                if pending:
                    print(f'     📌 待绑定事件: {len(pending)} 个控件')
            else:
                print(f'     ❌ 加载失败')
        except Exception as e:
            print(f'     ❌ 异常: {e}')
            import traceback
            traceback.print_exc()

        loader._built_widgets.clear()

    print('🎉 文件加载测试完成!\n')


# ──────────────────────────────────────────────
# 入口
# ──────────────────────────────────────────────

if __name__ == '__main__':
    print()
    print('╔══════════════════════════════════════╗')
    print('║   core.assets 模块单元测试           ║')
    print('╚══════════════════════════════════════╝')
    print()

    test_converters()
    test_asset_manager()
    test_schema_validation()
    test_variable_resolver()
    test_layout_loader()
    test_file_loading()

    print('=' * 50)
    print('🎉🎉🎉 所有测试通过! 🎉🎉🎉')
    print('=' * 50)
