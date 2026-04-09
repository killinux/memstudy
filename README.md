# memstudy

Claude Code 源码学习笔记 — 基于 free-code45 (v2.1.87) 的架构分析，注重学习方法。

## 目录结构

```
memstudy/
├── docs/                              # 分析文档（Markdown + HTML）
│   ├── context-management-explained   # Context 管理系统详解
│   ├── cot-thinking-design            # CoT / Extended Thinking 设计详解
│   └── madge-guide                    # Madge 依赖分析工具使用指南
│
├── graphs/                            # 依赖关系图（每个子目录含 README 解释原理）
│   ├── context/                       # Context 管理模块
│   │   ├── context-focused.svg/dot    #   核心依赖图（手工精选，24 节点）
│   │   └── layers-context/            #   分层依赖图（BFS 3 层，156 文件）
│   │
│   ├── cot/                           # CoT / Extended Thinking 模块
│   │   ├── cot-overview.svg/dot       #   三层架构全景图（手工精选）
│   │   ├── layers-thinking/           #   thinking.ts 分层图（3 层，117 文件）
│   │   └── layers-effort/             #   effort.ts 分层图（2 层，59 文件）
│   │
│   ├── agent-loop/                    # Agent Loop 协调中枢
│   │   ├── agent-loop-overview.svg    #   完整数据流图（10 步编号路径）
│   │   └── layers-query/              #   query.ts 分层图（2 层，269 文件）
│   │
│   └── tools/                         # Tool 系统（核心抽象）
│       ├── tool-system-overview.svg   #   4 层架构图（接口/注册/分类/执行）
│       ├── tool-categories.svg        #   42 个工具按分类
│       └── layers-tool/               #   Tool.ts 分层图（3 层，533 文件）
│
├── tools/                             # 可复用工具脚本
│   ├── layered-deps.py                # 分层依赖图生成器（BFS + Graphviz）
│   └── md2html.py                     # Markdown → HTML5 转换器（暗色模式）
│
└── reports/                           # 使用报告
    └── report.html                    # Claude Code Insights 使用分析报告
```

## 文档概览

### Context 管理系统 (`docs/context-management-explained`)

分析 Claude Code 如何构建、注入和压缩对话上下文：
- 两个核心函数：`getSystemContext()`（git 状态）、`getUserContext()`（CLAUDE.md）
- 两级压缩：microCompact（清理工具输出）→ compact（API 生成摘要）
- 自动压缩触发机制和 token 阈值计算
- 完整的 7 阶段生命周期示例

### CoT / Extended Thinking (`docs/cot-thinking-design`)

分析 Claude Code 的三层思考架构：
- ThinkingConfig：adaptive（自适应）/ enabled+budget（固定预算）/ disabled
- Effort：low / medium / high / max 四级深度控制
- Ultrathink：关键词触发的临时深度提升
- 流式响应处理、密码学签名、Redacted Thinking、子 Agent 继承策略

### Madge 使用指南 (`docs/madge-guide`)

JS/TS 项目依赖分析的完整操作手册：
- 基本用法：依赖列表、循环检测、反向依赖、孤立文件
- 可视化：SVG/PNG 生成、DOT 语法、手写精准依赖图
- 分层生成：大项目避免 OOM 的 BFS 分层方案
- 常见问题排查

## 工具使用

### 分层依赖图生成

```bash
# 1. 导出 madge JSON
madge src/ --ts-config tsconfig.json --extensions ts,tsx,js,jsx \
  --json 2>/dev/null > deps.json

# 2. 从入口文件分层生成（默认 3 层）
python3 tools/layered-deps.py deps.json context.ts 3
```

### Markdown 转 HTML

```bash
python3 tools/md2html.py docs/some-doc.md
```
