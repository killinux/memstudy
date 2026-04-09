# 代码架构分析方法大全

本文档汇总分析代码架构的各类方法，按分析维度分类，每种方法包含原理、工具、命令示例和适用场景。

---

## 目录

1. [静态依赖分析](#1-静态依赖分析)
2. [调用图分析](#2-调用图分析)
3. [AST 抽象语法树分析](#3-ast-抽象语法树分析)
4. [代码复杂度度量](#4-代码复杂度度量)
5. [运行时追踪](#5-运行时追踪)
6. [火焰图](#6-火焰图)
7. [Git 考古与热点分析](#7-git-考古与热点分析)
8. [变更频率 × 复杂度交叉分析](#8-变更频率--复杂度交叉分析)
9. [架构决策挖掘](#9-架构决策挖掘)
10. [目录结构与代码量可视化](#10-目录结构与代码量可视化)
11. [方法对比与选择指南](#11-方法对比与选择指南)

---

## 1. 静态依赖分析

### 原理

通过静态解析 `import` / `require` / `use` 语句，构建模块之间的依赖关系图。不需要运行代码，只做文本分析。

### 工具

| 工具 | 语言 | 安装 |
|---|---|---|
| madge | JS/TS | `npm install -g madge` |
| pydeps | Python | `pip install pydeps` |
| cargo-tree | Rust | 内置于 cargo |
| go mod graph | Go | 内置于 go |
| dependency-cruiser | JS/TS | `npm install -g dependency-cruiser` |

### 常用命令

```bash
# JS/TS: madge
madge src/ --ts-config tsconfig.json --extensions ts,tsx --circular   # 循环依赖
madge src/ --ts-config tsconfig.json --extensions ts,tsx --depends foo.ts  # 反向依赖
madge src/ --ts-config tsconfig.json --extensions ts,tsx --orphans    # 孤立文件
madge src/ --ts-config tsconfig.json --extensions ts,tsx --json > deps.json  # 导出 JSON

# Python: pydeps
pydeps mypackage --no-show              # 生成依赖图 SVG
pydeps mypackage --max-bacon 3          # 限制深度

# Rust
cargo tree                              # 完整依赖树
cargo tree --invert serde               # 谁依赖了 serde
cargo tree --duplicates                  # 重复依赖

# Go
go mod graph | head -20                 # 模块依赖
```

### 适用场景

- 初次接触项目，快速了解模块关系
- 检测循环依赖
- 评估修改某个文件的影响范围（反向依赖）
- 找出废弃代码（孤立文件）

### 进阶：分层依赖图

大项目直接渲染全图会 OOM。用 BFS 分层方式从入口逐层展开：

```bash
# 导出 JSON 后用分层脚本
madge src/ --ts-config tsconfig.json --extensions ts,tsx --json > deps.json
python3 tools/layered-deps.py deps.json entry.ts 3
```

详见 [madge-guide.md](madge-guide.md) 第五步。

---

## 2. 调用图分析

### 原理

比模块依赖更细粒度——追踪**函数之间**的调用关系。模块 A 依赖模块 B 只说明"A import 了 B"，调用图则能告诉你"A 中的 `foo()` 调用了 B 中的 `bar()` 和 `baz()`"。

### 工具

| 工具 | 语言 | 安装 |
|---|---|---|
| ts-callgraph | TypeScript | `npm install -g ts-callgraph` |
| pycallgraph2 | Python | `pip install pycallgraph2` |
| callgrind (Valgrind) | C/C++ | `apt install valgrind` |
| go-callvis | Go | `go install github.com/ondrajz/go-callvis@latest` |
| doxygen | 多语言 | `apt install doxygen` |

### 常用命令

```bash
# TypeScript
npx ts-callgraph src/query.ts --output callgraph.dot
dot -Tsvg callgraph.dot -o callgraph.svg

# Python（运行时调用图）
python -c "
from pycallgraph2 import PyCallGraph
from pycallgraph2.output import GraphvizOutput
with PyCallGraph(output=GraphvizOutput(output_file='callgraph.png')):
    import your_module
    your_module.main()
"

# Go
go-callvis -group pkg,type ./cmd/app

# C/C++ (Valgrind + KCachegrind)
valgrind --tool=callgrind ./program
kcachegrind callgrind.out.*

# 通用: doxygen
doxygen -g Doxyfile
# 编辑 Doxyfile: CALL_GRAPH = YES, CALLER_GRAPH = YES
doxygen Doxyfile
```

### 适用场景

- 理解某个函数被谁调用、调用了谁
- 重构前评估函数的影响范围
- 找出"上帝函数"（被大量调用的枢纽函数）
- 优化性能瓶颈的调用链

### 静态 vs 动态调用图

| 类型 | 原理 | 优点 | 缺点 |
|---|---|---|---|
| 静态 | 分析源码中的函数调用语句 | 不需要运行代码 | 无法处理动态 dispatch、反射 |
| 动态 | 运行时记录实际执行路径 | 100% 准确 | 只能覆盖运行到的路径 |

---

## 3. AST 抽象语法树分析

### 原理

将源码解析为树形结构（AST），每个节点代表一个语法元素（函数定义、变量声明、if 语句等）。可以编程遍历 AST 提取任意结构化信息。

### 工具

| 工具 | 语言 | 安装 |
|---|---|---|
| ts-morph | TypeScript | `npm install ts-morph` |
| tree-sitter | 多语言 | `pip install tree-sitter` |
| ast (内置) | Python | 无需安装 |
| jscodeshift | JS/TS | `npm install -g jscodeshift` |
| Roslyn | C# | NuGet 包 |

### 使用示例

```typescript
// TypeScript: 用 ts-morph 提取所有 export 的函数
import { Project } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });
for (const file of project.getSourceFiles()) {
  for (const fn of file.getFunctions()) {
    if (fn.isExported()) {
      console.log(`${file.getBaseName()}: ${fn.getName()}()`);
    }
  }
}
```

```python
# Python: 用内置 ast 模块提取所有类和函数
import ast, sys

tree = ast.parse(open(sys.argv[1]).read())
for node in ast.walk(tree):
    if isinstance(node, ast.ClassDef):
        print(f"class {node.name} (line {node.lineno})")
    elif isinstance(node, ast.FunctionDef):
        print(f"  def {node.name} (line {node.lineno})")
```

```bash
# tree-sitter: 超快速多语言解析
pip install tree-sitter tree-sitter-typescript
# 然后用 Python 脚本遍历 AST
```

### 适用场景

- 批量提取接口/类型定义
- 自动化重构（重命名、提取函数）
- 代码规范检查（自定义 lint 规则）
- 生成 API 文档

---

## 4. 代码复杂度度量

### 原理

用数学指标量化代码的复杂程度。常用指标：

| 指标 | 含义 | 怎么算 |
|---|---|---|
| 圈复杂度（Cyclomatic Complexity） | 独立执行路径数 | if/else/switch/loop 每增加一个分支 +1 |
| 认知复杂度（Cognitive Complexity） | 人类理解难度 | 嵌套层数越深惩罚越重 |
| 代码行数（LOC） | 文件/函数长度 | 计算有效代码行 |
| Halstead 指标 | 操作符/操作数的复杂度 | 基于词汇量计算 |

### 工具

| 工具 | 语言 | 安装 |
|---|---|---|
| plato | JS/TS | `npm install -g plato` |
| ts-complexity | TypeScript | `npx ts-complexity` |
| radon | Python | `pip install radon` |
| gocyclo | Go | `go install github.com/fzipp/gocyclo/cmd/gocyclo@latest` |
| lizard | 多语言 | `pip install lizard` |
| cloc | 多语言 | `apt install cloc` |

### 常用命令

```bash
# JS/TS: plato 生成可视化报告
npx plato -r -d plato-report src/
open plato-report/index.html

# TypeScript 圈复杂度
npx ts-complexity src/ --threshold 10   # 只显示复杂度 > 10 的

# Python
radon cc src/ -a -nc                    # 圈复杂度（-nc 不显示低复杂度）
radon mi src/                           # 可维护性指数
radon hal src/                          # Halstead 指标

# Go
gocyclo -top 20 .                       # Top 20 最复杂的函数

# 多语言
lizard src/ -l python -l typescript     # 跨语言复杂度分析
lizard src/ --sort cyclomatic_complexity # 按复杂度排序

# 代码行数统计
cloc src/ --by-file --include-lang=TypeScript | head -30
```

### 解读标准

| 圈复杂度 | 风险等级 | 建议 |
|---|---|---|
| 1-10 | 低 | 正常 |
| 11-20 | 中 | 考虑拆分 |
| 21-50 | 高 | 应该重构 |
| > 50 | 极高 | 必须重构 |

### 适用场景

- 识别"最危险的代码"（高复杂度 = 高 bug 概率）
- 代码审查时量化评估
- 制定重构优先级

---

## 5. 运行时追踪

### 原理

实际运行代码，记录执行过程中的函数调用、耗时、内存分配等信息。比静态分析更准确，但只能覆盖实际执行到的路径。

### 工具

| 工具 | 语言 | 说明 |
|---|---|---|
| node --prof | Node.js | V8 CPU profiler |
| node --inspect | Node.js | 连接 Chrome DevTools |
| cProfile | Python | 内置 profiler |
| pprof | Go | 内置 profiler |
| perf | Linux | 系统级 profiler |
| dtrace/bpftrace | Linux/macOS | 动态追踪 |

### 常用命令

```bash
# Node.js: CPU profiling
node --prof app.js
node --prof-process isolate-*.log > profile.txt

# Node.js: 连接 Chrome DevTools
node --inspect-brk src/main.ts
# 然后在 Chrome 打开 chrome://inspect

# Python: cProfile
python -m cProfile -s cumulative main.py | head -30
# 或保存后可视化
python -m cProfile -o profile.out main.py
pip install snakeviz && snakeviz profile.out

# Go: pprof
import _ "net/http/pprof"
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30

# Linux: perf
perf record -g ./program
perf report
```

### 适用场景

- 性能优化（找到耗时最长的函数）
- 理解实际执行流程（哪些代码真正被执行了）
- 内存泄漏排查
- 验证架构假设（某个函数是否真的被调用了）

---

## 6. 火焰图

### 原理

将调用栈采样数据可视化：X 轴是时间占比（越宽 = 越耗时），Y 轴是调用深度（从底到顶 = 从 main 到叶子函数）。一眼看出"时间花在哪里"。

### 工具

| 工具 | 语言 | 安装 |
|---|---|---|
| 0x | Node.js | `npm install -g 0x` |
| py-spy | Python | `pip install py-spy` |
| pprof | Go | 内置 |
| flamegraph.pl | 通用 | `git clone https://github.com/brendangregg/FlameGraph` |
| speedscope | 通用 | `npm install -g speedscope` 或在线 speedscope.app |

### 常用命令

```bash
# Node.js: 一键火焰图
npx 0x app.js
# 自动打开交互式火焰图

# Python: 非侵入式（不需要修改代码）
py-spy record -o flame.svg -- python main.py
# 或附加到运行中的进程
py-spy record -o flame.svg --pid 12345

# Go
go tool pprof -http=:8080 cpu.prof
# 在浏览器中查看火焰图

# 通用: perf + flamegraph.pl
perf record -F 99 -g -- ./program
perf script | ./FlameGraph/stackcollapse-perf.pl | ./FlameGraph/flamegraph.pl > flame.svg

# 通用: speedscope（支持多种 profile 格式）
speedscope profile.json
# 或上传到 https://www.speedscope.app/
```

### 如何阅读火焰图

```
宽度 = 耗时占比（越宽 = 越值得优化）
高度 = 调用深度（越高 = 调用链越深）
颜色 = 通常随机，无特殊含义

查找方法：
1. 先看最宽的"平台"（耗时最多的函数）
2. 从底部往上追踪调用链
3. 比较同一层级的宽度差异
```

### 适用场景

- 性能瓶颈定位
- 对比优化前后的效果
- 理解运行时的实际调用深度

---

## 7. Git 考古与热点分析

### 原理

利用版本历史分析代码的演变：哪些文件改得最频繁（热点）、谁在改什么、哪些文件总是一起改（耦合）。不看代码内容，只看变更模式。

### 常用命令

```bash
# 热点文件（改得最多的 Top 20）
git log --format=format: --name-only | sort | uniq -c | sort -rn | head -20

# 代码作者分布
git shortlog -sn --all                   # 谁提交最多
git log --format='%aN' -- src/query.ts | sort | uniq -c | sort -rn  # 某文件的作者

# 文件共变分析（哪些文件总是一起改 → 高耦合）
git log --format=format: --name-only | awk 'BEGIN{RS=""} {for(i=1;i<=NF;i++) for(j=i+1;j<=NF;j++) print $i, $j}' | sort | uniq -c | sort -rn | head -20

# 某个函数/符号的完整演变历史
git log -p -S 'getSystemContext' -- src/context.ts

# 文件年龄（最后修改距今多久）
git log -1 --format='%ar' -- src/query.ts

# 代码变更频率（最近 30 天）
git log --since='30 days ago' --format=format: --name-only | sort | uniq -c | sort -rn | head -20

# 大规模重构的 commit（改了最多文件的提交）
git log --pretty=format:'%h %s' --shortstat | paste - - - | sort -t',' -k1 -rn | head -10
```

### 进阶工具

```bash
# code-maat: 专业的 git 历史分析工具
git log --all --numstat --date=short \
  --pretty=format:'--%h--%ad--%aN' --no-renames > gitlog.txt

java -jar code-maat.jar -l gitlog.txt -c git2 -a revisions   # 变更频率
java -jar code-maat.jar -l gitlog.txt -c git2 -a coupling     # 文件耦合度
java -jar code-maat.jar -l gitlog.txt -c git2 -a age          # 代码年龄

# git-of-theseus: 代码生存曲线
pip install git-of-theseus
git-of-theseus-analyze .
git-of-theseus-stack-plot cohorts.json   # 可视化代码年龄分布
```

### 适用场景

- 找到"改得最多 = 最可能有问题"的文件
- 发现隐式耦合（总是一起修改的文件可能应该合并或解耦）
- 了解团队分工和知识分布
- 决定代码审查的重点

---

## 8. 变更频率 × 复杂度交叉分析

### 原理

将 git 热点分析（变更频率）和代码复杂度两个维度交叉，形成四象限：

```
         高复杂度
            │
  需要重构  │  最危险（高复杂度 + 频繁修改）
  但不紧急  │  ← 优先重构这里
            │
───────────┼───────────
            │
  低风险    │  频繁修改但简单
  不用管    │  保持现状
            │
         低复杂度
    少修改          多修改
```

**右上角（高复杂度 + 频繁修改）= 最应该重构的代码。**

### 操作步骤

```bash
# 步骤 1: 获取变更频率
git log --format=format: --name-only --since='90 days ago' \
  | sort | uniq -c | sort -rn > /tmp/churn.txt

# 步骤 2: 获取复杂度（以 lizard 为例）
lizard src/ --csv > /tmp/complexity.csv

# 步骤 3: 交叉分析（用 Python 或 Excel）
# 合并两个数据源，画散点图，找右上角的文件
```

### 适用场景

- 制定重构优先级
- 技术债务评估
- 向管理层展示"为什么需要重构"

---

## 9. 架构决策挖掘

### 原理

代码中的注释、commit message、PR 描述中隐藏着架构决策的原因。搜索关键词可以快速定位"为什么这样设计"。

### 常用命令

```bash
# 搜索重要标记
grep -rn "IMPORTANT\|HACK\|TODO\|FIXME\|XXX\|WARN" src/ --include="*.ts"

# 搜索设计决策的解释
grep -rn "because\|reason\|workaround\|trade.off\|intentionally" src/ --include="*.ts"

# 搜索"不要改"的警告
grep -rn "do not change\|do not modify\|do not remove\|breaking change" src/ --include="*.ts" -i

# 搜索循环依赖相关的注释（很多架构拆分是为了避免循环）
grep -rn "circular\|cycle\|avoid.*import\|prevent.*import" src/ --include="*.ts" -i

# 从 commit message 挖掘
git log --all --grep="refactor\|breaking\|migrate\|deprecat" --oneline | head -20

# 从 PR 描述挖掘（GitHub）
gh pr list --state merged --limit 50 --json title,body \
  | jq '.[].title' | grep -i "refactor\|architect\|redesign"
```

### 实际案例

在 free-code45 中搜索到的架构决策：

```
// "Lives in its own file because it imports from context.ts and
// constants/prompts.ts, which are high in the dependency graph."
→ queryContext.ts 独立存在是为了避免循环依赖

// "IMPORTANT: Do not change adaptive thinking support without
// notifying the model launch DRI and research."
→ thinking 配置是敏感参数，修改需要跨团队协调

// "Subagents (agent:*) run in the same process and share
// module-level state with the main thread."
→ 子 agent 不是独立进程，共享状态需要特别小心
```

### 适用场景

- 理解"为什么不能简单重构"
- 新人快速理解项目约束
- 评估修改某段代码的风险

---

## 10. 目录结构与代码量可视化

### 原理

从宏观视角看项目的模块分布：哪个目录代码最多、文件如何组织、模块之间的大小比例。

### 常用命令

```bash
# 按目录统计代码行数
cloc src/ --by-file-by-lang              # 按文件和语言统计
cloc src/*/ --out=/dev/stdout            # 按顶级目录统计

# 目录大小排序
du -sh src/*/ | sort -rh

# 文件大小排序（找巨型文件）
find src/ -name "*.ts" -exec wc -l {} + | sort -rn | head -20

# 交互式目录大小可视化
npx code-complexity . --limit 30         # 复杂度排行

# 生成 treemap 可视化
# 工具: https://github.com/nickvdp/maptree 或在线 app.codescene.io
```

### 适用场景

- 初次接触项目，了解规模和结构
- 找到"上帝文件"（过大的文件通常需要拆分）
- 评估各模块的相对复杂度

---

## 11. 方法对比与选择指南

### 按目标选择

| 目标 | 推荐方法 | 工具 |
|---|---|---|
| 快速了解项目结构 | 目录结构 + cloc + 依赖图 | cloc, madge |
| 理解模块关系 | 静态依赖分析 | madge, pydeps |
| 理解函数调用链 | 调用图 | ts-callgraph, doxygen |
| 找到高风险代码 | 复杂度 × 变更频率 | lizard + git log |
| 性能优化 | 火焰图 + profiling | 0x, py-spy, perf |
| 理解设计决策 | 架构注释挖掘 + git 考古 | grep, git log |
| 重构评估 | 反向依赖 + 耦合分析 | madge, code-maat |

### 按阶段选择

| 阶段 | 方法 | 说明 |
|---|---|---|
| 刚接手项目 | 目录结构 → 依赖图 → 入口追踪 | 自顶向下建立全局认知 |
| 修复 bug | 调用图 → git blame → 运行时追踪 | 从症状定位到根因 |
| 准备重构 | 复杂度 → 热点 → 耦合分析 | 量化风险，确定优先级 |
| 性能优化 | profiling → 火焰图 → 调用图 | 从瓶颈到优化方案 |
| 代码审查 | 复杂度 → 架构注释 → 反向依赖 | 评估变更的影响范围 |

### 按有无运行环境选择

| 条件 | 可用方法 |
|---|---|
| 只有源码，不能运行 | 静态依赖、AST、复杂度、git 考古、架构注释 |
| 可以运行代码 | 以上全部 + 运行时追踪、火焰图、动态调用图 |
