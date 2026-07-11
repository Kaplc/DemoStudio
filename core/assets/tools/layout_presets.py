"""
layout_presets — 预制控件模板库
================================
提供预定义的 UI 组件模板，一行代码生成复杂布局。
类似 Unity 的 UI Toolkit 预设组件。

用法:
    from core.assets.tools import UIPresetLibrary as P

    # 单控件
    btn = P.accent_button('Confirm', 'confirm_btn')
    patcher.add_widget_node(btn, parent_id='main_win')

    # 完整布局片段
    form = P.labeled_input('username', 'Username:', 'Enter name...')
    patcher.add_widget_node(form, parent_id='settings_panel')

    # 模板方法
    dialog = P.confirm_dialog('quit_dialog', '确认退出?')
    builder = LayoutBuilder.from_dict(dialog)

    # 使用 LayoutBuilder 生成
    from core.assets.tools import LayoutBuilder
    builder = LayoutBuilder('login', 'UIWindow')
    P.add_form_fields(builder, [
        ('username', 'Username:'),
        ('password', 'Password:', {'password_mode': True}),
    ])
"""

from core.assets.tools.layout_builder import LayoutBuilder
from core.logger import get_logger

logger = get_logger('assets.tools.presets')


# ──────────────────────────────────────────────
# UIPresetLibrary
# ──────────────────────────────────────────────

