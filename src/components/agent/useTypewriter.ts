import { useRef, useCallback, useEffect } from 'react'

interface TypewriterOptions {
  /** 基础速度（字符/秒） */
  baseSpeed?: number
  /** 最大速度（字符/秒） */
  maxSpeed?: number
  /** 加速因子：每100字符增加的速度 */
  acceleration?: number
}

/**
 * 打字机效果 hook
 * 文本越长，输出越快
 */
export function useTypewriter(options: TypewriterOptions = {}) {
  const {
    baseSpeed = 30,
    maxSpeed = 200,
    acceleration = 0.5
  } = options

  // 缓冲区：存储待显示的文本
  const bufferRef = useRef('')
  // 当前显示的文本
  const displayRef = useRef('')
  // 目标更新回调
  const callbackRef = useRef<((text: string) => void) | null>(null)
  // 动画帧 ID
  const rafRef = useRef<number>(0)
  // 上次更新时间
  const lastTimeRef = useRef(0)
  // 是否正在运行
  const runningRef = useRef(false)

  // 计算当前速度（字符/秒）
  const getSpeed = useCallback((currentLength: number): number => {
    const speed = baseSpeed + (currentLength / 100) * acceleration * baseSpeed
    return Math.min(speed, maxSpeed)
  }, [baseSpeed, maxSpeed, acceleration])

  // 动画循环
  const animate = useCallback((timestamp: number) => {
    if (!runningRef.current || !callbackRef.current) {
      return
    }

    if (!lastTimeRef.current) {
      lastTimeRef.current = timestamp
    }

    const elapsed = timestamp - lastTimeRef.current
    const currentLength = displayRef.current.length
    const speed = getSpeed(currentLength)
    const charsToAdd = Math.max(1, Math.floor((elapsed / 1000) * speed))

    if (bufferRef.current.length > 0) {
      // 从缓冲区取出字符
      const chunk = bufferRef.current.slice(0, charsToAdd)
      bufferRef.current = bufferRef.current.slice(charsToAdd)
      displayRef.current += chunk

      // 更新显示
      callbackRef.current(displayRef.current)
      lastTimeRef.current = timestamp

      // 继续动画
      rafRef.current = requestAnimationFrame(animate)
    } else {
      // 缓冲区为空，停止动画
      runningRef.current = false
    }
  }, [getSpeed])

  // 启动动画
  const startAnimation = useCallback(() => {
    if (runningRef.current) return
    runningRef.current = true
    lastTimeRef.current = 0
    rafRef.current = requestAnimationFrame(animate)
  }, [animate])

  // 追加文本到缓冲区
  const append = useCallback((text: string) => {
    bufferRef.current += text
    startAnimation()
  }, [startAnimation])

  // 设置完整文本（用于提交时）
  const setFull = useCallback((text: string) => {
    bufferRef.current = text
    displayRef.current = ''
    startAnimation()
  }, [startAnimation])

  // 立即显示所有缓冲文本
  const flush = useCallback(() => {
    if (callbackRef.current && bufferRef.current) {
      displayRef.current += bufferRef.current
      bufferRef.current = ''
      callbackRef.current(displayRef.current)
    }
  }, [])

  // 设置更新回调
  const onUpdate = useCallback((callback: (text: string) => void) => {
    callbackRef.current = callback
  }, [])

  // 重置
  const reset = useCallback(() => {
    bufferRef.current = ''
    displayRef.current = ''
    runningRef.current = false
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [])

  // 清理
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  return {
    append,
    setFull,
    flush,
    reset,
    onUpdate,
    /** 获取当前缓冲区长度（用于调试） */
    getBufferLength: () => bufferRef.current.length,
    /** 获取当前显示长度 */
    getDisplayLength: () => displayRef.current.length
  }
}
