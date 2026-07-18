/**
 * ProjectValidator — 工程项目名称验证
 *
 * 从 NewProjectDialog.tsx 中剥离的项目验证逻辑。
 */

/** 工程名称验证规则 */
const PROJECT_NAME_REGEX = /^[a-zA-Z\u4e00-\u9fff][a-zA-Z0-9\u4e00-\u9fff_-]*$/

export interface ProjectValidationResult {
  valid: boolean
  error: string | null
}

/**
 * 验证工程名称是否合法
 * @param name 待验证的名称（将自动 trim）
 * @param existingNames 已有的工程名列表（用于重名检测，小写比较）
 */
export function validateProjectName(
  name: string,
  existingNames: string[] = [],
): ProjectValidationResult {
  const trimmed = name.trim()

  if (!trimmed) {
    return { valid: false, error: '请输入工程名称' }
  }

  if (!PROJECT_NAME_REGEX.test(trimmed)) {
    return { valid: false, error: '工程名只能包含字母、中文、数字、下划线和连字符' }
  }

  if (existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
    return { valid: false, error: '工程名已存在' }
  }

  return { valid: true, error: null }
}
