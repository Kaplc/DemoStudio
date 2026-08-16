/**
 * codeLint/checkers — 代码规则检查器副作用注册 barrel
 *
 * 各 checker 模块在被 import 时执行 registerCodeChecker(...) 完成自注册。
 *
 * 新增规则只需两步，无需改动既有代码：
 *   1. 新建 checker 文件（extends AbstractCodeChecker + 末尾 registerCodeChecker）
 *   2. 在此加一行 import './YourChecker'
 */
import './addComponentChecker'
import './bareThreeChecker'
