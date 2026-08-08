/**
 * assetLint/checkers — 检查器副作用注册 barrel
 *
 * 各 checker 模块在被 import 时执行 registerAssetChecker(...) 完成自注册。
 *
 * 新增类型只需两步，无需改动既有代码：
 *   1. 新建 checker 文件（extends AbstractAssetChecker + 末尾 registerAssetChecker）
 *   2. 在此加一行 import './YourChecker'
 */
import './docCheckers'
import './nodeCheckers'
import './componentChecker'
