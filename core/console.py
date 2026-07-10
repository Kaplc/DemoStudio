"""
Editor Console Module — in-editor command terminal & MCP IPC
============================================================
Provides:
- Toggleable console overlay (backtick key)
- Command registration system (like MCP tools)
- Built-in commands: help, clear, echo, status, start_game, stop_game, exit
- IPC file reader so external MCP servers can send commands
- Command history with up/down arrows

Usage in editor:
    from core.console import Console
    console = Console()
    console.register('my_cmd', my_handler, 'description')
    # in update(): console.check_ipc()
    # in input(key): console.handle_key(key)
"""
import json
import time
from pathlib import Path
from collections import deque
from urllib.parse import urlparse, parse_qs

from ursina import camera, mouse, held_keys, Text, Entity, color, Vec3, Vec2, Button
from ursina import application as ursina_app

from core.logger import get_logger
logger = get_logger('console')


# ─── IPC 路径 ───
ROOT = Path(__file__).resolve().parent.parent
EDITOR_CMD_FILE = ROOT / 'projects' / 'snake' / 'editor_ipc.json'


# ─── Theme ───
CONSOLE_THEME = {
    'bg': color.rgba(10, 10, 30, 200),
    'input_bg': color.rgba(20, 20, 50, 220),
    'text': color.hex('#e0e0e0'),
    'prompt': color.hex('#44ff88'),
    'error': color.hex('#ff5555'),
    'warning': color.hex('#ffaa44'),
    'info': color.hex('#55bbff'),
    'success': color.hex('#44ff88'),
    'dim': color.hex('#667788'),
    'accent': color.hex('#e94560'),
}


