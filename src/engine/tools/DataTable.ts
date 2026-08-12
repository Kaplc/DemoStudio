/**
 * DataTable — 键值行表（UE DataTable 风格）
 *
 * 由 JSON 文件描述（如 src/projects/eatfish/asset/config/fish.table.json），结构为
 * `{ "行名": 行数据, ... }`。ConfigRegistry.loadTable 读取后构造为 DataTable。
 *
 * 设计要点：
 *   - 行名唯一，对应一条记录（物品/敌人/关卡/原型 等）。
 *   - 构造后不可变：没有 mutation API。热更新由 ConfigRegistry.reload 整体替换实例，
 *     避免外部代码持旧引用时被静默篡改。
 *   - getAllRows / getRowNames 返回快照数组，外部可自由遍历而不影响内部 Map。
 */
export class DataTable<Row = Record<string, unknown>> {
  private readonly rows = new Map<string, Row>()

  /** JSON 文件相对路径（调试 / 热更新定位用） */
  readonly source: string

  constructor(source: string, rows: Record<string, Row> = {}) {
    this.source = source
    for (const [name, row] of Object.entries(rows)) {
      this.rows.set(name, row)
    }
  }

  /** 是否存在指定行 */
  has(name: string): boolean {
    return this.rows.has(name)
  }

  /** 取单行；不存在返回 undefined */
  getRow(name: string): Row | undefined {
    return this.rows.get(name)
  }

  /** 取单行；不存在返回 fallback */
  getRowOrDefault(name: string, fallback: Row): Row {
    return this.rows.get(name) ?? fallback
  }

  /** 所有行的快照数组（拷贝，外部可安全遍历） */
  getAllRows(): Row[] {
    return [...this.rows.values()]
  }

  /** 所有行名的快照数组 */
  getRowNames(): string[] {
    return [...this.rows.keys()]
  }

  /** 按谓词查找首个匹配行 */
  find(predicate: (row: Row, name: string) => boolean): Row | undefined {
    for (const [name, row] of this.rows) {
      if (predicate(row, name)) return row
    }
    return undefined
  }

  /** 按谓词过滤所有匹配行 */
  filter(predicate: (row: Row, name: string) => boolean): Row[] {
    const out: Row[] = []
    for (const [name, row] of this.rows) {
      if (predicate(row, name)) out.push(row)
    }
    return out
  }

  /** 行数 */
  get size(): number {
    return this.rows.size
  }
}
