/**
 * ApprovalCard — DSH 工具越权审批卡片
 *
 * 对齐 DSH 官方 ApprovalFlow 语义（packages/client/ui-conversation）：
 *   - 等待条（脉冲圆点 + 「等待审批」）
 *   - headline：请求方原因优先，缺省「工具 X 请求越权执行」
 *   - 命令行展示（可选，来自关联的工具调用）
 *   - [拒绝] [允许一次] 两个动作，一次性闩锁（answered 后禁用）
 *
 * 决议通过 AgentService.answerApproval(rpcId, outcome) 以 client-response
 * 信封回传；卡片移除由 approval/resolved 广播驱动。
 */
import React, { useState } from 'react'
import type { PendingApprovalRequest, ApprovalOutcome } from '../../types/agent'

interface ApprovalCardProps {
  /** 待审批请求 */
  request: PendingApprovalRequest
  /** 关联工具调用的命令行（可选，查不到就不显示） */
  command?: string
  /** 提交决议回调；resolve(false) 或抛错表示提交失败，解锁重试 */
  onAnswer: (rpcId: string, outcome: ApprovalOutcome) => Promise<boolean>
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({ request, command, onAnswer }) => {
  const [answered, setAnswered] = useState(false)
  const [busy, setBusy] = useState(false)

  const answer = async (outcome: ApprovalOutcome) => {
    if (answered || busy) return
    setBusy(true)
    try {
      if (await onAnswer(request.rpcId, outcome)) setAnswered(true)
    } catch {
      // 提交异常保持解锁，允许重试
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="approval-card" data-approval-key={request.rpcId}>
      {/* 等待条 */}
      <div className="approval-card__strip">
        <span className="approval-card__dot" />
        <span>等待审批</span>
      </div>

      {/* 详情区 */}
      <div className="approval-card__body" role="group" aria-label="审批详情">
        <div className="approval-card__headline">
          {request.reason || `工具 ${request.toolName} 请求越权执行`}
        </div>
        {command && <div className="approval-card__command">{command}</div>}
      </div>

      {/* 动作区 */}
      <div className="approval-card__actions">
        <button
          type="button"
          className="approval-card__btn approval-card__btn--outline"
          disabled={answered}
          onClick={() => answer('rejected')}
        >拒绝</button>
        <button
          type="button"
          className="approval-card__btn approval-card__btn--primary"
          disabled={answered}
          onClick={() => answer('allowed-once')}
        >允许一次</button>
      </div>
    </div>
  )
}
