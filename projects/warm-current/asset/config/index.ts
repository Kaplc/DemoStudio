/**
 * WarmCurrent — 配置文件自动扫描入口
 *
 * glob 扫描 asset/config/ 下所有 *.config.json / *.table.json，
 * 由 WarmCurrentConfigLoader.registerGlob 按 `{project}.{文件名}` 规则注册：
 *   global.config.json → warm-current.global；stars.table.json → warm-current.stars
 */
import type { ConfigGlobModules } from '@/engine'

export const configGlob: ConfigGlobModules = {
  configModules: import.meta.glob('./**/*.config.json'),
  tableModules: import.meta.glob('./**/*.table.json'),
}
