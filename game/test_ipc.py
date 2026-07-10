"""
IPC 通信测试脚本 - 测试游戏与 MCP 之间的数据交换
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import snake_shared

print("=" * 50)
print("IPC 通信测试")
print("=" * 50)

# 测试 1: 读取状态
print("\n=== [测试 1] 读取游戏状态 ===")
state = snake_shared.read_state()
if state:
    for k, v in state.items():
        if k != "body":
            print(f"  {k}: {v}")
    body = state.get("body", [])
    print(f"  body (前5): {body[:5]} ... 共 {len(body)} 节")
else:
    print("  ❌ 未读取到状态 - 游戏可能未运行")

# 测试 2: 发送方向命令
print("\n=== [测试 2] 发送方向命令 (down) ===")
snake_shared.write_command("set_direction", direction="down")
print("  ✅ 命令已写入 snake_ipc.json")

# 测试 3: 发送速度命令
print("\n=== [测试 3] 发送速度命令 (0.08 极快) ===")
snake_shared.write_command("set_speed", speed=0.08)
print("  ✅ 命令已写入 snake_ipc.json")

# 测试 4: 读取日志
print("\n=== [测试 4] 读取游戏日志 ===")
lines = snake_shared.read_log(20)
if lines:
    for l in lines:
        print(f"  {l}")
else:
    print("  (暂无日志)")

# 测试 5: get_grid 测试
print("\n=== [测试 5] 构建网格 (get_grid 模拟) ===")
if state:
    grid_size = state.get("grid_size", 20)
    half = grid_size // 2
    grid = [[0] * grid_size for _ in range(grid_size)]
    body = state.get("body", [])
    for x, z in body:
        gx, gz = x + half, z + half
        if 0 <= gx < grid_size and 0 <= gz < grid_size:
            grid[gz][gx] = 1
    head = state.get("head")
    if head:
        hx, hz = head
        ghx, ghz = hx + half, hz + half
        if 0 <= ghx < grid_size and 0 <= ghz < grid_size:
            grid[ghz][ghx] = 2
    food = state.get("food")
    if food:
        fx, fz = food
        gfx, gfz = fx + half, fz + half
        if 0 <= gfx < grid_size and 0 <= gfz < grid_size:
            grid[gfz][gfx] = 3

    # 打印缩略网格
    print(f"网格 {grid_size}x{grid_size} (缩略):")
    step = max(1, grid_size // 10)
    header = "     " + "".join(f"{i:2}" for i in range(0, grid_size, step))
    print(header)
    for z in range(0, grid_size, step):
        row = "".join(str(grid[z][x]) if grid[z][x] else "." for x in range(0, grid_size, step))
        print(f" {z:3}  {row}")

print("\n✅ 测试完成")
