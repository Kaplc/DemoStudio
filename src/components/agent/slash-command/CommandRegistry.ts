/**
 * 命令注册表
 * 管理所有斜杠命令的注册、查询和事件通知
 */

import { logger } from '../../../engine/Logger'
import type { SlashCommand, CommandSource } from './types'

export class CommandRegistry {
  private commands = new Map<string, SlashCommand>()
  private sources: CommandSource[] = []
  private listeners = new Set<() => void>()

  /** 注册命令 */
  register(command: SlashCommand): () => void {
    if (this.commands.has(command.name)) {
      logger.warn(`[CommandRegistry] 命令 "${command.name}" 已注册，将被覆盖`)
    }
    this.commands.set(command.name, command)
    this.notify()

    return () => {
      this.commands.delete(command.name)
      this.notify()
    }
  }

  /** 批量注册命令 */
  registerAll(commands: SlashCommand[]): () => void {
    const disposers = commands.map(cmd => this.register(cmd))
    return () => disposers.forEach(d => d())
  }

  /** 注册命令来源 */
  registerSource(source: CommandSource): () => void {
    if (this.sources.some(s => s.name === source.name)) {
      throw new Error(`Source "${source.name}" already registered`)
    }
    this.sources.push(source)
    this.sources.sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
    this.notify()

    return () => {
      const idx = this.sources.findIndex(s => s.name === source.name)
      if (idx >= 0) this.sources.splice(idx, 1)
      this.notify()
    }
  }

  /** 获取匹配的命令 */
  async getCandidates(query: string): Promise<SlashCommand[]> {
    const results: SlashCommand[] = []

    // 从注册的命令中查找
    for (const cmd of this.commands.values()) {
      if (cmd.name.toLowerCase().startsWith(query.toLowerCase())) {
        results.push(cmd)
      }
    }

    // 从来源中查找
    for (const source of this.sources) {
      try {
        const candidates = await source.candidates(query)
        for (const cmd of candidates) {
          if (!results.some(r => r.name === cmd.name)) {
            results.push(cmd)
          }
        }
      } catch (error) {
        logger.warn(`[CommandRegistry] 来源 "${source.name}" 获取候选失败`)
      }
    }

    return results.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** 执行命令 */
  async execute(name: string, args?: string): Promise<boolean> {
    const cmd = this.commands.get(name)
    if (!cmd) return false

    try {
      await cmd.handler(args)
      return true
    } catch (error) {
      logger.warn(`[CommandRegistry] 命令 "${name}" 执行失败`)
      return false
    }
  }

  /** 订阅变更 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 获取所有命令（用于调试） */
  getAll(): SlashCommand[] {
    return Array.from(this.commands.values())
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        logger.warn('[CommandRegistry] 监听器执行失败')
      }
    }
  }
}

/** 全局命令注册表单例 */
export const commandRegistry = new CommandRegistry()
