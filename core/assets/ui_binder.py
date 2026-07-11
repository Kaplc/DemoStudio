"""
ui_binder — 事件绑定与数据绑定系统
===================================
类似 Unity 的 UI Event System + Data Binding。
支持:
    - 事件绑定: 将控件事件连接到回调函数
    - 数据绑定: 将控件属性连接到数据源
    - 命令绑定: 将按钮等触发控件连接到可执行命令

用法:
    from core.assets import UIBinder

    binder = UIBinder()

    # 事件绑定
    binder.bind_click(btn, lambda: print('clicked'))

    # 数据绑定 (单向)
    binder.bind_property(slider, 'value', source_obj, 'volume')

    # 批量绑定
    binder.apply({
        'start_btn': {'on_click': start_game},
        'volume_slider': {'on_value_changed': lambda v: set_volume(v)},
    })
"""

from typing import Any, Callable, Optional

from core.logger import get_logger

logger = get_logger('assets.binder')


# ──────────────────────────────────────────────
# UIBinder
# ──────────────────────────────────────────────

class UIBinder:
    """UI 事件与数据绑定管理器

    管理控件与回调/数据源之间的绑定关系，提供统一的
    绑定/解绑生命周期管理。
    """

    def __init__(self):
        self._bindings: list[dict] = []  # 所有绑定的记录
        self._enabled = True

    # ─── 事件绑定 ───

    def bind_click(self, widget, handler: Callable) -> bool:
        """绑定点击事件"""
        if hasattr(widget, 'on_click'):
            widget.on_click(handler)
            self._bindings.append({
                'type': 'click',
                'widget': widget,
                'handler': handler,
            })
            return True
        logger.warning('控件不支持 on_click: {}', type(widget).__name__)
        return False

    def bind_hover(self, widget, on_enter: Callable = None, on_exit: Callable = None):
        """绑定悬停事件"""
        if on_enter and hasattr(widget, 'on_hover'):
            widget.on_hover(on_enter)
        if on_exit and hasattr(widget, 'on_unhover'):
            widget.on_unhover(on_exit)
        self._bindings.append({
            'type': 'hover',
            'widget': widget,
            'on_enter': on_enter,
            'on_exit': on_exit,
        })

    def bind_value_changed(self, widget, handler: Callable) -> bool:
        """绑定值变化事件 (滑块/复选框/开关等)"""
        if hasattr(widget, 'on_value_changed'):
            widget.on_value_changed(handler)
            self._bindings.append({
                'type': 'value_changed',
                'widget': widget,
                'handler': handler,
            })
            return True
        logger.warning('控件不支持 on_value_changed: {}', type(widget).__name__)
        return False

    def bind_submit(self, widget, handler: Callable) -> bool:
        """绑定提交事件 (输入框)"""
        if hasattr(widget, 'on_submit'):
            widget.on_submit(handler)
            self._bindings.append({
                'type': 'submit',
                'widget': widget,
                'handler': handler,
            })
            return True
        logger.warning('控件不支持 on_submit: {}', type(widget).__name__)
        return False

    def bind_selected(self, widget, handler: Callable) -> bool:
        """绑定选择事件 (下拉菜单)"""
        if hasattr(widget, 'on_selected'):
            widget.on_selected(handler)
            self._bindings.append({
                'type': 'selected',
                'widget': widget,
                'handler': handler,
            })
            return True
        logger.warning('控件不支持 on_selected: {}', type(widget).__name__)
        return False

    # ─── 批量绑定 ───

    def apply(self, binding_map: dict[str, dict[str, Callable]]):
        """批量应用绑定

        Parameters
        ----------
        binding_map : dict
            {widget_id: {event_name: handler}}
            例如:
                {
                    'start_btn': {'on_click': start_cb},
                    'volume_slider': {'on_value_changed': vol_cb},
                }
        """
        for widget_id, events in binding_map.items():
            for event_name, handler in events.items():
                self._apply_single(widget_id, event_name, handler)

    def _apply_single(self, widget_id: str, event_name: str, handler: Callable):
        """应用单个绑定"""
        widget = getattr(self, '_get_widget', lambda _: None)(widget_id)
        if widget is None:
            logger.warning('绑定: 找不到控件 "{}"', widget_id)
            return

        method_name = {
            'on_click': 'bind_click',
            'on_hover': 'bind_hover',
            'on_value_changed': 'bind_value_changed',
            'on_submit': 'bind_submit',
            'on_selected': 'bind_selected',
        }.get(event_name)

        if method_name and hasattr(self, method_name):
            getattr(self, method_name)(widget, handler)
        else:
            # 直接设置属性 (适用于自定义事件)
            if hasattr(widget, event_name):
                setattr(widget, event_name, handler)
                self._bindings.append({
                    'type': 'direct',
                    'widget': widget,
                    'event': event_name,
                    'handler': handler,
                })

    # ─── 数据绑定 (单向) ───

    def bind_property(
        self,
        widget,
        widget_prop: str,
        source,
        source_prop: str,
        transform: Callable = None,
    ):
        """将控件属性绑定到数据源属性 (单向: 数据源 → 控件)

        Parameters
        ----------
        widget : UIWidget
            目标控件
        widget_prop : str
            控件属性名 (如 'text', 'value')
        source : object
            数据源对象
        source_prop : str
            数据源属性名
        transform : Callable, optional
            值转换函数
        """
        self._bindings.append({
            'type': 'databind',
            'widget': widget,
            'widget_prop': widget_prop,
            'source': source,
            'source_prop': source_prop,
            'transform': transform,
        })
        # 立即同步一次
        self.sync_widget(widget, widget_prop, source, source_prop, transform)

    @staticmethod
    def sync_widget(widget, widget_prop: str, source, source_prop: str,
                    transform: Callable = None):
        """同步数据源 → 控件"""
        try:
            value = getattr(source, source_prop)
            if transform:
                value = transform(value)
            setattr(widget, widget_prop, value)
        except Exception as e:
            logger.warning('数据同步失败: {}', e)

    # ─── 生命周期 ───

    def unbind_all(self):
        """解绑所有绑定"""
        self._bindings.clear()
        logger.debug('所有绑定已解除')

    def set_enabled(self, enabled: bool):
        """启用/禁用绑定 (不解绑)"""
        self._enabled = enabled

    @property
    def binding_count(self) -> int:
        return len(self._bindings)

    def __len__(self):
        return self.binding_count
