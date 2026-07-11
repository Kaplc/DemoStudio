"""
test_tools.py — 资产编辑工具单元测试
=====================================
测试 LayoutBuilder / LayoutPatcher / LayoutMerger / UIPresetLibrary

运行:
    python -m core.assets.tools.test_tools
"""

import sys, json, tempfile, os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def test_layout_builder():
    """测试 LayoutBuilder 链式 API"""
    print('=' * 50)
    print('🧪 测试: LayoutBuilder')
    print('=' * 50)

    from core.assets.tools.layout_builder import LayoutBuilder

    # 构建一个完整布局
    builder = LayoutBuilder('main_win', 'UIWindow')
    builder.set_title('Test Window')
    builder.set_anchor('CENTER')
    builder.set_size(0.4, 0.5)
    builder.set_color('#16213e')
    builder.set_closable(False)

    builder.add_child('title_text', 'UIText')
    builder.set_text('Hello')
    builder.set_anchor('TOP_CENTER')
    builder.set_offset(0, -0.08)
    builder.set_font_size(1.4)
    builder.set_color('$accent')
    builder.up()

    builder.add_child('btn_layout', 'UIVerticalLayout')
    builder.set_anchor('CENTER')
    builder.set_size(0.3, 0.18)
    builder.set_spacing(0.01)

    builder.add_child('start_btn', 'UIButton')
    builder.set_text('▶ Start')
    builder.set_color('#4a9f6a')
    builder.set_highlight_color('#5abf7a')
    builder.up()

    builder.add_child('quit_btn', 'UIButton')
    builder.set_text('✕ Quit')
    builder.set_color('#e94560')
    builder.set_highlight_color('#ff6b81')
    builder.up().up().up()

    # 设置元数据 / 变量 / 绑定
    builder.set_metadata('name', 'Test Menu')
    builder.set_metadata('version', '1.0.0')
    builder.set_variable('btn_w', 0.25)
    builder.set_binding('start_btn', 'on_click', 'start_game')
    builder.set_binding('quit_btn', 'on_click', 'quit_game')

    result = builder.to_dict()

    # 验证
    assert result['$schema'] == '1.0'
    assert result['metadata']['name'] == 'Test Menu'
    assert result['variables']['btn_w'] == 0.25
    assert result['ui']['type'] == 'UIWindow'
    assert result['ui']['id'] == 'main_win'
    assert result['ui']['title'] == 'Test Window'
    assert len(result['bindings']) == 2

    # 检查子节点
    children = result['ui']['children']
    assert len(children) == 2
    assert children[0]['id'] == 'title_text'
    assert children[1]['id'] == 'btn_layout'

    # 检查嵌套
    btn_layout = children[1]
    assert len(btn_layout['children']) == 2
    assert btn_layout['children'][0]['id'] == 'start_btn'
    assert btn_layout['children'][1]['id'] == 'quit_btn'

    # 导出 JSON
    json_str = builder.to_json()
    assert '"type": "UIWindow"' in json_str
    assert '"start_game"' in json_str

    print('  ✅ 链式构建')
    print('  ✅ 嵌套子控件')
    print('  ✅ 变量/绑定/元数据')
    print('  ✅ JSON 导出')

    # 测试 from_dict
    from core.assets.tools.layout_builder import build_from_dict
    restored = build_from_dict(result)
    assert restored._root['id'] == 'main_win'
    assert restored._metadata['name'] == 'Test Menu'
    print('  ✅ build_from_dict 还原')

    print('🎉 LayoutBuilder 测试通过!\n')


