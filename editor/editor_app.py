"""
Simple game editor / launcher (Ursina Engine UI)
- Standalone window with engine-rendered UI
- Click 'Start Snake' to launch the game as a subprocess
- Returns to editor when game window closes
"""
import sys, os
import subprocess
import atexit
from pathlib import Path

# ensure core/ and game/ packages are importable
_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_root))

from ursina import *

from core.logger import get_logger
from core.console import Console
from core.project_manager import discover_projects, PROJECTS_DIR

logger = get_logger('editor')

# --- Editor App ---

app = Ursina(
    title='DemoStudio Editor',
    borderless=False,
    vsync=True,
    editor_ui_enabled=False,
    development_mode=False,
)

# maximise window (fill screen, keep window decorations)
window.size = window.windowed_size
window.center_on_screen()

# Editor colour theme
THEME = {
    'bg': color.hex('#1a1a2e'),
    'panel': color.hex('#16213e'),
    'panel_light': color.hex('#1e2a4a'),
    'accent': color.hex('#e94560'),
    'accent_hover': color.hex('#ff6b81'),
    'text': color.hex('#e0e0e0'),
    'text_dim': color.hex('#8899aa'),
    'success': color.hex('#44ff88'),
    'warning': color.hex('#ffaa44'),
}

# --- Editor State ---

game_process: subprocess.Popen | None = None
game_running = False

# Editor MCP server subprocess (started/stopped with editor)
mcp_process: subprocess.Popen | None = None
mcp_running = False

# Console instance (will be created after UI)
console: Console | None = None

# Project management
_all_projects = []            # all discovered projects
current_project = None        # selected Project object
_dropdown_open = False
dropdown_bg = None
dropdown_items = []
menu_project_text = None

# Dynamic UI elements (rebuilt on project switch)
_dynamic_project_texts = []   # Text elements in project panel
center_title_text = None
center_info_text = None
launch_btn = None


# --- Layout Components ---

class EditorPanel(Entity):
    """Base editor panel with title bar and background"""

    def __init__(self, title='Panel', x=0, y=0, w=0.3, h=0.8, **kwargs):
        super().__init__(parent=camera.ui, **kwargs)
        self.bg = Entity(
            parent=self,
            model='quad',
            scale=(w, h, 1),
            position=(x, y, 0),
            color=THEME['panel'],
        )
        # title bar
        title_bar = Entity(
            parent=self,
            model='quad',
            scale=(w, 0.035, 1),
            position=(x, y + h/2 - 0.02, 0.001),
            color=THEME['panel_light'],
        )
        self.title_text = Text(
            parent=self,
            text=title,
            position=(x - w/2 + 0.02, y + h/2 - 0.025),
            scale=1.0,
            color=THEME['text_dim'],
            origin=(-0.5, 0),
        )


