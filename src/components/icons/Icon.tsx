/**
 * Icon - 统一图标层（lucide-react 薄封装）
 *
 * 目的：
 *  1. 收敛尺寸魔法数字：业务组件不写 `size={14}`，改用语义化 `size` prop
 *  2. 单一收口点：换图标库 / 补自定义图标时只改本文件，调用方零改动
 *  3. 统一默认值：默认 `currentColor` 继承文字色，`shrink-0` 防 flex 挤压
 *
 * 用法：
 *  <Icon name="zap" size="md" />
 *  <Icon name="check" className="agent-todo__done" />
 *
 * 新增图标：① 从 lucide-react import ② 加进 ICONS 映射 ③ 在 IconName 加字面量
 */
import React from 'react'
import {
  Zap,
  Scissors,
  RotateCw,
  CircleX,
  ListChecks,
  Bot,
  Loader,
  Circle,
  Check,
  type LucideIcon,
} from 'lucide-react'

/** 可用图标名（新增图标必须在此登记，编译期检查拼错） */
export type IconName =
  | 'zap'          // 命令 / 快捷操作
  | 'scissors'     // 截断 / 压缩
  | 'rotate-cw'    // 重试
  | 'circle-x'     // 错误
  | 'list-checks'  // 任务列表
  | 'bot'          // 模型 / Agent
  | 'loader'       // 进行中
  | 'circle'       // 待办 / 未开始
  | 'check'        // 成功 / 完成

/**
 * 语义化尺寸档位（对应 px，避免各组件散落魔法数字）
 * xs 10 / sm 12 / md 14（默认）/ lg 16 / xl 20
 */
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZE_PX: Record<IconSize, number> = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
}

/** 图标名 → lucide 组件映射（唯一收口点） */
const ICONS: Record<IconName, LucideIcon> = {
  'zap': Zap,
  'scissors': Scissors,
  'rotate-cw': RotateCw,
  'circle-x': CircleX,
  'list-checks': ListChecks,
  'bot': Bot,
  'loader': Loader,
  'circle': Circle,
  'check': Check,
}

export interface IconProps {
  /** 图标名（编译期约束，拼错直接报错） */
  name: IconName
  /** 尺寸档位，默认 md(14px)；需要精确像素时用 number */
  size?: IconSize | number
  /** 附加 class（通常用于上色） */
  className?: string
  /** 无障碍标注：图标独立表意时必填 */
  title?: string
  /** 描边宽度，默认继承 lucide 的 2 */
  strokeWidth?: number
}

/**
 * 统一图标组件
 * 颜色：默认继承父级 color（currentColor），由 CSS 类控制语义色
 * 无障碍：无 title 时标记 aria-hidden，避免读屏器念出无意义内容
 */
export const Icon: React.FC<IconProps> = ({
  name,
  size = 'md',
  className,
  title,
  strokeWidth,
}) => {
  const Comp = ICONS[name]
  if (!Comp) {
    if (import.meta.env.DEV) {
      console.warn(`[Icon] 未注册的图标名: ${name}`)
    }
    return null
  }

  const px = typeof size === 'number' ? size : SIZE_PX[size]

  return (
    <Comp
      size={px}
      className={className}
      style={{ flexShrink: 0 }}
      strokeWidth={strokeWidth}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
    />
  )
}

export default Icon
