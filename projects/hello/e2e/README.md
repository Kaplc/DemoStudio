# hello e2e

Hello 项目回归用例目录（框架自动扫描 `projects/*/e2e/*.spec.ts`，新项目零注册）。

写法见根 [e2e/README.md](../../../e2e/README.md)：`import { test } from '../../../e2e/framework/fixtures'` + `test.use({ project: 'hello' })`（id = 本项目文件夹名）。运行：`npm run test:e2e:project -- projects/hello`。