def launch_game():
    """Launch the current project's game as a subprocess"""
    global game_process, game_running, current_project

    if game_running or current_project is None:
        return

    game_path = current_project.main_path
    venv_python = _root / '.venv' / 'Scripts' / 'python.exe'

    if not game_path:
        logger.error("No main file for project '{}'", current_project.name)
        return

    python_exe = str(venv_python) if venv_python.exists() else 'python'

    try:
        game_process = subprocess.Popen(
            [python_exe, str(game_path)],
            cwd=str(game_path.parent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        game_running = True
        update_ui_state()
        logger.info("Game '{}' started (PID: {})", current_project.name, game_process.pid)
    except Exception as e:
        logger.error("Failed to start: {}", e)


def check_game():
    """Poll game process; clean up when it exits"""
    global game_process, game_running

    if not game_running or game_process is None:
        return

    ret = game_process.poll()
    if ret is not None:
        logger.info("Game exited (code: {})", ret)
        game_process = None
        game_running = False
        update_ui_state()


# ─── Editor MCP 进程管理 ───

def _start_editor_mcp():
    """启动编辑器自带的 MCP 服务器（跟随编辑器生命周期）"""
    global mcp_process, mcp_running

    mcp_path = _root / 'editor' / 'editor_mcp_server.py'
    venv_python = _root / '.venv' / 'Scripts' / 'python.exe'
    if not mcp_path.exists():
        logger.warning("Editor MCP script not found: {}", mcp_path)
        return

    python_exe = str(venv_python) if venv_python.exists() else 'python'

    try:
        mcp_process = subprocess.Popen(
            [python_exe, str(mcp_path)],
            cwd=str(_root),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        mcp_running = True
        logger.info("Editor MCP server started (PID: {})", mcp_process.pid)
    except Exception as e:
        logger.error("Failed to start Editor MCP: {}", e)


def _stop_editor_mcp():
    """停止编辑器 MCP 服务器"""
    global mcp_process, mcp_running

    if mcp_process is not None:
        logger.info("Stopping Editor MCP server (PID: {})...", mcp_process.pid)
        mcp_process.terminate()
        try:
            mcp_process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            mcp_process.kill()
            mcp_process.wait()
        mcp_process = None

    mcp_running = False


def check_mcp():
    """检查 MCP 进程状态，如果意外退出则记录"""
    global mcp_process, mcp_running

    if not mcp_running or mcp_process is None:
        return

    ret = mcp_process.poll()
    if ret is not None:
        logger.warning("Editor MCP exited unexpectedly (code: {})", ret)
        mcp_process = None
        mcp_running = False


def update_ui_state():
    """Update button text and status bar"""
    if game_running:
        if launch_btn:
            launch_btn.text = '[x] Stop Game'
            launch_btn.color = THEME['warning']
            launch_btn.highlight_color = color.hex('#cc8833')
        status_text.text = 'Status: Game Running'
        status_text.color = THEME['success']
    else:
        if launch_btn:
            proj_name = current_project.name if current_project else '?'
            launch_btn.text = f'[>] Start {proj_name}'
            launch_btn.color = THEME['accent']
            launch_btn.highlight_color = THEME['accent_hover']
        status_text.text = 'Status: Ready'
        status_text.color = THEME['text_dim']


def stop_game():
    """Terminate the game subprocess"""
    global game_process, game_running

    if game_process is not None:
        game_process.terminate()
        try:
            game_process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            game_process.kill()
            game_process.wait()
        game_process = None

    game_running = False
    update_ui_state()


def on_launch_click():
    """Toggle game start/stop"""
    if game_running:
        stop_game()
    else:
        launch_game()


# --- Build Editor UI ---

# background
Entity(model='quad', scale=(2, 2, 1), parent=camera.ui, color=THEME['bg'])


# ════════════════════════════════════════
#  Menu Bar
# ════════════════════════════════════════

# Menu bar background
Entity(
    parent=camera.ui,
    model='quad',
    scale=(2, 0.045, 1),
    position=(0, 0.477, 0),
    color=THEME['panel'],
)

# Menu: Project (dropdown)
def _open_project_menu():
    """打开/关闭 Project 下拉菜单"""
    global _dropdown_open
    _dropdown_open = not _dropdown_open
    _render_dropdown()

def _render_dropdown():
    """渲染项目选择下拉菜单"""
    global dropdown_bg, dropdown_items, _dropdown_open

    # 销毁旧的下拉
    if dropdown_bg:
        destroy(dropdown_bg)
        dropdown_bg = None
    for item in dropdown_items:
        destroy(item)
    dropdown_items.clear()

    if not _dropdown_open or not _all_projects:
        return

    # 下拉背景
    item_h = 0.035
    total_h = len(_all_projects) * item_h + 0.01
    dropdown_bg = Entity(
        parent=camera.ui,
        model='quad',
        scale=(0.22, total_h, 1),
        position=(-0.85, 0.477 - 0.025 - total_h / 2, 0.01),
        color=color.rgba(30, 40, 70, 240),
    )

    for i, proj in enumerate(_all_projects):
        y_pos = 0.477 - 0.025 - 0.005 - i * item_h - item_h / 2
        is_active = (proj == current_project)
        item = Button(
            parent=camera.ui,
            text=proj.name,
            position=(-0.85, y_pos, 0.02),
            scale=(0.22, item_h),
            color=THEME['accent'] if is_active else color.rgba(40, 50, 80, 240),
            highlight_color=THEME['accent_hover'],
            origin=(0, 0),
        )
        # 绑定点击事件
        def make_handler(p):
            return lambda: (_select_project(p), _open_project_menu())[0]
        item.on_click = make_handler(proj)
        dropdown_items.append(item)


def _select_project(project):
    """切换当前工程"""
    global current_project
    if project == current_project:
        return
    current_project = project
    logger.info("Switched to project: {} v{}", project.name, project.version)

    # 更新菜单栏文字
    if menu_project_text:
        menu_project_text.text = f'Project: {project.name}  ▼'

    # 更新中心面板
    _update_center_panel()

    # 更新右侧 Project 面板
    _rebuild_project_panel(project)

    # 更新启动按钮
    if launch_btn and not game_running:
        launch_btn.text = f'[>] Start {project.name}'

    # 更新控制台状态回调
    if console and hasattr(console, '_editor_status_cb'):
        def editor_status():
            return f'Project: {current_project.name}  |  Game running: {game_running}'
        console._editor_status_cb = editor_status


# Menu bar buttons
menu_project_text = Text(
    parent=camera.ui,
    text='Project: ▼',
    position=(-0.90, 0.476),
    scale=0.9,
    color=THEME['text'],
    origin=(-0.5, 0),
)

# Invisible click zone for Project menu
menu_project_btn = Button(
    parent=camera.ui,
    text='',
    position=(-0.78, 0.477, 0.001),
    scale=(0.18, 0.04),
    color=color.clear,
    highlight_color=color.rgba(255, 255, 255, 20),
    origin=(0, 0),
)
menu_project_btn.on_click = _open_project_menu

# Editor title text
Text(
    parent=camera.ui,
    text='DemoStudio Editor',
    position=(0, 0.477),
    scale=1.1,
    color=THEME['accent'],
    origin=(0, 0),
)

# Right-side menu items placeholder for future expansion

# Close dropdown when clicking elsewhere
def _close_dropdown():
    global _dropdown_open
    if _dropdown_open:
        _dropdown_open = False
        _render_dropdown()


# --- Left panel: Hierarchy ---
hierarchy_panel = EditorPanel(
    title='Hierarchy',
    x=-0.65, y=0.0, w=0.28, h=0.80,
)
hierarchy_items = [
    '> Scene',
    '  +- Camera',
    '  +- Directional Light',
    '  +- Floor',
    '  +- Walls',
    '  +- Snake (Game)',
]
for i, item in enumerate(hierarchy_items):
    Text(
        parent=hierarchy_panel,
        text=item,
        position=(-0.65 + 0.02, 0.36 - i * 0.035),
        scale=0.8,
        color=THEME['text_dim'] if item.startswith('  ') else THEME['text'],
        origin=(-0.5, 0),
    )

# --- Right panel: Project files ---
project_panel = EditorPanel(
    title='Project Files',
    x=0.65, y=0.0, w=0.28, h=0.80,
)

# Functions to rebuild the project file list dynamically
def _rebuild_project_panel(project):
    """根据当前工程重建右侧文件列表"""
    global _dynamic_project_texts

    # 销毁旧的文字
    for t in _dynamic_project_texts:
        destroy(t)
    _dynamic_project_texts.clear()

    if not project:
        return

    # 构建文件树
    items = [f'[+] {project.folder.name}/']
    for child in sorted(project.folder.iterdir()):
        if child.name.startswith('__') or child.name == 'project.json':
            continue
        if child.is_dir():
            items.append(f'  [+-] {child.name}/')
        else:
            items.append(f'  |- {child.name}')

    # 添加 core/ 和 editor/ 等公共目录
    items.append('')
    items.append('[+] core/')
    for child in sorted((PROJECTS_DIR.parent / 'core').iterdir()):
        if child.name.startswith('__') or child.name.startswith('.'):
            continue
        items.append(f'  |- {child.name}')
    items.append('[+] editor/')
    for child in sorted((PROJECTS_DIR.parent / 'editor').iterdir()):
        if child.name.startswith('__') or child.name.startswith('.'):
            continue
        items.append(f'  |- {child.name}')

    for i, line in enumerate(items):
        t = Text(
            parent=project_panel,
            text=line,
            position=(0.65 + 0.02, 0.36 - i * 0.03),
            scale=0.65,
            color=THEME['text_dim'] if line.startswith('  ') else THEME['text'],
            origin=(-0.5, 0),
        )
        _dynamic_project_texts.append(t)


# --- Center: Launch panel ---

# --- Center: Launch panel ---
# decorative preview box
preview_border = Entity(
    parent=camera.ui,
    model='quad',
    scale=(0.36, 0.30, 1),
    position=(0, 0.08, 0),
    color=THEME['panel'],
)
preview_inner = Entity(
    parent=camera.ui,
    model='quad',
    scale=(0.34, 0.28, 1),
    position=(0, 0.08, 0.001),
    color=THEME['bg'],
)
# placeholder text (dynamic)
def _update_center_panel():
    """更新中央预览面板的信息"""
    global center_title_text, center_info_text

    if not current_project:
        if center_title_text:
            center_title_text.text = 'No project selected'
            center_info_text.text = 'Select a project from the menu above'
        return

    proj = current_project
    if center_title_text:
        center_title_text.text = proj.name
        tags_str = '  |  '.join(proj.tags) if proj.tags else ''
        center_info_text.text = f'v{proj.version}  |  {proj.description}'
        if tags_str:
            center_info_text.text += f'  |  {tags_str}'


center_title_text = Text(
    parent=camera.ui,
    text='Select a Project',
    position=(0, 0.15),
    scale=1.8,
    color=THEME['text_dim'],
    origin=(0, 0),
)
center_info_text = Text(
    parent=camera.ui,
    text='Use the Project menu above',
    position=(0, 0.06),
    scale=0.8,
    color=THEME['text_dim'],
    origin=(0, 0),
)

# --- Launch button ---
launch_btn = Button(
    parent=camera.ui,
    text='[>] Start',
    position=(0, -0.12),
    scale=(0.3, 0.06),
    color=THEME['accent'],
    highlight_color=THEME['accent_hover'],
    origin=(0, 0),
)
launch_btn.on_click = on_launch_click

# --- Console hint (左下角) ---
console_hint = Text(
    parent=camera.ui,
    text='` console',
    position=(-0.92, -0.455),
    scale=0.55,
    color=color.hex('#667788'),
    origin=(-0.5, 0),
)

# --- Status bar ---
Entity(
    parent=camera.ui,
    model='quad',
    scale=(2, 0.035, 1),
    position=(0, -0.482, 0),
    color=THEME['panel'],
)
status_text = Text(
    parent=camera.ui,
    text='Status: Ready',
    position=(-0.92, -0.484),
    scale=0.8,
    color=THEME['text_dim'],
    origin=(-0.5, 0),
)
Text(
    parent=camera.ui,
    text='Ursina Engine  |  Panda3D',
    position=(0.92, -0.484),
    scale=0.7,
    color=THEME['text_dim'],
    origin=(0.5, 0),
)


# --- Register console commands ---

def _register_console_commands():
    """Register editor commands with the console"""
    console.register('start_game', lambda a: (launch_game(), 'Game launched')[1] if not game_running else 'Game already running', 'Launch the snake game')
    console.register('stop_game', lambda a: (stop_game(), 'Game stopped')[1] if game_running else 'No game running', 'Stop the running game')
    console.register('toggle_game', lambda a: on_launch_click() or '', 'Start/stop the game')
    console.register('launch', lambda a: (launch_game(), 'Game launched')[1] if not game_running else 'Game already running', 'Alias for start_game')

    # Set status callback
    def editor_status():
        pname = current_project.name if current_project else 'None'
        return 'Project: {}  |  Game running: {}'.format(pname, game_running)
    console._editor_status_cb = editor_status

    # Add project commands
    console.register('projects', lambda a: _console_list_projects(), 'List available projects')
    console.register('project', lambda a: _console_switch_project(a), 'Switch project: project <name>')


# --- Editor main loop ---

def _console_list_projects():
    """控制台命令: 列出所有工程"""
    if not _all_projects:
        return 'No projects found'
    lines = ['Available projects:']
    for p in _all_projects:
        marker = ' *' if p == current_project else '  '
        lines.append(f'  {marker} {p.name}  v{p.version}  — {p.description}')
    return '\n'.join(lines)


def _console_switch_project(args):
    """控制台命令: 切换工程"""
    if not args:
        return 'Usage: project <name>. Try: projects'
    target = ' '.join(args).lower()
    for p in _all_projects:
        if p.name.lower() == target:
            _select_project(p)
            return f'Switched to project: {p.name}'
    return f"Project '{target}' not found. Try: projects"


def update():
    """Check game process status + MCP + console every frame"""
    global console
    check_game()
    check_mcp()
    if console:
        console.check_ipc()
        console.update(time.dt)


# --- Console input handler ---

def input(key):
    """Handle keyboard input, routing to console first"""
    global console
    # Backtick always toggles console
    if key == '`':
        if console:
            console.toggle()
        return

    # If console is open, route all keys to it
    if console and console.enabled:
        console.handle_key(key)
        return

    # Normal editor input handling goes here (if any)

    # Close dropdown when clicking elsewhere
    if key == 'left mouse down' and _dropdown_open:
        _close_dropdown()


# --- Launch Editor ---

if __name__ == '__main__':
    # Discover projects
    _all_projects[:] = discover_projects()
    logger.info("Discovered {} project(s)", len(_all_projects))

    # Create console after app is ready
    console = Console()
    _register_console_commands()

    # Auto-select first project (after console is ready for status callback)
    if _all_projects:
        _select_project(_all_projects[0])

    # Start built-in MCP server (will stop when editor closes)
    logger.info("Starting built-in Editor MCP server...")
    _start_editor_mcp()
    atexit.register(_stop_editor_mcp)

    # Update menu text
    if menu_project_text and current_project:
        menu_project_text.text = f'Project: {current_project.name}  ▼'

    logger.info("=" * 50)
    logger.info("  DemoStudio Editor")
    logger.info("  Press ` to open console")
    logger.info("  Use Project menu to switch projects")
    logger.info("=" * 50)
    app.run()