def test_layout_builder_factories():
    """测试 LayoutBuilder 工厂方法"""
    print('=' * 50)
    print('🧪 测试: LayoutBuilder 工厂')
    print('=' * 50)

    from core.assets.tools.layout_builder import LayoutBuilder

    btn = LayoutBuilder.create_button('b1', 'Click')
    assert btn['type'] == 'UIButton'
    assert btn['id'] == 'b1'
    assert btn['text'] == 'Click'

    win = LayoutBuilder.create_window('w1', 'Window')
    assert win['type'] == 'UIWindow'
    assert win['title'] == 'Window'

    label = LayoutBuilder.create_label('l1', 'Label')
    assert label['type'] == 'UIText'
    assert label['text'] == 'Label'

    inp = LayoutBuilder.create_input('i1', 'Enter...')
    assert inp['type'] == 'UIInputField'
    assert inp['placeholder'] == 'Enter...'

    slider = LayoutBuilder.create_slider('s1')
    assert slider['type'] == 'UISlider'

    toggle = LayoutBuilder.create_toggle('t1', 'Enable')
    assert toggle['type'] == 'UIToggle'

    cb = LayoutBuilder.create_checkbox('c1', 'Option')
    assert cb['type'] == 'UICheckbox'

    dd = LayoutBuilder.create_dropdown('d1', ['A', 'B'])
    assert dd['type'] == 'UIDropdown'

    sep = LayoutBuilder.create_separator('sep1')
    assert sep['type'] == 'UISeparator'

    vl = LayoutBuilder.create_vlayout('vl1')
    assert vl['type'] == 'UIVerticalLayout'

    hl = LayoutBuilder.create_hlayout('hl1')
    assert hl['type'] == 'UIHorizontalLayout'

    grid = LayoutBuilder.create_grid('g1', cols=4)
    assert grid['type'] == 'UIGridLayout'
    assert grid['cols'] == 4

    print(f'  ✅ 12 个工厂方法全部通过')
    print('🎉 工厂测试通过!\n')


def test_layout_patcher():
    """测试 LayoutPatcher"""
    print('=' * 50)
    print('🧪 测试: LayoutPatcher')
    print('=' * 50)

    from core.assets.tools.layout_patcher import LayoutPatcher

    # 创建测试布局
    test_data = {
        'metadata': {'name': 'Test', 'version': '1.0'},
        'variables': {'bg': '#1a1a2e'},
        'ui': {
            'type': 'UIWindow', 'id': 'win',
            'title': 'Test',
            'children': [
                {'type': 'UIButton', 'id': 'btn1', 'text': 'Old Text',
                 'color': '#4a6fa5'},
                {'type': 'UIPanel', 'id': 'panel1', 'title': 'Panel',
                 'children': [
                     {'type': 'UIText', 'id': 'label1', 'text': 'Hello'},
                 ]},
            ],
        },
        'bindings': {'btn1': {'on_click': 'old_handler'}},
    }

    patcher = LayoutPatcher(data=test_data)

    # 查找
    assert patcher.widget_exists('btn1')
    assert patcher.widget_exists('label1')
    assert not patcher.widget_exists('ghost')

    btn = patcher.find_widget('btn1')
    assert btn['id'] == 'btn1'

    label = patcher.find_widget('label1')
    assert label['text'] == 'Hello'
    print('  ✅ 查找控件')

    # 按类型查找
    buttons = patcher.find_widgets_by_type('UIButton')
    assert len(buttons) == 1
    print('  ✅ 按类型查找')

    # 修改属性
    patcher.set_prop('btn1', 'text', '▶ New Text')
    patcher.set_prop('btn1', 'color', '#ff0000')
    assert patcher.get_widget_prop('btn1', 'text') == '▶ New Text'
    print('  ✅ 设置属性')

    # 批量修改
    patcher.set_props('btn1', {'font_size': 1.2, 'highlight_color': '#5abf7a'})
    assert patcher.get_widget_prop('btn1', 'font_size') == 1.2
    print('  ✅ 批量设置')

    # 移除属性
    patcher.remove_prop('btn1', 'font_size')
    assert patcher.get_widget_prop('btn1', 'font_size') is None
    print('  ✅ 移除属性')

    # 添加子控件
    patcher.add_widget('new_btn', 'UIButton', parent_id='win',
                       text='New', color='#e94560')
    assert patcher.widget_exists('new_btn')
    new_btn = patcher.find_widget('new_btn')
    assert new_btn['text'] == 'New'
    print('  ✅ 添加子控件')

    # 添加节点
    from core.assets.tools.layout_builder import LayoutBuilder
    node = LayoutBuilder.create_button('factory_btn', 'Factory', color='#4a9f6a')
    patcher.add_widget_node(node, parent_id='panel1')
    assert patcher.widget_exists('factory_btn')
    print('  ✅ 添加预制节点')

    # 移除控件
    patcher.remove_widget('new_btn')
    assert not patcher.widget_exists('new_btn')
    print('  ✅ 移除控件')

    # 重命名
    patcher.rename_widget_id('btn1', 'btn_renamed')
    assert patcher.widget_exists('btn_renamed')
    assert not patcher.widget_exists('btn1')
    patcher.rename_widget_id('btn_renamed', 'btn1')  # 改回来
    print('  ✅ 重命名控件')

    # 变量管理
    patcher.set_variable('new_var', '#ff0000')
    assert patcher.get_variable('new_var') == '#ff0000'
    patcher.remove_variable('new_var')
    assert patcher.get_variable('new_var') is None
    print('  ✅ 变量管理')

    # 绑定管理
    patcher.add_binding('btn1', 'on_click', 'new_handler')
    assert patcher.list_bindings()['btn1']['on_click'] == 'new_handler'
    patcher.remove_binding('btn1', 'on_click')
    assert 'on_click' not in patcher.list_bindings().get('btn1', {})
    print('  ✅ 绑定管理')

    # 清空子控件
    patcher.clear_children('panel1')
    assert len(patcher.find_widget('panel1').get('children', [])) == 0
    print('  ✅ 清空子控件')

    # 复制控件
    patcher.duplicate_widget('btn1', new_id='btn1_copy', parent_id='win')
    assert patcher.widget_exists('btn1_copy')
    print('  ✅ 复制控件')

    # 移动控件
    patcher.move_widget('btn1_copy', new_parent_id='panel1')
    moved = patcher.find_widget('btn1_copy')
    # 检查是否在 panel1 下
    panel = patcher.find_widget('panel1')
    assert any(c.get('id') == 'btn1_copy' for c in panel.get('children', []))
    print('  ✅ 移动控件')

    # 列表 IDs
    ids = patcher.list_widget_ids()
    assert len(ids) >= 4, f'应有至少 4 个控件, 实际 {len(ids)}'
    print(f'  ✅ 列出控件: {len(ids)} 个')

    # 统计
    count = patcher.count_widgets()
    assert count == len(ids)
    print(f'  ✅ 统计: {count} 个控件')

    # 保存到临时文件
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tf:
        tmp_path = tf.name
    try:
        patcher.save_as(tmp_path)
        with open(tmp_path) as f:
            saved = json.load(f)
        assert saved['metadata']['name'] == 'Test'
        assert saved['ui']['children'][0]['text'] == '▶ New Text'
        print('  ✅ 保存文件')
    finally:
        os.unlink(tmp_path)

    print('🎉 LayoutPatcher 测试通过!\n')


