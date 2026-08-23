/**
 * QuestionCard — DSH ask_user_question 交互卡片
 *
 * 对齐 DSH 官方 QuestionComposer 语义（packages/client/ui-user-questions）：
 *   - 单选/多选选项
 *   - 自定义文本输入（Other）
 *   - 多题翻页
 *   - Skip / Submit / Cancel
 *
 * 通过 AgentService.answerQuestion(rpcId, answer) 提交回答，
 * 通过 AgentService.cancelQuestion(rpcId) 取消。
 */
import React, { useState, useRef, useCallback, useMemo } from 'react'
import type { PendingQuestionRequest, QuestionItem, QuestionAnswer } from '../../types/agent'

interface QuestionCardProps {
  /** 待回答的问题请求 */
  request: PendingQuestionRequest
  /** 提交回答回调 */
  onAnswer: (rpcId: string, answer: QuestionAnswer) => void
  /** 取消回调 */
  onCancel: (rpcId: string) => void
  /** 提交/取消后是否已禁用 */
  disabled?: boolean
}

interface DraftAnswer {
  selected: string[]
  custom: string
  skipped: boolean
}

/**
 * 解析选项标签中的推荐后缀（如 "选项A (Recommended)" → { label: "选项A", recommended: true }）
 * 与 DSH 官方 parseRecommendedLabel 保持一致
 */
function parseRecommendedLabel(label: string): { label: string; recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
  return suffix.test(label)
    ? { label: label.replace(suffix, ''), recommended: true }
    : { label, recommended: false }
}

