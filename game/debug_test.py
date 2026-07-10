"""
Ursina 贪吃蛇 - 调试诊断工具
捕获场景中的各种数据并测试渲染效果

用法:
  python debug_test.py          # 仅环境检查 + 逻辑测试
  python debug_test.py --render # 打开 Ursina 窗口进行渲染测试
"""
import sys
import os

# ===== 测试 1: 检查环境 =====
def check_environment():
    print("=" * 50)
    print("[诊断] 环境检查")
    print("=" * 50)
    print(f"Python 版本: {sys.version}")
    print(f"工作目录: {os.getcwd()}")

    try:
        import ursina
        from importlib.metadata import version as get_version
        try:
            ver = get_version('ursina')
        except:
            ver = "未知"
        print(f"Ursina 版本: {ver}")
        print(f"Ursina 路径: {os.path.dirname(ursina.__file__)}")
    except ImportError as e:
        print(f"❌ Ursina 导入失败: {e}")
        return False

    # 检查关键依赖
    deps = [
        ('panda3d', 'panda3d'),
        ('PIL', 'Pillow'),
        ('screeninfo', 'screeninfo'),
        ('pyperclip', 'pyperclip'),
    ]
    for mod, name in deps:
        try:
            __import__(mod)
            print(f"✅ {name} 已安装")
        except ImportError:
            print(f"❌ {name} 未安装")

    # 检查显卡/渲染能力
    try:
        import subprocess
        result = subprocess.run(['wmic', 'path', 'win32_VideoController', 'get', 'name'],
                                capture_output=True, text=True, timeout=5)
        if result.stdout:
            lines = [l.strip() for l in result.stdout.split('\n') if l.strip() and 'name' not in l.lower()]
            for line in lines[:2]:
                print(f"🖥  GPU: {line}")
    except Exception:
        print("  无法获取 GPU 信息")

    return True


# ===== 测试 2: 场景逻辑验证 =====
def test_scene_logic():
    print("\n" + "=" * 50)
    print("[诊断] 场景逻辑测试")
    print("=" * 50)

    from collections import deque
    from random import randint

    GRID_SIZE = 20
    half = GRID_SIZE // 2

    print(f"\n网格大小: {GRID_SIZE}x{GRID_SIZE}")
    print(f"网格范围: -{half} ~ +{half}")
    print(f"围墙位置:")
    print(f"  Z轴: z = -{half}, z = +{half}")
    print(f"  X轴: x = -{half}, x = +{half}")

    snake_segments = []
    for i in range(3):
        pos = (-i, 0)
        snake_segments.append(pos)
        print(f"  蛇节 {i}: ({pos[0]}, {pos[1]})")

    food_x, food_y = None, None
    attempts = 0
    while attempts < 100:
        x = randint(-half + 1, half - 1)
        y = randint(-half + 1, half - 1)
        if not any(sx == x and sy == y for sx, sy in snake_segments):
            food_x, food_y = x, y
            break
        attempts += 1
    print(f"\n食物位置: ({food_x}, {food_y}) (尝试 {attempts+1} 次)")

    print("\n碰撞测试:")
    for dx, dy, label in [(0, 1, "↑"), (0, -1, "↓"), (-1, 0, "←"), (1, 0, "→")]:
        head = snake_segments[0]
        new_pos = (head[0] + dx, head[1] + dy)
        wall_hit = abs(new_pos[0]) > half - 1 or abs(new_pos[1]) > half - 1
        self_hit = any(sx == new_pos[0] and sy == new_pos[1] for sx, sy in snake_segments)
        print(f"  {label} 目标 ({new_pos[0]}, {new_pos[1]}): {'撞墙' if wall_hit else ''}{'撞自己' if self_hit else ''}{'安全' if not wall_hit and not self_hit else ''}")

    print("\n✅ 场景逻辑测试通过!")


