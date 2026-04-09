# AST 分析工具

基于 ts-morph 对 TypeScript 项目做编程式 AST 分析。

## 安装

```bash
cd tools/ast-analysis
npm install ts-morph
```

或在临时目录安装（不污染项目）：

```bash
mkdir -p /tmp/ast-deps && cd /tmp/ast-deps
npm init -y
npm install ts-morph
```

## 用法

```bash
node analyze.mjs <project-root> [output-dir]
```

例：

```bash
node analyze.mjs /opt/workspace/myclaude/free-code45 /tmp/ast-output
```

需要项目根目录有 `tsconfig.json`。

## 输出

| 文件 | 内容 |
|---|---|
| `summary.md` | 人类可读总结 |
| `exports.json` | 每个文件的 export 数 |
| `tools.json` | 所有 `*Tool` 定义 |
| `commands.json` | 所有命令定义（按 type 分类） |
| `functions.json` | 函数特征统计 |
| `components.json` | React 组件 + Hook 使用统计 |
| `imports.json` | 模块被引用次数排行 |

## 修改与扩展

`analyze.mjs` 是单文件脚本，结构清晰：

```javascript
// 1. 加载项目
const project = new Project({ tsConfigFilePath: ... })

// 2. 遍历源文件
for (const file of project.getSourceFiles()) {
  // 用 ts-morph API 提取信息
  for (const cls of file.getClasses()) { ... }
  for (const fn of file.getFunctions()) { ... }
  for (const imp of file.getImportDeclarations()) { ... }
}

// 3. 写入 JSON
writeFileSync(...)
```

常用 ts-morph API：

```javascript
file.getFilePath()              // 文件路径
file.getFullText()              // 完整源码
file.getExportedDeclarations()  // 所有 export
file.getFunctions()             // 顶层函数
file.getClasses()               // 顶层类
file.getVariableStatements()    // 顶层 const/let/var
file.getImportDeclarations()    // import 语句
file.getDescendantsOfKind(SyntaxKind.ArrowFunction)  // 递归找所有箭头函数

// 函数节点
fn.getName()
fn.getParameters()
fn.isAsync()
fn.isGenerator()
fn.getStartLineNumber()
fn.getBody()

// import 节点
imp.getModuleSpecifierValue()  // 'react'
imp.getNamedImports()          // { useState, useEffect }
```

完整 API 文档：https://ts-morph.com/

## 在其他项目复用

只需修改入口路径，脚本本身是项目无关的：

```bash
node analyze.mjs ~/my-typescript-project /tmp/my-output
```

如果要做项目特定的分析（比如找 free-code45 的 Tool 定义），需要根据该项目的代码模式调整识别逻辑。
