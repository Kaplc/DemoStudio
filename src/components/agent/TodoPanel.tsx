/**
 * TodoPanel — 任务面板（输入框上方常驻独立面板）
 *
 * 定位：对齐 DSH WebUI 的 TodoPanel（packages/client/ui-conversation/
 * src/client/skeleton/TodoPanel.tsx）。WebUI 把它注册为
 * 'conversation.input.dock' 槽位（order 0，在 goal / queue 之上），
 * 展示的是「当前待办列表快照」，下一轮开始时清空。
 *
 * 与改造前的差异（本次由内联卡片迁出）：
 *  - 位置：从消息流中的一张系统卡片 → 输入框上方的常驻面板（不随消息滚动）
 *  - 数据：从「每条 todo/write 一张卡片（历史累积）」→ 「最新一次写入的整表快照」
 *  - 生命周期：下一轮开始（turnStart / 用户发起新消息）时清空，与 webui 一致
 *  - 展示：默认折叠，展示各状态计数；展开显示完整列表（含已完成项）
 *
 * 组件本身无数据源、不持有业务状态：todos 由 AgentPanel 维护并下发，
 * 折叠状态是纯呈现层状态，故留在本组件内部。
 */
import React, { useMemo, useState } from 'react'
import { Icon } from '../icons/Icon'
import type { TodoItem } from '../../types/agent'

interface TodoPanelProps {
  /** 当前任务列表快照；空列表整体不渲染（webui: empty renders nothing） */
  todos: readonly TodoItem[]
}

/** 状态计数 → 分段摘要文案（计数为 0 的段省略，避免噪音） */
function progressLabel(done: number, active: number, pending: number): string {
  // 用 U+2002（En Space）加宽分隔呼吸感：HTML 会折叠连续 ASCII 空格
  return [
    ...done > 0 ? [`${done} 已完成`] : [],
    ...active > 0 ? [`${active} 进行中`] : [],
    ...pending > 0 ? [`${pending} 待处理`] : [],
  ].join('\u2002·\u2002')
}

/** 单个任务的状态图标（completed √ / in_progress 转圈 / pending 空心圈） */
function StatusIcon({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') {
    return <Icon name="check" size="sm" className="agent-todo-panel__icon agent-todo-panel__icon--completed" />
  }
  if (status === 'in_progress') {
    return <Icon name="loader" size="sm" className="agent-todo-panel__icon agent-todo-panel__icon--progress" />
  }
  return <Icon name="circle" size="sm" className="agent-todo-panel__icon agent-todo-panel__icon--pending" />
}

const TodoPanelInner: React.FC<TodoPanelProps> = ({ todos }) => {
  // 默认折叠（与 webui 一致：collapsed 初始 true），有内容时由用户主动展开
  const [collapsed, setCollapsed] = useState(true)

  const { done, active, pending } = useMemo(() => {
    let d = 0
    let a = 0
    let p = 0
    for (const item of todos) {
      if (item.status === 'completed') d++
      else if (item.status === 'in_progress') a++
      else p++
    }
    return { done: d, active: a, pending: p }
  }, [todos])

  if (todos.length === 0) return null

  return (
    <section className="agent-todo-panel" aria-label="任务列表">
      <div className="agent-todo-panel__body">
        <button
          type="button"
          className="agent-todo-panel__header"
          aria-expanded={!collapsed}
          onClick={() => { setCollapsed(v => !v) }}
          title={collapsed ? '展开任务列表' : '收起任务列表'}
        >
          <span className="agent-todo-panel__lead" aria-hidden="true">
            <Icon name="list-checks" size="sm" />
          </span>
          <span className="agent-todo-panel__title">任务列表</span>
          <span className="agent-todo-panel__progress">
            {progressLabel(done, active, pending)}
          </span>
          <span className="agent-todo-panel__chevron" aria-hidden="true">
            <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} size="sm" />
          </span>
        </button>

        {!collapsed && (
          <ul className="agent-todo-panel__list">
            {todos.map((item, i) => (
              <li
                key={`${item.content}-${i}`}
                className="agent-todo-panel__item"
                data-status={item.status}
              >
                <span className="agent-todo-panel__glyph" aria-hidden="true">
                  <StatusIcon status={item.status} />
                </span>
                <span className="agent-todo-panel__content">{item.content}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export const TodoPanel = React.memo(TodoPanelInner, (prev, next) => prev.todos === next.todos)