# ===== 测试 3: 相机/位置数据模拟 =====
def test_camera_and_positions():
    print("\n" + "=" * 50)
    print("[诊断] 相机与位置数据模拟")
    print("=" * 50)

    GRID_SIZE = 20
    half = GRID_SIZE // 2

    print(f"\n游戏世界范围:")
    print(f"  X轴: -{half} ~ +{half}    (蛇可移动: -{half-1} ~ +{half-1})")
    print(f"  Z轴: -{half} ~ +{half}    (蛇可移动: -{half-1} ~ +{half-1})")
    print(f"  Y轴 (高度):")
    print(f"    地板底部: y = -0.4")
    print(f"    地板顶部: y = 0.0")
    print(f"    蛇身位置: y = 0.45")
    print(f"    食物位置: y = 0.6")
    print(f"    围墙高度: y = -0.2 ~ 1.0")
    print(f"    相机位置: y = 16")

    # 计算蛇在屏幕上的可见性
    print(f"\n视角分析 (2.5D 等轴测视角):")
    print(f"  相机位置: (14, 16, 14)")
    print(f"  相机旋转: x=45°, y=45°")
    print(f"  相机 FOV: 35°")
    print(f"  可见范围: 整个 20x20 网格应在视野内")
    print(f"  蛇身大小: 0.95 x 0.9 x 0.95 (世界单位)")
    print(f"  蛇身高度: y=0.45 (高于地板 0.45 单位)")
    print(f"  → 蛇身应该可见" if True else "")
    print(f"  ⚠ 如果不可见，可能是: 颜色/纹理/渲染问题")


# ===== 测试 4: 颜色可见性分析 =====
def test_color_visibility():
    print("\n" + "=" * 50)
    print("[诊断] 颜色对比分析")
    print("=" * 50)

    colors = [
        ("蛇身 (lime)",         (0, 255, 0),    "地板", (34, 34, 68)),
        ("蛇头 (亮青绿)",       (0, 255, 136),  "地板", (26, 26, 46)),
        ("食物 (红)",           (255, 50, 50),  "地板", (34, 34, 68)),
        ("围墙 (深蓝)",         (15, 52, 96),   "地板", (34, 34, 68)),
    ]

    def brightness(rgb):
        return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]

    def contrast_ratio(c1, c2):
        b1 = brightness(c1)
        b2 = brightness(c2)
        lighter = max(b1, b2)
        darker = min(b1, b2)
        return (lighter + 5) / (darker + 5)

    print(f"\n{'对象':<20} {'RGB':<20} {'背景亮度差':<12} {'对比度':<10} {'可见性'}")
    print("-" * 75)
    for name, rgb, bg_name, bg_rgb in colors:
        cr = contrast_ratio(rgb, bg_rgb)
        bd = abs(brightness(rgb) - brightness(bg_rgb))
        vis = "✅ 清晰" if cr > 2.5 else ("⚠️ 勉强" if cr > 1.5 else "❌ 看不清")
        print(f"{name:<20} {str(rgb):<20} {bd:<12.1f} {cr:<10.2f} {vis}")

    print(f"\n建议:")
    print(f"  - 对比度应 > 2.5 才能清晰可见")
    print(f"  - 蛇身 (lime) 对深色地板对比度很高 ✅")
    print(f"  - 如果看不见，可能是渲染/纹理问题 🚨")


# ===== 测试 5: 写入详细诊断报告 =====
def write_report():
    report_path = os.path.join(os.path.dirname(__file__), 'debug_report.txt')
    print("\n" + "=" * 50)
    print(f"[诊断] 正在写入报告: {report_path}")
    print("=" * 50)

    with open(report_path, 'w', encoding='utf-8') as f:
        f.write("Ursina 贪吃蛇 - 诊断报告\n")
        f.write("=" * 40 + "\n\n")
        f.write(f"Python: {sys.version}\n")
        f.write(f"工作目录: {os.getcwd()}\n")
        f.write(f"脚本目录: {os.path.dirname(__file__)}\n")

        try:
            import ursina
            f.write(f"Ursina: {ursina.__version__}\n")
        except:
            f.write("Ursina: 未安装\n")

        f.write("\n文件清单:\n")
        for fname in ['snake_game.py', 'snake_game.bat', 'debug_test.py', 'debug_test.bat']:
            fpath = os.path.join(os.path.dirname(__file__), fname)
            if os.path.exists(fpath):
                size = os.path.getsize(fpath)
                f.write(f"  ✅ {fname} ({size} bytes)\n")
            else:
                f.write(f"  ❌ {fname} (不存在)\n")

    print("✅ 报告已写入!")