def test_layout_merger():
    """测试 LayoutMerger"""
    print('=' * 50)
    print('🧪 测试: LayoutMerger')
    print('=' * 50)

    from core.assets.tools.layout_merger import LayoutMerger

    base = {
        'metadata': {'name': 'Base', 'version': '1.0'},
        'variables': {'color': '#fff', 'size': 1.0},
        'bindings': {'btn1': {'on_click': 'base_handler'}},
        'ui': {
            'type': 'UIWindow', 'id': 'win',
            'title': 'Base Window',
            'children': [
                {'type': 'UIButton', 'id': 'btn1', 'text': 'Base Btn',
                 'color': '#4a6fa5'},
                {'type': 'UIText', 'id': 'label1', 'text': 'Base Label'},
            ],
        },
    }

    overlay = {
        'metadata': {'author': 'OverlayAuthor'},
        'variables': {'color': '#000'},  # 覆盖
        'bindings': {'btn1': {'on_click': 'overlay_handler'}},
        'ui': {
            'type': 'UIWindow', 'id': 'win',
            'children': [
                {'type': 'UIButton', 'id': 'btn1', 'text': 'Overlay Btn'},
                {'type': 'UIButton', 'id': 'new_btn', 'text': 'New Button'},
            ],
        },
    }

    merger = LayoutMerger()
    result = merger.merge(base, overlay)

    # Metadata: overlay 覆盖 base
    assert result['metadata']['name'] == 'Base'
    assert result['metadata']['author'] == 'OverlayAuthor'

    # Variables: overlay 覆盖
    assert result['variables']['color'] == '#000'
    assert result['variables']['size'] == 1.0  # 保留

    # Bindings: overlay 覆盖
    assert result['bindings']['btn1']['on_click'] == 'overlay_handler'

    # UI: 同 id 覆盖, 新 id 追加
    ui = result['ui']
    assert ui['title'] == 'Base Window'  # overlay 没设 title, 保留 base
    children = ui['children']
    assert len(children) == 3  # btn1(覆盖) + label1(保留) + new_btn(新增)
    assert children[0]['text'] == 'Overlay Btn'  # 被覆盖
    assert children[1]['id'] == 'label1'  # 保留
    assert children[2]['id'] == 'new_btn'  # 新增

    print('  ✅ metadata/variables/bindings 合并')
    print('  ✅ 子节点同 id 覆盖')
    print('  ✅ 子节点新增追加')
    print('  ✅ 子节点保留')

    # 测试 diff
    diff = LayoutMerger.diff(base, overlay)
    assert 'ui' in diff
    assert diff['bindings']['btn1']['on_click'] == 'overlay_handler'

    print('  ✅ 差异比较')

    print('🎉 LayoutMerger 测试通过!\n')


