# 使用 Madge 生成 TypeScript/JavaScript 依赖图指南

## 什么是 Madge

Madge 是一个 Node.js 工具，通过静态分析 `import`/`require` 语句，解析模块间的依赖关系。它可以：

- 列出每个文件的直接依赖
- 检测循环依赖
- 找出孤立文件（没人引用的文件）
- 查看谁依赖了某个文件（反向依赖）
- 生成 DOT/SVG/PNG 可视化依赖图

底层原理：Madge 使用 `precinct` 库提取 import 语句，用 `dependency-tree` 构建依赖树，用 Graphviz 的 `dot` 命令渲染图形。

---

## 第一步：安装依赖

### 安装 Madge

```bash
npm install -g madge
```

### 安装 Graphviz（生成图片必需）

Graphviz 提供 `dot` 命令，负责将依赖关系渲染为 SVG/PNG 图片。

```bash
# RHEL / CentOS / Fedora
dnf install -y graphviz

# Debian / Ubuntu
apt-get install -y graphviz

# macOS
brew install graphviz

# Windows (Chocolatey)
choco install graphviz
```

验证安装：

```bash
madge --version
dot -V
```

---

## 第二步：基本用法

以下示例假设项目根目录有 `tsconfig.json`，源码在 `src/` 下。

### 2.1 列出依赖关系（文本）

```bash
# 从入口文件出发，列出所有可达模块的依赖
madge src/entrypoints/cli.tsx \
  --ts-config tsconfig.json \
  --extensions ts,tsx,js,jsx
```

输出格式：

```
context.ts
  bootstrap/state.ts
  utils/claudemd.ts
  utils/git.ts
```

表示 `context.ts` 依赖了 `bootstrap/state.ts`、`utils/claudemd.ts`、`utils/git.ts`。

**原理**：Madge 从指定入口递归解析 import 语句，`--ts-config` 让它理解 TypeScript 路径别名（如 `src/*`），`--extensions` 告诉它要扫描哪些后缀的文件。

### 2.2 检测循环依赖

```bash
madge src/ \
  --ts-config tsconfig.json \
  --extensions ts,tsx,js,jsx \
  --circular
```

输出示例：

```
1) utils/slowOperations.ts > utils/debug.ts
2) commands.ts > commands/add-dir/index.ts
```

表示 A 依赖 B，B 又依赖回 A（可能经过多层中转）。

**原理**：在依赖图中做深度优先搜索（DFS），检测是否存在回边（back edge），即访问到一个尚在当前递归栈中的节点。

### 2.3 查看反向依赖（谁依赖了某文件）

```bash
madge src/ \
  --ts-config tsconfig.json \
  --extensions ts,tsx,js,jsx \
  --depends context.ts
```

输出的是所有 import 了 `context.ts` 的文件列表。适合评估修改某个文件的影响范围。

### 2.4 查找孤立文件

```bash
madge src/ \
  --ts-config tsconfig.json \
  --extensions ts,tsx,js,jsx \
  --orphans
```

列出没有被任何其他文件 import 的文件。可能是废弃代码、入口文件、或测试文件。

---

## 第三步：生成可视化依赖图

### 3.1 直接生成 SVG

```bash
madge src/context.ts \
  --ts-config tsconfig.json \
  --extensions ts,tsx,js,jsx \
  --image deps.svg
```

**原理**：Madge 先构建依赖树，转为 DOT 格式的图描述语言，再调用 Graphviz 的 `dot` 命令渲染为 SVG。

> 注意：如果依赖树很大（上千个文件），渲染可能很慢甚至失败。建议对大项目只分析局部模块。

### 3.2 导出 DOT 格式（手动控制渲染）

```bash
# 导出 DOT 文件
madge src/context.ts \
  --ts-config tsconfig.json \
  --extensions ts,tsx,js,jsx \
  --dot > deps.dot

# 手动用 Graphviz 渲染（可以调整布局引擎）
dot -Tsvg deps.dot -o deps.svg      # 层级布局（默认）
neato -Tsvg deps.dot -o deps.svg    # 弹簧模型布局
fdp -Tsvg deps.dot -o deps.svg      # 力导向布局
circo -Tsvg deps.dot -o deps.svg    # 圆形布局

# 也可以输出 PNG
dot -Tpng deps.dot -o deps.png
```

**DOT 语言简介**：DOT 是 Graphviz 定义的图描述语言，例如：

```dot
digraph {
  "A.ts" -> "B.ts";
  "A.ts" -> "C.ts";
  "B.ts" -> "D.ts";
}
```

表示 A 依赖 B 和 C，B 依赖 D。

### 3.3 导出 JSON（程序化处理）