class UIPresetLibrary:
    """预制 UI 模板库"""

    # ════════════════════════════════════════════
    # 基础控件模板
    # ════════════════════════════════════════════

    @staticmethod
    def accent_button(widget_id: str, text: str, **overrides) -> dict:
        """强调色按钮 (用于主操作)"""
        node = LayoutBuilder.create_button(
            id=widget_id,
            text=text,
            color='$accent',
            highlight_color='$accent_hover',
            anchor='CENTER',
            size=(0.2, 0.05),
            **overrides,
        )
        return node

    @staticmethod
    def default_button(widget_id: str, text: str, **overrides) -> dict:
        """默认按钮"""
        node = LayoutBuilder.create_button(
            id=widget_id,
            text=text,
            color='$primary_color',
            highlight_color='$hover_color',
            anchor='CENTER',
            size=(0.2, 0.05),
            **overrides,
        )
        return node

    @staticmethod
    def danger_button(widget_id: str, text: str, **overrides) -> dict:
        """危险操作按钮 (红色)"""
        node = LayoutBuilder.create_button(
            id=widget_id,
            text=text,
            color='#e94560',
            highlight_color='#ff6b81',
            pressed_color='#c93550',
            anchor='CENTER',
            size=(0.2, 0.05),
            **overrides,
        )
        return node

    @staticmethod
    def success_button(widget_id: str, text: str, **overrides) -> dict:
        """成功按钮 (绿色)"""
        node = LayoutBuilder.create_button(
            id=widget_id,
            text=text,
            color='#4a9f6a',
            highlight_color='#5abf7a',
            pressed_color='#3a8f5a',
            anchor='CENTER',
            size=(0.2, 0.05),
            **overrides,
        )
        return node

    @staticmethod
    def small_button(widget_id: str, text: str, **overrides) -> dict:
        """小号按钮"""
        node = LayoutBuilder.create_button(
            id=widget_id,
            text=text,
            anchor='CENTER',
            size=(0.1, 0.03),
            font_size=0.55,
            **overrides,
        )
        return node

    @staticmethod
    def wide_button(widget_id: str, text: str, **overrides) -> dict:
        """宽按钮"""
        node = LayoutBuilder.create_button(
            id=widget_id,
            text=text,
            anchor='CENTER',
            size=(0.3, 0.05),
            **overrides,
        )
        return node

    @staticmethod
    def label(widget_id: str, text: str, **overrides) -> dict:
        """文字标签"""
        node = LayoutBuilder.create_label(
            id=widget_id,
            text=text,
            anchor='TOP_LEFT',
            offset=(-0.02, -0.02),
            font_size=0.6,
            color='$text',
            **overrides,
        )
        return node

    @staticmethod
    def dim_label(widget_id: str, text: str, **overrides) -> dict:
        """灰色辅助文字标签"""
        node = LayoutBuilder.create_label(
            id=widget_id,
            text=text,
            anchor='TOP_LEFT',
            offset=(-0.02, -0.02),
            font_size=0.5,
            color='$text_dim',
            **overrides,
        )
        return node

    @staticmethod
    def title_label(widget_id: str, text: str, **overrides) -> dict:
        """大标题文字"""
        node = LayoutBuilder.create_label(
            id=widget_id,
            text=text,
            anchor='TOP_CENTER',
            offset=(0, -0.05),
            font_size=1.2,
            color='$accent',
            **overrides,
        )
        return node

    # ════════════════════════════════════════════
    # 输入控件模板
    # ════════════════════════════════════════════

    @staticmethod
    def input_field(widget_id: str, placeholder: str = '', **overrides) -> dict:
        """文本输入框"""
        node = LayoutBuilder.create_input(
            id=widget_id,
            placeholder=placeholder,
            anchor='TOP_LEFT',
            offset=(-0.02, -0.04),
            size=(0.25, 0.035),
            **overrides,
        )
        return node

    @staticmethod
    def labeled_input(widget_id: str, label_text: str,
                      placeholder: str = '', **overrides) -> dict:
        """带标签的输入框 (返回含 label+input 的容器)"""
        builder = LayoutBuilder(widget_id, 'UIWidget')
        builder.set_anchor('TOP_LEFT').set_size(0.3, 0.07).set_color('$transparent')

        label_id = f'{widget_id}_label'
        UIPresetLibrary._add_label_to(builder, label_id, label_text)

        input_id = f'{widget_id}_input'
        builder.add_child(input_id, 'UIInputField')
        builder.set_placeholder(placeholder)
        builder.set_anchor('TOP_LEFT')
        builder.set_offset(0, -0.035)
        builder.set_size(0.28, 0.03)

        return builder.end()

    @staticmethod
    def password_input(widget_id: str, placeholder: str = 'Password',
                       **overrides) -> dict:
        """密码输入框"""
        return UIPresetLibrary.input_field(
            widget_id, placeholder=placeholder,
            password_mode=True,
            **overrides
        )

    @staticmethod
    def labeled_slider(widget_id: str, label_text: str,
                       min_val: float = 0, max_val: float = 100,
                       default_val: float = 50, **overrides) -> dict:
        """带标签的滑块"""
        builder = LayoutBuilder(widget_id, 'UIWidget')
        builder.set_anchor('TOP_LEFT').set_size(0.3, 0.08).set_color('$transparent')

        label_id = f'{widget_id}_label'
        UIPresetLibrary._add_label_to(builder, label_id, label_text)

        slider_id = f'{widget_id}_slider'
        builder.add_child(slider_id, 'UISlider')
        builder.set_anchor('TOP_LEFT')
        builder.set_offset(0, -0.035)
        builder.set_size(0.25, 0.025)
        builder.set_min(min_val)
        builder.set_max(max_val)
        builder.set_default_value(default_val)
        builder.set_step(1)
        builder.set_show_label(True)

        return builder.end()

    @staticmethod
    def checkbox(widget_id: str, text: str, default: bool = False,
                 **overrides) -> dict:
        """复选框"""
        node = LayoutBuilder.create_checkbox(
            id=widget_id,
            text=text,
            default_value=default,
            anchor='TOP_LEFT',
            offset=(-0.02, -0.02),
            size=(0.2, 0.035),
            **overrides,
        )
        return node

    @staticmethod
    def toggle(widget_id: str, text: str, default: bool = False,
               **overrides) -> dict:
        """开关"""
        node = LayoutBuilder.create_toggle(
            id=widget_id,
            text=text,
            default_value=default,
            anchor='TOP_LEFT',
            offset=(-0.02, -0.02),
            size=(0.18, 0.035),
            **overrides,
        )
        return node

    @staticmethod
    def dropdown(widget_id: str, items: list, default_index: int = 0,
                 **overrides) -> dict:
        """下拉菜单"""
        node = LayoutBuilder.create_dropdown(
            id=widget_id,
            items=items,
            default_index=default_index,
            anchor='TOP_LEFT',
            offset=(-0.02, -0.04),
            size=(0.25, 0.035),
            **overrides,
        )
        return node

    # ════════════════════════════════════════════
    # 容器模板
    # ════════════════════════════════════════════

    @staticmethod
    def window(widget_id: str, title: str, **overrides) -> dict:
        """窗口"""
        node = LayoutBuilder.create_window(
            id=widget_id,
            title=title,
            anchor='CENTER',
            size=(0.35, 0.4),
            closable=True,
            draggable=True,
            **overrides,
        )
        return node

    @staticmethod
    def panel(widget_id: str, title: str, **overrides) -> dict:
        """面板"""
        node = LayoutBuilder.create_panel(
            id=widget_id,
            title=title,
            anchor='CENTER',
            size=(0.28, 0.35),
            show_title=True,
            **overrides,
        )
        return node

    @staticmethod
    def groupbox(widget_id: str, title: str, **overrides) -> dict:
        """分组框"""
        node = {
            'type': 'UIGroupBox',
            'id': widget_id,
            'title': title,
            'anchor': 'TOP_CENTER',
            'offset': [0, -0.04],
            'size': [0.3, 0.15],
            **overrides,
        }
        return node

    @staticmethod
    def scroll_view(widget_id: str, **overrides) -> dict:
        """滚动视图"""
        node = {
            'type': 'UIScrollView',
            'id': widget_id,
            'anchor': 'CENTER',
            'size': [0.25, 0.35],
            'scroll_speed': 0.002,
            **overrides,
        }
        return node

    @staticmethod
    def separator(widget_id: str, **overrides) -> dict:
        """分割线"""
        node = LayoutBuilder.create_separator(
            id=widget_id,
            anchor='CENTER',
            size=(0.3, 0.003),
            **overrides,
        )
        return node

    # ════════════════════════════════════════════
    # 组合布局模板
    # ════════════════════════════════════════════

    @staticmethod
    def confirm_dialog(widget_id: str, message: str,
                       confirm_text: str = '确认',
                       cancel_text: str = '取消') -> dict:
        """确认对话框"""
        node = {
            'type': 'UIDialog',
            'id': widget_id,
            'title': '确认',
            'message': message,
            'confirm_text': confirm_text,
            'cancel_text': cancel_text,
            'anchor': 'CENTER',
            'size': (0.35, 0.2),
        }
        return node

    @staticmethod
    def progress_bar(widget_id: str, **overrides) -> dict:
        """进度条"""
        node = {
            'type': 'UIProgressBar',
            'id': widget_id,
            'value': 0.0,
            'max_value': 1.0,
            'show_label': True,
            'label_format': '{:.0%}',
            'anchor': 'CENTER',
            'size': (0.25, 0.03),
            **overrides,
        }
        return node

    @staticmethod
    def labeled_progress(widget_id: str, label_text: str,
                         **overrides) -> dict:
        """带标签的进度条"""
        builder = LayoutBuilder(widget_id, 'UIWidget')
        builder.set_anchor('TOP_LEFT').set_size(0.3, 0.07).set_color('$transparent')

        label_id = f'{widget_id}_label'
        UIPresetLibrary._add_label_to(builder, label_id, label_text)

        bar_id = f'{widget_id}_bar'
        builder.add_child(bar_id, 'UIProgressBar')
        builder.set_anchor('TOP_LEFT')
        builder.set_offset(0, -0.035)
        builder.set_size(0.25, 0.025)
        builder.set_value(0.0)
        builder.set_max_value(1.0)
        builder.set_show_label(True)
        for k, v in overrides.items():
            builder.set(k, v)

        return builder.end()

    @staticmethod
    def button_bar(widget_id: str, buttons: list[dict],
                   spacing: float = 0.015) -> dict:
        """按钮栏 (水平排列多个按钮)

        Parameters
        ----------
        widget_id : str
            布局容器 ID
        buttons : list[dict]
            按钮定义列表, 每项:
            {'id': 'btn1', 'text': 'Save', 'color': '#4a9f6a', ...}
        spacing : float
            按钮间距
        """
        builder = LayoutBuilder(widget_id, 'UIHorizontalLayout')
        builder.set_anchor('BOTTOM_CENTER')
        builder.set_offset(0, 0.04)
        builder.set_size(0.3, 0.045)
        builder.set_spacing(spacing)
        builder.set_padding(0.005)

        for btn_def in buttons:
            btn_id = btn_def.pop('id')
            btn_text = btn_def.pop('text', 'Button')
            builder.add_child(btn_id, 'UIButton')
            builder.set_text(btn_text)
            for k, v in btn_def.items():
                builder.set(k, v)
            builder.up()

        return builder.end()

    @staticmethod
    def form_group(widget_id: str, fields: list[tuple],
                   title: str = None) -> dict:
        """表单组 (多个带标签的输入框)

        Parameters
        ----------
        widget_id : str
            组容器 ID
        fields : list[tuple]
            字段定义: (id, label, input_type, kwargs)
            input_type: 'input' | 'slider' | 'checkbox' | 'dropdown'
        title : str, optional
            分组标题
        """
        if title:
            builder = LayoutBuilder(widget_id, 'UIGroupBox')
            builder.set_title(title)
            builder.set_anchor('TOP_CENTER')
            builder.set_offset(0, -0.05)
            builder.set_size(0.3, 0.08 * len(fields) + 0.06)
        else:
            builder = LayoutBuilder(widget_id, 'UIWidget')
            builder.set_color('$transparent')
            builder.set_size(0.3, 0.07 * len(fields))

        y_offset = -0.04
        for field_id, field_label, field_type, field_kwargs in fields:
            UIPresetLibrary._add_label_to(builder, f'{field_id}_lbl',
                                          field_label)

            if field_type == 'input':
                builder.add_child(field_id, 'UIInputField')
                builder.set_placeholder(field_kwargs.get('placeholder', ''))
                builder.set_size(0.25, 0.03)
            elif field_type == 'slider':
                builder.add_child(field_id, 'UISlider')
                builder.set_min(field_kwargs.get('min', 0))
                builder.set_max(field_kwargs.get('max', 100))
                builder.set_default_value(field_kwargs.get('default', 50))
                builder.set_size(0.25, 0.025)
            elif field_type == 'checkbox':
                builder.add_child(field_id, 'UICheckbox')
                builder.set_text(field_kwargs.get('text', ''))
                builder.set_default_value(field_kwargs.get('default', False))
                builder.set_size(0.2, 0.035)
            elif field_type == 'dropdown':
                builder.add_child(field_id, 'UIDropdown')
                builder.set_items(field_kwargs.get('items', ['A', 'B']))
                builder.set_size(0.25, 0.035)

            builder.set_anchor('TOP_LEFT')
            builder.set_offset(0, y_offset)
            builder.up()
            y_offset -= 0.07

        return builder.end()

    # ════════════════════════════════════════════
    # 编辑器中使用的布局片段
    # ════════════════════════════════════════════

    @staticmethod
    def editor_toolbar(widget_id: str) -> dict:
        """编辑器顶部工具栏"""
        builder = LayoutBuilder(widget_id, 'UIWidget')
        builder.set_anchor('TOP_CENTER')
        builder.set_offset(0, -0.025)
        builder.set_size(2.0, 0.05)
        builder.set_color('$surface')

        builder.add_child('toolbar_project_btn', 'UIButton')
        builder.set_text('Project: ▼')
        builder.set_anchor('TOP_LEFT')
        builder.set_offset(0.02, -0.024)
        builder.set_size(0.2, 0.04)
        builder.set_color('#FFFFFF')
        builder.set_alpha(0.0)
        builder.up()

        builder.add_child('toolbar_title', 'UIText')
        builder.set_text('DemoStudio Editor')
        builder.set_anchor('TOP_CENTER')
        builder.set_offset(0, -0.024)
        builder.set_font_size(1.1)
        builder.set_color('$accent')
        builder.up()

        builder.add_child('toolbar_hint', 'UIText')
        builder.set_text('MCP Connected')
        builder.set_anchor('TOP_RIGHT')
        builder.set_offset(-0.02, -0.024)
        builder.set_font_size(0.6)
        builder.set_color('$text_dim')

        return builder.end()

    @staticmethod
    def editor_status_bar(widget_id: str) -> dict:
        """编辑器底部状态栏"""
        builder = LayoutBuilder(widget_id, 'UIWidget')
        builder.set_anchor('BOTTOM_CENTER')
        builder.set_offset(0, 0.0175)
        builder.set_size(2.0, 0.035)
        builder.set_color('$surface')

        builder.add_child('status_text', 'UIText')
        builder.set_text('Status: Ready')
        builder.set_anchor('BOTTOM_LEFT')
        builder.set_offset(0.02, 0.017)
        builder.set_font_size(0.8)
        builder.set_color('$text_dim')

        return builder.end()

    # ════════════════════════════════════════════
    # 内部工具
    # ════════════════════════════════════════════

    @staticmethod
    def _add_label_to(builder: LayoutBuilder, label_id: str, text: str):
        builder.add_child(label_id, 'UIText')
        builder.set_text(text)
        builder.set_anchor('TOP_LEFT')
        builder.set_offset(0, -0.01)
        builder.set_font_size(0.55)
        builder.set_color('$text')
        builder.up()

    @staticmethod
    def add_form_fields(builder: LayoutBuilder,
                        fields: list[tuple]) -> LayoutBuilder:
        """向已有 builder 添加表单字段

        Parameters
        ----------
        builder : LayoutBuilder
            目标 builder
        fields : list[tuple]
            (field_id, label_text, extra_kwargs_or_None)
        """
        for field_id, label, extra in fields:
            extra = extra or {}
            UIPresetLibrary._add_label_to(builder, f'{field_id}_lbl', label)
            builder.add_child(field_id, 'UIInputField')
            builder.set_placeholder(extra.get('placeholder', ''))
            builder.set_anchor('TOP_LEFT')
            builder.set_offset(0, -0.035)
            builder.set_size(0.25, 0.03)
            for k, v in extra.items():
                if k != 'placeholder':
                    builder.set(k, v)
            builder.up()
        return builder