def test_ui_presets():
    """测试 UIPresetLibrary"""
    print('=' * 50)
    print('🧪 测试: UIPresetLibrary')
    print('=' * 50)

    from core.assets.tools.layout_presets import UIPresetLibrary as P

    # 单控件模板
    btn = P.accent_button('confirm_btn', 'Confirm')
    assert btn['type'] == 'UIButton'
    assert btn['text'] == 'Confirm'
    assert btn['color'] == '$accent'

    dbtn = P.danger_button('del_btn', 'Delete')
    assert dbtn['color'] == '#e94560'

    sbtn = P.success_button('save_btn', 'Save')
    assert sbtn['color'] == '#4a9f6a'

    label = P.title_label('title', 'Big Title')
    assert label['text'] == 'Big Title'
    assert label['font_size'] == 1.2

    print('  ✅ 单控件模板 (accent/danger/success/label)')

    # 容器模板
    win = P.window('w1', 'My Window')
    assert win['type'] == 'UIWindow'
    assert win['title'] == 'My Window'

    panel = P.panel('p1', 'My Panel')
    assert panel['type'] == 'UIPanel'

    gb = P.groupbox('g1', 'Group')
    assert gb['type'] == 'UIGroupBox'

    sv = P.scroll_view('sv1')
    assert sv['type'] == 'UIScrollView'

    sep = P.separator('sep1')
    assert sep['type'] == 'UISeparator'

    print('  ✅ 容器模板')

    # 组合布局
    dialog = P.confirm_dialog('cd1', 'Are you sure?')
    assert dialog['type'] == 'UIDialog'
    assert dialog['message'] == 'Are you sure?'

    pb = P.progress_bar('pb1')
    assert pb['type'] == 'UIProgressBar'

    print('  ✅ 组合布局模板')

    # 复合控件
    labeled = P.labeled_input('username', 'Username:', 'Enter name...')
    assert 'children' in labeled
    children = labeled['children']
    assert len(children) >= 2
    print('  ✅ 带标签输入框')

    slider_group = P.labeled_slider('vol', 'Volume:', 0, 100, 80)
    assert 'children' in slider_group
    print('  ✅ 带标签滑块')

    # 按钮栏
    bar = P.button_bar('btn_bar', [
        {'id': 'ok', 'text': 'OK', 'color': '#4a9f6a'},
        {'id': 'cancel', 'text': 'Cancel', 'color': '#5a5a6a'},
    ])
    assert bar['type'] == 'UIHorizontalLayout'
    assert len(bar['children']) == 2
    print('  ✅ 按钮栏')

    # 表单组
    form = P.form_group('form1', [
        ('name_input', 'Name:', 'input', {'placeholder': 'Enter name'}),
        ('age_slider', 'Age:', 'slider', {'min': 0, 'max': 150, 'default': 30}),
        ('active_toggle', '', 'checkbox', {'text': 'Active', 'default': True}),
    ], title='User Info')
    assert form['type'] == 'UIGroupBox'
    print('  ✅ 表单组')

    # 编辑器片段
    toolbar = P.editor_toolbar('tb')
    assert toolbar['id'] == 'tb'
    status = P.editor_status_bar('sb')
    assert status['id'] == 'sb'
    print('  ✅ 编辑器工具栏/状态栏模板')

    print('🎉 UIPresetLibrary 测试通过!\n')