class Console:
    """In-editor command console with IPC support"""

    def __init__(self, parent=camera.ui):
        self.enabled = False          # visibility toggle
        self.commands = {}             # registered command table
        self.output_lines = deque(maxlen=200)  # scrollback buffer
        self.history = []             # command history
        self.history_idx = -1
        self._input_text = ''
        self._cursor_visible = True
        self._cursor_timer = 0
        self._ipc_check_timer = 0

        # ─── UI 根节点 ───
        self.root = Entity(parent=parent, enabled=False)

        # 背景 (占据上半部分)
        self.bg = Entity(
            parent=self.root,
            model='quad',
            scale=(2, 0.55, 1),
            position=(0, 0.17, 0),
            color=CONSOLE_THEME['bg'],
        )

        # 输出文字区域 (可滚动)
        self.output_text = Text(
            parent=self.root,
            text='',
            position=(-0.92, 0.44),
            scale=0.7,
            color=CONSOLE_THEME['text'],
            origin=(-0.5, 1),
            line_height=1.4,
        )

        # 输入栏背景
        self.input_bg = Entity(
            parent=self.root,
            model='quad',
            scale=(2, 0.035, 1),
            position=(0, -0.10, 0.001),
            color=CONSOLE_THEME['input_bg'],
        )

        # 提示符
        self.prompt = Text(
            parent=self.root,
            text='> ',
            position=(-0.92, -0.103),
            scale=0.8,
            color=CONSOLE_THEME['prompt'],
            origin=(-0.5, 0),
        )

        # 输入文字
        self.input_display = Text(
            parent=self.root,
            text='',
            position=(-0.85, -0.103),
            scale=0.8,
            color=CONSOLE_THEME['text'],
            origin=(-0.5, 0),
        )

        # 光标
        self.cursor = Text(
            parent=self.root,
            text='|',
            position=(-0.85, -0.103),
            scale=0.8,
            color=CONSOLE_THEME['accent'],
            origin=(-0.5, 0),
        )

        # ─── 底部提示 ───
        self._hint_text = Text(
            parent=self.root,
            text='Type "help" for commands | Backtick (`) to close',
            position=(0, -0.125),
            scale=0.6,
            color=CONSOLE_THEME['dim'],
            origin=(0, 0),
        )

        # ─── 注册内置命令 ───
        self._register_builtins()

        # 输出启动信息
        self._print('Console ready. Type "help" for available commands.', 'info')
        self._print('IPC command file: {}'.format(EDITOR_CMD_FILE.name), 'dim')

    # ─── 命令注册 ───

    def register(self, name: str, handler, description: str = ''):
        """注册一个控制台命令

        Args:
            name: 命令名称 (如 'start_game')
            handler: 处理函数, 接收 args (list of str)
            description: 帮助描述
        """
        self.commands[name] = {
            'handler': handler,
            'description': description,
        }

    def _register_builtins(self):
        """注册内置命令"""
        builtins = [
            ('help',    self._cmd_help,    'Show available commands'),
            ('clear',   self._cmd_clear,   'Clear console output'),
            ('echo',    self._cmd_echo,    'Print text to console'),
            ('status',  self._cmd_status,  'Show editor status'),
            ('exit',    self._cmd_exit,    'Close the editor'),
            ('toggle',  self._cmd_toggle,  'Toggle console visibility'),
        ]
        for name, handler, desc in builtins:
            self.register(name, handler, desc)

    # ─── 显示 ───

    def toggle(self):
        """切换控制台显示/隐藏"""
        self.enabled = not self.enabled
        self.root.enabled = self.enabled
        if self.enabled:
            self._cursor_visible = True
            self._cursor_timer = 0
            self._input_text = ''
            self.history_idx = len(self.history)
            self._refresh_input()
            self._refresh_output()
        else:
            # 关闭时释放焦点
            pass
        logger.info("Console {}", "opened" if self.enabled else "closed")

    def _print(self, text: str, level: str = 'info'):
        """向控制台输出一行"""
        colors = {
            'info': CONSOLE_THEME['info'],
            'error': CONSOLE_THEME['error'],
            'warning': CONSOLE_THEME['warning'],
            'success': CONSOLE_THEME['success'],
            'dim': CONSOLE_THEME['dim'],
            'text': CONSOLE_THEME['text'],
        }
        color_tag = colors.get(level, CONSOLE_THEME['text'])
        # 使用简单的标记而不是 HTML
        self.output_lines.append((text, color_tag))
        self._refresh_output()

    def _refresh_output(self):
        """刷新输出显示"""
        lines = []
        for text, _ in list(self.output_lines):
            # 截断长行
            if len(text) > 140:
                text = text[:137] + '...'
            lines.append(text)
        self.output_text.text = '\n'.join(lines)

    def _refresh_input(self):
        """刷新输入行显示"""
        self.input_display.text = self._input_text
        # 计算光标位置
        text_width = len(self._input_text) * 0.023 * 0.8  # approx
        self.cursor.x = -0.85 + text_width
        self.cursor.text = '|' if self._cursor_visible else ' '

    # ─── 键盘输入处理 ───

    def handle_key(self, key: str):
        """处理键盘输入 (由 editor.input() 调用)"""
        if not self.enabled:
            return False

        if key == '`' or key == 'backtick':
            self.toggle()
            return True

        # 提交命令
        if key == 'enter':
            self._execute(self._input_text)
            self._input_text = ''
            self.history_idx = len(self.history)
            self._refresh_input()
            return True

        # 退格
        if key == 'backspace':
            self._input_text = self._input_text[:-1]
            self._refresh_input()
            return True

        # 历史上翻
        if key == 'up arrow':
            if self.history and self.history_idx > 0:
                self.history_idx -= 1
                self._input_text = self.history[self.history_idx]
                self._refresh_input()
            return True

        # 历史下翻
        if key == 'down arrow':
            if self.history_idx < len(self.history) - 1:
                self.history_idx += 1
                self._input_text = self.history[self.history_idx]
                self._refresh_input()
            elif self.history_idx >= len(self.history) - 1:
                self.history_idx = len(self.history)
                self._input_text = ''
                self._refresh_input()
            return True

        # Escape — 关闭控制台
        if key == 'escape':
            self.toggle()
            return True

        # 文本输入 (单字符)
        if len(key) == 1 and key.isprintable():
            self._input_text += key
            self._refresh_input()
            return True

        return False

    # ─── IPC 命令处理 ───

    def check_ipc(self):
        """检查 IPC 命令文件 (每帧由 editor.update() 调用)"""
        cmd_data = self._read_ipc()
        if cmd_data is None:
            return

        cmd = cmd_data.get('cmd', '').strip()
        params = cmd_data.get('params', {})
        if not cmd or cmd == 'none':
            return

        logger.info("IPC command received: {} {}", cmd, params)
        self._print('IPC > {} {}'.format(cmd, params), 'info')

        # 将 IPC 命令转为控制台命令执行
        args_str = ''
        if isinstance(params, dict):
            # 转为 key=value 形式
            parts = []
            for k, v in params.items():
                parts.append('{}={}'.format(k, v))
            args_str = ' '.join(parts)
        elif isinstance(params, str):
            args_str = params

        full_cmd = cmd
        if args_str:
            full_cmd += ' ' + args_str

        self._execute(full_cmd, source='ipc')

        # 清空已消费
        self._clear_ipc()

    def _read_ipc(self):
        """读取 IPC 命令文件"""
        if not EDITOR_CMD_FILE.exists():
            return None
        try:
            with open(EDITOR_CMD_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return None

    def _clear_ipc(self):
        """消费后清空 IPC 文件"""
        try:
            with open(EDITOR_CMD_FILE, 'w', encoding='utf-8') as f:
                json.dump({"cmd": "none", "params": {}, "timestamp": 0}, f)
        except OSError:
            pass

    @staticmethod
    def write_ipc(cmd: str, **params):
        """外部写入 IPC 命令 (给 MCP server 调用)"""
        try:
            data = {"cmd": cmd, "params": params, "timestamp": time.time()}
            with open(EDITOR_CMD_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f)
            return True
        except OSError as e:
            logger.error("Failed to write editor IPC: {}", e)
            return False

    # ─── 命令执行 ───

    def _execute(self, cmd_str: str, source: str = 'console'):
        """解析并执行命令字符串"""
        cmd_str = cmd_str.strip()
        if not cmd_str:
            return

        self._print('> {}'.format(cmd_str), 'text')
        self.history.append(cmd_str)

        parts = cmd_str.split()
        name = parts[0].lower()
        args = parts[1:]

        if name in self.commands:
            try:
                result = self.commands[name]['handler'](args)
                if result and isinstance(result, str):
                    self._print(result, 'success')
            except Exception as e:
                self._print('Error: {}'.format(e), 'error')
                logger.error("Command '{}' failed: {}", name, e)
        else:
            self._print("Unknown command: '{}'. Type 'help' for available commands.".format(name), 'error')

    # ─── 内置命令处理 ───

    def _cmd_help(self, args):
        """显示所有可用命令"""
        lines = ['Available commands:']
        # 按名称排序
        for name in sorted(self.commands.keys()):
            desc = self.commands[name]['description']
            lines.append('  {:<20} {}'.format(name, desc))
        lines.append('')
        lines.append('IPC commands: write to {}'.format(EDITOR_CMD_FILE.name))
        self._print('\n'.join(lines), 'info')

    def _cmd_clear(self, args):
        """清屏"""
        self.output_lines.clear()
        self._refresh_output()

    def _cmd_echo(self, args):
        """回显"""
        return ' '.join(args) if args else ''

    def _cmd_status(self, args):
        """显示编辑器状态"""
        lines = []
        lines.append('Console visible: {}'.format(self.enabled))
        lines.append('Command history: {} entries'.format(len(self.history)))
        lines.append('Output buffer: {} lines'.format(len(self.output_lines)))
        lines.append('Registered commands: {}'.format(len(self.commands)))
        # 编辑器状态由外部注入
        if hasattr(self, '_editor_status_cb') and self._editor_status_cb:
            lines.append(self._editor_status_cb())
        return '\n'.join(lines)

    def _cmd_exit(self, args):
        """退出编辑器"""
        self._print('Shutting down editor...', 'warning')
        ursina_app.quit()
        return 'Goodbye!'

    def _cmd_toggle(self, args):
        """切换控制台"""
        self.toggle()

    # ─── 每帧更新 ───

    def update(self, dt: float = None):
        """每帧更新 (光标闪烁 + IPC 检查)"""
        if not self.enabled:
            return

        # 光标闪烁
        self._cursor_timer += dt if dt is not None else 0
        if self._cursor_timer > 0.5:
            self._cursor_timer = 0
            self._cursor_visible = not self._cursor_visible
            self._refresh_input()


# ─── 快捷函数：写入 IPC 命令 ───

def send_editor_command(cmd: str, **params):
    """向编辑器发送 IPC 命令 (供外部 MCP server 导入调用)"""
    return Console.write_ipc(cmd, **params)
