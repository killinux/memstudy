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
├── graphs/                            # 依赖关系图
│   ├── context-focused.svg/dot        # context.ts 核心依赖图（手工精选）
│   └── layers-context/                # context.ts 分层依赖图（自动生成）
│       ├── overview.svg               #   全局概览（156 个节点，按层着色）
│       ├── layer-0.svg                #   Layer 0: 入口（1 文件）
│       ├── layer-1.svg                #   Layer 1: 直接依赖（9 文件）
│       ├── layer-2.svg                #   Layer 2: 二级依赖（41 文件）
│       └── layer-3.svg                #   Layer 3: 三级依赖（105 文件）
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