def test_end_to_end():
    """端到端测试: 构建 → 保存 → 加载 → 修改 → 导出"""
    print('=' * 50)
    print('🧪 端到端测试')
    print('=' * 50)

    import tempfile, os
    from core.assets.tools.layout_builder import LayoutBuilder, build_from_dict
    from core.assets.tools.layout_patcher import LayoutPatcher
    from core.assets.tools.layout_merger import LayoutMerger
    from core.assets.tools.layout_presets import UIPresetLibrary as P

    # 1. Builder 构建
    builder = LayoutBuilder('main_menu', 'UIWindow')
    builder.set_title('DemoStudio').set_anchor('CENTER').set_size(0.4, 0.5)
    builder.set_metadata('name', 'End-to-End Test')
    builder.set_variable('btn_w', 0.25)

    builder.add_child('title', 'UIText')
    builder.set_text('Welcome').set_anchor('TOP_CENTER').set_offset(0, -0.08)
    builder.set_color('$accent').set_font_size(1.4)
    builder.up()

    builder.add_child('start_btn', 'UIButton')
    builder.set_text('Start').set_color('#4a9f6a')
    builder.set_binding('start_btn', 'on_click', 'start_game')
    builder.up()

    builder.add_child('quit_btn', 'UIButton')
    builder.set_text('Quit').set_color('#e94560')
    builder.set_binding('quit_btn', 'on_click', 'quit_game')

    # 2. 保存到临时文件
    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as tf:
        tmp_path = tf.name
    try:
        builder.save(tmp_path)

        # 3. Patcher 修改
        patcher = LayoutPatcher(tmp_path)
        patcher.set_prop('start_btn', 'text', '▶ Launch')
        patcher.set_prop('start_btn', 'highlight_color', '#5abf7a')
        patcher.add_widget(
            'settings_btn', 'UIButton', parent_id='main_menu',
            text='⚙ Settings', color='$primary_color',
        )
        patcher.add_binding('settings_btn', 'on_click', 'open_settings')

        # 4. 保存修改
        patcher.save()

        # 5. 验证结果
        with open(tmp_path) as f:
            final = json.load(f)

        # 检查元数据
        assert final['metadata']['name'] == 'End-to-End Test'
        assert final['variables']['btn_w'] == 0.25

        # 检查根节点
        root = final['ui']
        assert root['type'] == 'UIWindow'
        assert root['title'] == 'DemoStudio'

        # 检查子节点
        children = root['children']
        # 原有: title + start_btn + quit_btn, 新增: settings_btn
        assert len(children) == 4, f'应有 4 个子节点, 实际 {len(children)}'
        # quit_btn 因为在 builder 里没有 up() 回 root, 所以挂在 start_btn 下

        # 检查绑定
        assert 'start_btn' in final['bindings']
        assert final['bindings']['start_btn']['on_click'] == 'start_game'

        print('  ✅ Builder → Patcher 端到端流程')
        print('  ✅ JSON 文件读写正确')
        print('  ✅ 属性修改 & 绑定管理正确')

    finally:
        os.unlink(tmp_path)

    print('🎉 端到端测试通过!\n')


def test_cli_tools():
    """测试 CLI 工具函数"""
    print('=' * 50)
    print('🧪 测试: CLI 工具')
    print('=' * 50)

    from core.assets.tools.ui_cli import list_widgets

    # 用测试数据测试 list_widgets
    # 构造一个临时文件
    test_data = {
        'ui': {
            'type': 'UIWindow', 'id': 'win',
            'children': [
                {'type': 'UIButton', 'id': 'btn1'},
                {'type': 'UIText', 'id': 'label1'},
            ],
        },
    }

    import tempfile, os
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tf:
        json.dump(test_data, tf)
        tmp_path = tf.name

    try:
        ids = list_widgets(tmp_path)
        assert 'win' in ids
        assert 'btn1' in ids
        assert 'label1' in ids
        assert len(ids) == 3
        print('  ✅ list_widgets')
    finally:
        os.unlink(tmp_path)

    print('🎉 CLI 工具测试通过!\n')


# ──────────────────────────────────────────────
# 入口
# ──────────────────────────────────────────────

if __name__ == '__main__':
    print()
    print('╔══════════════════════════════════════╗')
    print('║   core.assets.tools 单元测试         ║')
    print('╚══════════════════════════════════════╝')
    print()

    test_layout_builder()
    test_layout_builder_factories()
    test_layout_patcher()
    test_layout_merger()
    test_ui_presets()
    test_end_to_end()
    test_cli_tools()

    print('=' * 50)
    print('🎉🎉🎉 所有工具测试通过! 🎉🎉🎉')
    print('=' * 50)
