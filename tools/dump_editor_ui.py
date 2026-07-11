"""
一次性诊断工具: 启动编辑器, 等 UI 渲染完成, 调用 ui_dump + screenshot, 然后退出
用法: e:\DemoStudio\.venv\Scripts\python.exe tools\dump_editor_ui.py
"""
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# patch Ursina.run 以便在启动后注入命令
import ursina
from ursina import application
# Ursina 是函数，不是类; 它的 main loop 入口在 main.py / Ursina.__main__ 部分
# 改为 patch application.taskMgr 直接挂任务
import editor.editor_app as ea

dump_done = {'flag': False, 'shot': False}

# 我们先 import editor_app (这会创建 Ursina app 实例)
src = (ROOT / 'editor' / 'editor_app.py').read_text(encoding='utf-8')
g = {'__name__': '__main__', '__file__': str(ROOT / 'editor' / 'editor_app.py')}
# 替换文件末尾的 app.run() 调用
src = src.replace('app.run()', '# app.run() REPLACED BY DIAG TOOL')

# 让编辑器先构建 UI, 再注入 task
exec(compile(src, g['__file__'], 'exec'), g)

import builtins
print(f'[diag] Editor loaded. application ready.')
base = builtins.base
print(f'[diag] base: {base}')

# 在 Ursina main loop 中挂任务
def _diag_task(task):
    if not hasattr(_diag_task, 'frame'):
        _diag_task.frame = 0
    _diag_task.frame += 1

    if _diag_task.frame == 60 and not dump_done['flag']:
        dump_done['flag'] = True
        print('[diag] Running ui_dump...')
        # 增强版 dump: 包含 world position
        try:
            from ursina import camera
            import builtins
            render = builtins.base.render
            def dump_wp(e, indent=0):
                cls = type(e).__name__
                try:
                    wp = e.get_pos(render)
                    wp_str = f'wp=({wp.x:+.3f},{wp.y:+.3f})'
                except Exception:
                    wp_str = 'wp=(?)'
                try:
                    pos = f'({e.x:+.3f}, {e.y:+.3f})'
                except Exception:
                    pos = '(?)'
                try:
                    scl = f'({e.scale_x:.3f}, {e.scale_y:.3f})'
                except Exception:
                    scl = '(?)'
                txt = ''
                if hasattr(e, '_text_entity') and hasattr(e._text_entity, 'text'):
                    txt = repr(e._text_entity.text)[:30]
                elif hasattr(e, 'text'):
                    txt = repr(e.text)[:30]
                attr = ''
                if hasattr(e, '_anchor'):
                    attr = f' anchor=({e._anchor.x:+.2f},{e._anchor.y:+.2f}) off=({e._offset.x:+.3f},{e._offset.y:+.3f})'
                vis = 'ON' if getattr(e, 'enabled', True) else 'OFF'
                prefix = '  ' * indent
                print(f'{prefix}- [{vis}] {cls} pos={pos} {wp_str} scl={scl} text={txt}{attr}')
                for ch in e.children:
                    if ch is e:
                        continue
                    dump_wp(ch, indent + 1)
            print('=== UI WORLD DUMP ===')
            for c in camera.ui.children:
                dump_wp(c, 0)
        except Exception as ex:
            print(f'wp dump failed: {ex}')
        result = ea._cmd_ui_dump([])
        print(f'[diag] {result}')

    if _diag_task.frame == 120 and not dump_done['shot']:
        dump_done['shot'] = True
        print('[diag] Running screenshot...')
        result = ea._cmd_screenshot(['diag_screenshot.png'])
        print(f'[diag] {result}')

    if _diag_task.frame == 180:
        print('[diag] Quitting...')
        application.quit()
        return None

    return task.cont

base.taskMgr.add(_diag_task, 'diag_task')

# 现在启动 main loop (Ursina 对象本身就是 main loop)
base.run()
