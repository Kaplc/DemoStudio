/**
 * UsageStatsPanel - Token 消耗统计弹窗（头部「更多」下拉菜单入口）
 *
 * 参考产品级用量统计页布局：统计行（累计/峰值/回合/连续天数）+
 * Token 活动热力图（近 17 周）+ 时间范围切换的每日 Token 趋势图。
 *
 * 数据：agentService.listSessionUsage() —— session.list 行内投影，零日志加载。
 * 口径：每会话用量按其活跃日（updatedAt 本地日期）归属到天（投影无逐事件时间分布，
 * 会话粒度是编辑器侧的确定性近似，面板上向用户说明）。
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { agentService } from '../../editor/AgentService'
import { logTime } from '../../utils/logTime'
import type { SessionUsageEntry } from '../../types/agent'
import {
  aggregateUsage, buildDailyUsage, buildHeatmap, buildTrendSeries, computeStreaks,
  formatTokenCount, linePath,
} from './usageStats'

interface UsageStatsPanelProps {
  onClose: () => void
}

/** 热力图周数（12px 格 + 3px 间距 × 38 周恰好铺满 620px 弹窗内容区） */
export const HEATMAP_WEEKS = 38
/** 热力图格子边长 px（与 editor.css 的 .usage-heatmap__cell 保持一致） */
export const HEATMAP_CELL_PX = 12
/** 趋势图两条折线的配色（对齐参考稿：输入蓝 / 输出绿） */
const LINE_COLORS = { input: '#4a9eff', output: '#34d399' } as const

type LoadPhase = 'loading' | 'ready' | 'error'

