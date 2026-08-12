/**
 * EatFish 配置文件自动扫描入口
 *
 * 使用 Vite import.meta.glob 扫描 asset/config/ 下所有 *.config.json / *.table.json，
 * 由 ConfigLoader（EatFishConfigLoader.registerGlob）按 `{project}.{文件名}` 规则注册：
 *   eatfish.config.json → eatfish.eatfish；fish.table.json → eatfish.fish
 *
 * 新增配置文件时无需修改本文件与 ConfigLoader，自动注册（半自动：transform 仍需手动注册）。
 */
import type { ConfigGlobModules } from '@/engine'

/** glob 扫描结果：key = 相对 asset/config/ 的路径（如 './eatfish.config.json'） */
export const configGlob: ConfigGlobModules = {
  configModules: import.meta.glob('./**/*.config.json'),
  tableModules: import.meta.glob('./**/*.table.json'),
}
