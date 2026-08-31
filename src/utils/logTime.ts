/**
 * 控制台日志时间戳：14:30:25.123
 * 控制台只显示时间；日期仅在打印到文件日志时才需要（届时再扩展）。
 */
export const logTime = (): string => {
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}