export const UsageStatsPanel: React.FC<UsageStatsPanelProps> = ({ onClose }) => {
  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [entries, setEntries] = useState<SessionUsageEntry[]>([])
  const [todayTs, setTodayTs] = useState<number>(() => Date.now())
  const [rangeDays, setRangeDays] = useState<7 | 30>(7)
  const [errorText, setErrorText] = useState('')

  // 挂载即加载（父组件条件渲染，每次打开都是新鲜数据）
  useEffect(() => {
    let cancelled = false
    console.log(`[${logTime()}] [UsageStatsPanel] 开始加载会话用量`)
    agentService.listSessionUsage()
      .then(list => {
        if (cancelled) return
        setEntries(list)
        setTodayTs(Date.now())
        setPhase('ready')
        console.log(`[${logTime()}] [UsageStatsPanel] 用量加载完成: ${list.length} 个会话`)
      })
      .catch(err => {
        if (cancelled) return
        console.error(`[${logTime()}] [UsageStatsPanel] 用量加载失败:`, err)
        setErrorText(err instanceof Error ? err.message : String(err))
        setPhase('error')
      })
    return () => { cancelled = true }
  }, [])

  // Escape 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // ─── 派生数据（entries / todayTs 不变时缓存） ───
  const totals = useMemo(() => aggregateUsage(entries), [entries])
  const heatmap = useMemo(() => buildHeatmap(entries, todayTs, HEATMAP_WEEKS), [entries, todayTs])
  const streaks = useMemo(() => computeStreaks(buildDailyUsage(entries, todayTs)), [entries, todayTs])
  const trend = useMemo(() => buildTrendSeries(entries, todayTs, rangeDays), [entries, todayTs, rangeDays])
  const trendMax = useMemo(
    () => Math.max(1, ...trend.map(p => Math.max(p.input, p.output))),
    [trend],
  )

  const handleRetry = useCallback(() => {
    setPhase('loading')
    agentService.listSessionUsage()
      .then(list => { setEntries(list); setTodayTs(Date.now()); setPhase('ready') })
      .catch(err => {
        console.error(`[${logTime()}] [UsageStatsPanel] 用量重试失败:`, err)
        setErrorText(err instanceof Error ? err.message : String(err))
        setPhase('error')
      })
  }, [])

  return (
    <div className="usage-stats-overlay" onClick={onClose}>
      <div className="usage-stats-modal" onClick={(e) => e.stopPropagation()}>
        <div className="usage-stats-header">
          <h2>使用统计</h2>
          <button className="usage-stats-close" onClick={onClose} title="关闭">×</button>
        </div>

        {phase === 'loading' && (
          <div className="usage-stats-state">正在加载用量数据...</div>
        )}

        {phase === 'error' && (
          <div className="usage-stats-state">
            <div>用量数据加载失败: {errorText}</div>
            <button className="usage-stats-retry" onClick={handleRetry}>重试</button>
          </div>
        )}

        {phase === 'ready' && entries.length === 0 && (
          <div className="usage-stats-state">暂无用量数据（还没有产生 token 消耗的会话）</div>
        )}

        {phase === 'ready' && entries.length > 0 && (
          <div className="usage-stats-body">
            {/* 统计行 */}
            <div className="usage-stats-row">
              <div className="usage-stats-cell">
                <div className="usage-stats-cell__value">{formatTokenCount(totals.totalTokens)}</div>
                <div className="usage-stats-cell__label">累计 Token 数</div>
              </div>
              <div className="usage-stats-cell">
                <div className="usage-stats-cell__value">{formatTokenCount(heatmap.maxDayTotal)}</div>
                <div className="usage-stats-cell__label">单日峰值 Token</div>
              </div>
              <div className="usage-stats-cell">
                <div className="usage-stats-cell__value">{totals.turns}</div>
                <div className="usage-stats-cell__label">累计回合数</div>
              </div>
              <div className="usage-stats-cell">
                <div className="usage-stats-cell__value">{streaks.currentStreak} 天</div>
                <div className="usage-stats-cell__label">当前连续天数</div>
              </div>
              <div className="usage-stats-cell">
                <div className="usage-stats-cell__value">{streaks.longestStreak} 天</div>
                <div className="usage-stats-cell__label">最长连续天数</div>
              </div>
            </div>

            {/* Token 活动热力图 */}
            <div className="usage-stats-section">
              <div className="usage-stats-section__title">Token 活动</div>
              <div className="usage-heatmap" role="img" aria-label={`近 ${HEATMAP_WEEKS} 周 Token 活动热力图`}>
                {heatmap.columns.map((col, ci) => (
                  <div className="usage-heatmap__col" key={ci}>
                    {col.map(cell => (
                      <div
                        key={cell.dateKey}
                        className={[
                          'usage-heatmap__cell',
                          `usage-heatmap__cell--l${cell.future ? 0 : cell.level}`,
                          cell.future ? 'usage-heatmap__cell--future' : '',
                        ].join(' ')}
                        title={cell.future
                          ? cell.dateKey
                          : `${cell.dateKey} · ${cell.total > 0 ? formatTokenCount(cell.total) : '无用量'}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div
                className="usage-heatmap__months"
                style={{ gridTemplateColumns: `repeat(${HEATMAP_WEEKS}, ${HEATMAP_CELL_PX}px)` }}
              >
                {heatmap.monthLabels.map(m => (
                  <span className="usage-heatmap__month" style={{ gridColumnStart: m.col + 1 }} key={m.col}>{m.label}</span>
                ))}
              </div>
              <div className="usage-stats-note">口径：会话用量按活跃日归属（投影不携带逐事件时间分布）</div>
            </div>

            {/* 时间范围 + 每日趋势 */}
            <div className="usage-stats-section">
              <div className="usage-stats-range">
                <span className="usage-stats-range__label">时间范围</span>
                <div className="usage-stats-range__toggle">
                  <button
                    className={`usage-stats-range__btn ${rangeDays === 7 ? 'is-active' : ''}`}
                    onClick={() => setRangeDays(7)}
                  >
                    近 7 日
                  </button>
                  <button
                    className={`usage-stats-range__btn ${rangeDays === 30 ? 'is-active' : ''}`}
                    onClick={() => setRangeDays(30)}
                  >
                    近 30 日
                  </button>
                </div>
              </div>
              <div className="usage-stats-chart">
                <div className="usage-stats-chart__title">每日 Token 趋势图</div>
                <div className="usage-stats-chart__legend">
                  <span className="usage-stats-chart__key">
                    <i style={{ background: LINE_COLORS.input }} />输入侧
                  </span>
                  <span className="usage-stats-chart__key">
                    <i style={{ background: LINE_COLORS.output }} />输出侧
                  </span>
                </div>
                <svg
                  className="usage-stats-chart__svg"
                  viewBox="0 0 100 40"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`近 ${rangeDays} 日每日 Token 趋势`}
                >
                  {[0.25, 0.5, 0.75].map(r => (
                    <line
                      key={r}
                      x1="0" x2="100"
                      y1={40 - 2 - r * 36} y2={40 - 2 - r * 36}
                      className="usage-stats-chart__grid"
                    />
                  ))}
                  <path d={linePath(trend.map(p => p.input), trendMax)} fill="none" stroke={LINE_COLORS.input} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
                  <path d={linePath(trend.map(p => p.output), trendMax)} fill="none" stroke={LINE_COLORS.output} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
                </svg>
                <div className="usage-stats-chart__xlabels">
                  <span>{trend[0]?.dateKey.slice(5)}</span>
                  <span>{trend[Math.floor(trend.length / 2)]?.dateKey.slice(5)}</span>
                  <span>今天</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
