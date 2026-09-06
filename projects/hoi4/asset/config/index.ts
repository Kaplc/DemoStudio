/**
 * Hoi4 配置文件自动扫描入口
 *
 * glob 扫描 asset/config/ 下所有 *.config.json / *.table.json，
 * 由 Hoi4ConfigLoader.registerGlob 按 `{project}.{文件名}` 规则注册：
 *   countries.table.json → hoi4.countries；combat_params.config.json → hoi4.combat_params
 */
import type { ConfigGlobModules } from '@/engine'

/** glob 扫描结果：key = 相对 asset/config/ 的路径 */
export const configGlob: ConfigGlobModules = {
  configModules: import.meta.glob('./**/*.config.json'),
  tableModules: import.meta.glob('./**/*.table.json'),
}
