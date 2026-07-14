import React, { useCallback, useRef, useEffect } from 'react'

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
  position?: 'left' | 'right' | 'top' | 'bottom'
}

export function ResizeHandle({ direction, onResize, position = 'right' }: ResizeHandleProps) {
  const isDragging = useRef(false)
  const startPos = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isDragging.current = true
    startPos.current = direction === 'horizontal' ? e.clientX : e.clientY
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }, [direction])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return
    const currentPos = direction === 'horizontal' ? e.clientX : e.clientY
    const delta = currentPos - startPos.current
    if (delta !== 0) {
      onResize(delta)
      startPos.current = currentPos
    }
  }, [direction, onResize])

  const handleMouseUp = useCallback(() => {
    if (isDragging.current) {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  const isHorizontal = direction === 'horizontal'

  return (
    <div
      className={`resize-handle resize-handle--${direction} resize-handle--${position}`}
      onMouseDown={handleMouseDown}
    >
      <div className="resize-handle__line" />
    </div>
  )
}
