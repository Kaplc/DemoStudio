/**
 * GradientPanel - 文本梯度候选弹窗（头部「更多」下拉菜单入口）
 *
 * 展示 ds-feedback 的文本梯度闭环数据，只读：
 * - 待确认候选（.dsh/gradient/pending/*.proposed.md）：name/kind/target/delta/evidence
 * - 最近应用台账（.dsh/gradient/applied.jsonl 最近 10 条）
 *
 * 落地动作不在面板做（零新 IPC）：候选由 agent 的 gradient_apply 工具落地，
 * 面板只负责总览与溯源。数据经 AgentService（readTextFile/listDirFiles IPC）。
 * UI 按面板紧凑预算：小内距小字号、候选正文两行截断、列表限高滚动。
 */
import React, { useState, useEffect, useCallback } from 'react'
import { agentService } from '../../editor/AgentService'
import { logTime } from '../../utils/logTime'
import type { GradientLedgerRow, GradientProposalEntry } from '../../editor/lossSignals'

interface GradientPanelProps {
  onClose: () => void
}

type LoadPhase = 'loading' | 'ready' | 'error'

/** kind → 中文徽标文案 */
const KIND_LABEL: Record<string, string> = {
  rule: '规则',
  reminder: '提醒文案',
  instruction: '指令建议',
}

/** action → 中文文案 */
const ACTION_LABEL: Record<string, string> = {
  created: '新建',
  overwritten: '替换',
  appended: '追加',
  suggested: '已建议',
}

export const GradientPanel: React.FC<GradientPanelProps> = ({ onClose }) => {
  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [proposals, setProposals] = useState<GradientProposalEntry[]>([])
  const [brokenNames, setBrokenNames] = useState<string[]>([])
  const [ledger, setLedger] = useState<GradientLedgerRow[]>([])
  const [errorText, setErrorText] = useState('')

  const load = useCallback(async () => {
    setPhase('loading')
    try {
      const [pending, ledgerRows] = await Promise.all([
        agentService.listGradientProposals(),
        agentService.readGradientLedger(10),
      ])
      setProposals(pending.proposals)
      setBrokenNames(pending.brokenNames)
      setLedger(ledgerRows)
      setPhase('ready')
      console.log(`[${logTime()}] [GradientPanel] 候选加载完成: ${pending.proposals.length} 待确认 / ${pending.brokenNames.length} 坏文件 / 台账 ${ledgerRows.length} 条`)
    } catch (err) {
      console.error(`[${logTime()}] [GradientPanel] 候选加载失败:`, err)
      setErrorText(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }, [])

  // 挂载即加载（父组件条件渲染，每次打开都是新鲜数据）
  useEffect(() => { void load() }, [load])

  // Escape 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="usage-stats-overlay" onClick={onClose}>
      <div className="usage-stats-modal gradient-panel" onClick={(e) => e.stopPropagation()}>
        <div className="usage-stats-header">
          <h2>文本梯度候选</h2>
          <div className="gradient-panel__actions">
            <button className="gradient-panel__refresh" onClick={() => { void load() }} title="刷新">↻</button>
            <button className="usage-stats-close" onClick={onClose} title="关闭">×</button>
          </div>
        </div>

        {phase === 'loading' && (
          <div className="usage-stats-state">正在加载梯度候选...</div>
        )}

        {phase === 'error' && (
          <div className="usage-stats-state">
            <div>加载失败: {errorText}</div>
            <button className="usage-stats-retry" onClick={() => { void load() }}>重试</button>
          </div>
        )}

        {phase === 'ready' && (
          <div className="gradient-panel__body">
            <div className="gradient-panel__section-title">
              待确认候选（{proposals.length}）
              <span className="gradient-panel__hint">由 agent 回合末复盘提出；确认落地用 gradient_apply</span>
            </div>
            {proposals.length === 0 && brokenNames.length === 0 && (
              <div className="gradient-panel__empty">暂无待确认候选</div>
            )}
            <div className="gradient-panel__list">
              {proposals.map(p => (
                <div className="gradient-panel__item" key={p.name} data-testid="gradient-proposal-item" data-name={p.name}>
                  <div className="gradient-panel__item-head">
                    <span className={`gradient-panel__kind gradient-panel__kind--${p.kind}`}>{KIND_LABEL[p.kind] ?? p.kind}</span>
                    <span className="gradient-panel__name" title={p.name}>{p.name}</span>
                    <span className="gradient-panel__target" title={p.target}>→ {p.target}</span>
                    <span className="gradient-panel__date">{p.date}</span>
                  </div>
                  <div className="gradient-panel__delta" title={p.delta}>{p.delta}</div>
                  {p.evidence !== '' && (
                    <div className="gradient-panel__evidence" title={p.evidence}>证据：{p.evidence}</div>
                  )}
                </div>
              ))}
              {brokenNames.length > 0 && (
                <div className="gradient-panel__broken">坏文件（解析失败）：{brokenNames.join('、')}</div>
              )}
            </div>

            <div className="gradient-panel__section-title">
              最近应用台账（{ledger.length}）
              <span className="gradient-panel__hint">回滚走 git（.dsh/ 随仓库跟踪）</span>
            </div>
            {ledger.length === 0 && (
              <div className="gradient-panel__empty">暂无应用记录</div>
            )}
            <div className="gradient-panel__list gradient-panel__list--ledger">
              {ledger.map(row => (
                <div className="gradient-panel__ledger-row" key={`${row.ts}-${row.name}`} title={row.deltaPreview}>
                  <span className="gradient-panel__name">{row.name}</span>
                  <span className="gradient-panel__ledger-action">{ACTION_LABEL[row.action] ?? row.action}</span>
                  <span className="gradient-panel__target">→ {row.target}</span>
                  <span className="gradient-panel__date">{new Date(row.ts).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