if __name__ == '__main__':
    check_environment()
    test_scene_logic()
    test_camera_and_positions()
    test_color_visibility()
    write_report()

    if '--render' in sys.argv:
        print("\n⚠  传入 --render 参数运行渲染测试:")
        print("   请运行: python debug_render_test.py")
        print("   (渲染测试在独立脚本中)\n")
    else:
        print("\n💡 提示: 如需打开 Ursina 窗口测试渲染效果，请运行:")
        print("   debug_test.bat --render")
        print("   或: python debug_render_test.py\n")

    input("\n按 Enter 键退出...")

    # 2. 去掉纹理
    e2 = Entity(model='cube', color=color.lime, position=(0, 0.5, 0),
                scale=(0.85, 1.0, 0.85))
    test_results.append(("无纹理 (lime)", e2))

    # 3. 亮绿色
    e3 = Entity(model='cube', color=color.hex('#00ff00'), position=(3, 0.5, 0),
                scale=(0.85, 1.0, 0.85))
    test_results.append(("亮绿色 #00ff00", e3))

    # 4. 更大尺寸
    e4 = Entity(model='cube', color=color.lime, position=(-3, 1.5, 3),
                scale=(1.2, 1.5, 1.2))
    test_results.append(("放大蛇身 (1.2,1.5,1.2)", e4))

    # 5. 带 outline
    e5 = Entity(model='cube', color=color.lime, position=(0, 1.5, 3),
                scale=(0.85, 1.0, 0.85))
    test_results.append(("普通蛇身 - 另一位置", e5))

    # 6. 高饱和度
    e6 = Entity(model='cube', color=color.rgb(0, 255, 0), position=(3, 1.5, 3),
                scale=(0.85, 1.0, 0.85))
    test_results.append(("rgb(0,255,0)", e6))

    # 实体信息输出
    print("\n创建了以下测试实体:")
    print(f"{'#':<3} {'标签':<20} {'位置':<20} {'颜色':<15}")
    print("-" * 60)
    for i, (label, entity) in enumerate(test_results):
        pos = entity.position
        col = entity.color
        print(f"{i+1:<3} {label:<20} ({pos.x:.1f},{pos.y:.1f},{pos.z:.1f})        rgb({int(col.r*255)},{int(col.g*255)},{int(col.b*255)})")

    # 相机设为目标视角
    camera.position = (10, 12, 10)
    camera.rotation_x = 50
    camera.rotation_y = 45
    camera.fov = 30

    # 地板
    Entity(model='cube', scale=(12, 0.2, 12), position=(0, -0.1, 0),
           color=color.hex('#1a1a2e'))
    Entity(model='quad', scale=11.9, position=(0, 0.01, 0),
           rotation_x=90, color=color.hex('#222244'))

    # 坐标轴标识
    Text(text='Z', position=(0, 2, 5), scale=10, color=color.red)
    Text(text='X', position=(5, 2, 0), scale=10, color=color.blue)

    print("\n⚠ 测试窗口已打开，请观察绿色方块是否可见")
    print("   - 可见: 说明是代码中位置/缩放问题")
    print("   - 不可见: 可能是 Panda3D/Ursina 渲染问题")
    print("   关闭窗口后将继续...\n")

    app.run()

    # 关闭后打印总结
    print("\n📊 诊断总结:")
    print("   - 如果测试窗口能看到方块，但游戏看不到，问题在游戏代码")
    print("   - 如果测试窗口也看不到，可能是驱动/Ursina 版本问题")
    print("   - 请将观察结果告诉我，我来进一步修复\n")


if __name__ == '__main__':
    check_environment()
    test_scene_logic()

    answer = input("\n是否打开 Ursina 渲染测试窗口? (y/n): ")
    if answer.lower() == 'y':
        run_render_test()
    else:
        print("跳过渲染测试。")

    input("\n按 Enter 键退出...")