export const QuestionCard: React.FC<QuestionCardProps> = ({ request, onAnswer, onCancel, disabled }) => {
  const questions = request.questions
  const [index, setIndex] = useState(0)
  const [drafts, setDrafts] = useState<DraftAnswer[]>(() =>
    questions.map(() => ({ selected: [], custom: '', skipped: false }))
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focusedRef = useRef(new Set<number>())

  const question = questions[index] as QuestionItem
  const draft = drafts[index] as DraftAnswer
  const hasOptions = (question.options?.length ?? 0) > 0
  const multiSelect = question.multiSelect === true

  const updateDraft = useCallback((fn: (d: DraftAnswer) => DraftAnswer) => {
    setDrafts(prev => prev.map((d, i) => i === index ? fn(d) : d))
    setError(null)
  }, [index])

  const choose = useCallback((label: string) => {
    if (disabled || busy) return
    updateDraft(d => {
      if (multiSelect) {
        const selected = d.selected.includes(label)
          ? d.selected.filter(l => l !== label)
          : [...d.selected, label]
        return { ...d, selected, skipped: false }
      }
      return { selected: [label], custom: '', skipped: false }
    })
    // 单选自动跳下一题
    if (!multiSelect && index < questions.length - 1) {
      setIndex(i => i + 1)
    }
  }, [disabled, busy, multiSelect, index, questions.length, updateDraft])

  const answered = useCallback((d: DraftAnswer) =>
    d.selected.length > 0 || d.custom.trim() !== '', [])

  const submitAll = useCallback(() => {
    // 检查所有题是否已完成
    const missing = drafts.findIndex(d => !answered(d) && !d.skipped)
    if (missing >= 0) {
      setIndex(missing)
      setError('请回答所有问题或跳过')
      return
    }
    const answer: QuestionAnswer = {
      answers: questions.map((q, i) => {
        const d = drafts[i] as DraftAnswer
        if (d.skipped) return { id: q.id, selected: [] }
        const custom = d.custom.trim()
        return {
          id: q.id,
          selected: custom === '' || multiSelect ? d.selected : [],
          ...(custom === '' ? {} : { custom }),
        }
      }),
    }
    setBusy(true)
    onAnswer(request.rpcId, answer)
  }, [drafts, questions, multiSelect, request.rpcId, onAnswer, answered])

  const handleContinue = useCallback(() => {
    if (!answered(draft)) {
      setError('请选择一个选项或输入内容')
      return
    }
    if (index < questions.length - 1) {
      setIndex(i => i + 1)
      setError(null)
      return
    }
    submitAll()
  }, [draft, index, questions.length, submitAll, answered])

  const handleSkip = useCallback(() => {
    setDrafts(prev => prev.map((d, i) => i === index ? { ...d, skipped: true } : d))
    setError(null)
    if (index < questions.length - 1) {
      setIndex(i => i + 1)
    } else {
      submitAll()
    }
  }, [index, questions.length, submitAll])

  return (
    <div className="question-card" data-question-key={request.rpcId}>
      {/* 头部 */}
      <div className="question-card__header">
        {question.header && <div className="question-card__eyebrow">{question.header}</div>}
        <div className="question-card__title">{question.question}</div>
        <div className="question-card__actions">
          <button
            className="question-card__icon-btn"
            title="取消"
            disabled={disabled || busy}
            onClick={() => onCancel(request.rpcId)}
          >✕</button>
        </div>
      </div>

      {/* 详情 */}
      {question.detail && (
        <div className="question-card__detail">{question.detail}</div>
      )}

      {/* 选项 */}
      <div className="question-card__options" role={multiSelect ? 'group' : 'radiogroup'}>
        {(question.options ?? []).map((opt, optIdx) => {
          const parsed = parseRecommendedLabel(opt.label)
          const selected = draft.selected.includes(opt.label)
          return (
            <button
              key={`${opt.label}-${optIdx}`}
              type="button"
              className={`question-card__option ${selected ? 'question-card__option--selected' : ''}`}
              role={multiSelect ? 'checkbox' : 'radio'}
              aria-checked={selected}
              disabled={disabled || busy}
              onClick={() => choose(opt.label)}
            >
              {multiSelect
                ? (
                  <span className={`question-card__checkbox ${selected ? 'question-card__checkbox--checked' : ''}`}>
                    {selected && '✓'}
                  </span>
                )
                : <span className="question-card__number">{optIdx + 1}</span>
              }
              <span className="question-card__option-content">
                <span className="question-card__option-label">
                  {parsed.label}
                  {parsed.recommended && <span className="question-card__badge">推荐</span>}
                </span>
                {opt.description && <span className="question-card__option-desc">{opt.description}</span>}
              </span>
            </button>
          )
        })}

        {/* 自定义输入 */}
        <div className={`question-card__custom ${draft.custom !== '' ? 'question-card__custom--active' : ''}`}>
          {multiSelect
            ? <span className={`question-card__checkbox ${draft.custom !== '' ? 'question-card__checkbox--checked' : ''}`}>{draft.custom !== '' && '✓'}</span>
            : <span className="question-card__number" style={{ visibility: 'hidden' }}>✎</span>
          }
          <div className="question-card__field">
            <textarea
              className="question-card__input"
              value={draft.custom}
              rows={1}
              disabled={disabled || busy}
              placeholder="其他..."
              autoFocus={!focusedRef.current.has(index)}
              onFocus={() => focusedRef.current.add(index)}
              onChange={(e) => {
                updateDraft(d => ({
                  ...d,
                  selected: multiSelect ? d.selected : [],
                  custom: e.target.value,
                  skipped: false,
                }))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing) {
                  e.preventDefault()
                  handleContinue()
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && <div className="question-card__error" role="status">{error}</div>}

      {/* 底部操作栏 */}
      <div className="question-card__footer">
        {questions.length > 1 && (
          <div className="question-card__pager">
            <button
              className="question-card__icon-btn"
              disabled={index === 0 || busy}
              onClick={() => { setIndex(i => i - 1); setError(null) }}
            >◀</button>
            <span className="question-card__progress">{index + 1} / {questions.length}</span>
            <button
              className="question-card__icon-btn"
              disabled={index === questions.length - 1 || busy}
              onClick={() => { setIndex(i => i + 1); setError(null) }}
            >▶</button>
          </div>
        )}
        <div className="question-card__footer-actions">
          <button
            className="question-card__btn question-card__btn--outline"
            disabled={disabled || busy}
            onClick={handleSkip}
          >跳过</button>
          <button
            className="question-card__btn question-card__btn--primary"
            disabled={disabled || busy || !answered(draft)}
            onClick={handleContinue}
          >
            {busy ? '提交中...' : index === questions.length - 1 ? '提交' : '下一题'}
          </button>
        </div>
      </div>
    </div>
  )
}