```bash
madge src/context.ts \
  --ts-config tsconfig.json \
  --extensions ts,tsx,js,jsx \
  --json > deps.json
```

输出格式：

```json
{
  "context.ts": ["bootstrap/state.ts", "utils/git.ts"],
  "bootstrap/state.ts": ["utils/config.ts"]
}
```

可以用 Python/JS 脚本进一步分析、筛选、生成自定义图表。

---

## 第四步：手动构建精准依赖图（大项目推荐）

大项目直接 `--image` 渲染往往因节点太多而失败或不可读。更好的方式是：先用 madge 获取数据，再手写 DOT 只包含关心的模块。

### 步骤 1：获取目标文件的直接依赖

```bash
# 查看 context.ts 依赖了谁
madge src/ --ts-config tsconfig.json --extensions ts,tsx,js,jsx \
  | grep -A 20 "^context.ts"
```

### 步骤 2：获取反向依赖

```bash
# 查看谁依赖了 context.ts
madge src/ --ts-config tsconfig.json --extensions ts,tsx,js,jsx \
  --depends context.ts
```

### 步骤 3：手写 DOT 文件

根据上面两步的结果，创建一个只包含关键节点的 DOT 文件：

```dot
digraph context_deps {
  rankdir=LR;
  node [shape=box, style=filled, fontsize=10];

  // 核心模块（红色）
  "context.ts" [fillcolor="#ff9999"];

  // context.ts 的依赖（灰色，默认）
  "context.ts" -> "bootstrap/state.ts";
  "context.ts" -> "utils/claudemd.ts";
  "context.ts" -> "utils/git.ts";
  "context.ts" -> "utils/envUtils.ts";
  "context.ts" -> "utils/log.ts";

  // 谁依赖了 context.ts（蓝色）
  "screens/REPL.tsx" [fillcolor="#99ccff"];
  "utils/queryContext.ts" [fillcolor="#99ccff"];
  "screens/REPL.tsx" -> "context.ts";
  "utils/queryContext.ts" -> "context.ts";
}
```

**DOT 语法速查**：

| 语法 | 含义 |
|---|---|
| `rankdir=LR` | 从左到右布局（默认 TB 从上到下） |
| `node [shape=box]` | 全局设置节点形状为方框 |
| `[fillcolor="#ff9999"]` | 设置节点填充颜色 |
| `"A" -> "B"` | A 依赖 B（有向边） |
| `subgraph cluster_X { ... }` | 分组子图（会画边框） |

### 步骤 4：渲染

```bash
dot -Tsvg context-focused.dot -o context-focused.svg
```

### 步骤 5：查看

```bash
# 浏览器打开
open context-focused.svg           # macOS
xdg-open context-focused.svg      # Linux
start context-focused.svg          # Windows

# 或转为 PNG
dot -Tpng context-focused.dot -o context-focused.png
```

---

## 常见问题

### Q: madge 只解析了很少的文件

Bun/Deno 项目中 import 路径常带 `.js` 后缀（如 `import x from './foo.js'`），但实际文件是 `.ts`。需要加 `--extensions ts,tsx,js,jsx` 让 madge 正确解析。

### Q: 渲染超时或失败

依赖图节点太多时 Graphviz 会很慢。解决方案：
- 只分析单个入口文件而非整个 `src/`
- 用 `--json` 导出后手动筛选
- 手写 DOT 只画关心的部分

### Q: 循环依赖数量巨大

Madge 列出的是所有可能的循环路径（排列组合），不是独立的环。实际需要修复的核心环路通常只有几个。关注最短的循环路径，它们是问题根源。

### Q: 路径别名不识别

确保 `tsconfig.json` 中配置了 `paths`，并通过 `--ts-config` 传给 madge：

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "src/*": ["src/*"],
      "@utils/*": ["src/utils/*"]
    }
  }
}
```

---

## 快速参考

```bash
# 依赖列表
madge src/ --ts-config tsconfig.json --extensions ts,tsx

# 循环依赖
madge src/ --ts-config tsconfig.json --extensions ts,tsx --circular

# 反向依赖
madge src/ --ts-config tsconfig.json --extensions ts,tsx --depends foo.ts

# 孤立文件
madge src/ --ts-config tsconfig.json --extensions ts,tsx --orphans

# 生成图片
madge src/entry.ts --ts-config tsconfig.json --extensions ts,tsx --image graph.svg

# 导出 DOT
madge src/entry.ts --ts-config tsconfig.json --extensions ts,tsx --dot > graph.dot

# 导出 JSON
madge src/entry.ts --ts-config tsconfig.json --extensions ts,tsx --json > graph.json

# 手动渲染 DOT
dot -Tsvg graph.dot -o graph.svg
dot -Tpng graph.dot -o graph.png
```
