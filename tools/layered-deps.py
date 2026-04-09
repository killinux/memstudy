#!/usr/bin/env python3
"""
分层依赖图生成器

原理：
  1. 用 madge --json 获取完整依赖数据
  2. 从指定入口文件出发，按 BFS 逐层展开依赖
  3. 每一层生成一个 DOT 文件和 SVG 图片
  4. 同时生成一个全局概览图（只到指定深度）

用法：
  python3 layered-deps.py <madge_json> <entry_file> [max_depth]

示例：
  # 先导出 madge json
  cd /opt/workspace/myclaude/free-code45
  madge src/ --ts-config tsconfig.json --extensions ts,tsx,js,jsx --json 2>/dev/null > /tmp/deps.json

  # 生成分层图（默认 3 层）
  python3 layered-deps.py /tmp/deps.json context.ts 3
"""

import json
import subprocess
import sys
from collections import defaultdict, deque
from pathlib import Path

# ─── 颜色配置 ───
LAYER_COLORS = [
    "#ff9999",  # 层 0: 红色（入口）
    "#ffcc99",  # 层 1: 橙色
    "#ffff99",  # 层 2: 黄色
    "#99ff99",  # 层 3: 绿色
    "#99ccff",  # 层 4: 蓝色
    "#cc99ff",  # 层 5: 紫色
    "#ff99cc",  # 层 6: 粉色
]


def load_deps(json_path: str) -> dict[str, list[str]]:
    """加载 madge --json 输出"""
    with open(json_path) as f:
        return json.load(f)


def find_entry(deps: dict, name: str) -> str | None:
    """模糊匹配入口文件名"""
    # 精确匹配
    if name in deps:
        return name
    # 尾部匹配
    for key in deps:
        if key.endswith(name) or key.endswith("/" + name):
            return key
    return None


def bfs_layers(deps: dict, entry: str, max_depth: int) -> list[set[str]]:
    """BFS 分层：返回每层包含的文件集合"""
    visited = {entry}
    layers = [{entry}]
    frontier = {entry}

    for depth in range(1, max_depth + 1):
        next_frontier = set()
        for node in frontier:
            for dep in deps.get(node, []):
                if dep not in visited:
                    visited.add(dep)
                    next_frontier.add(dep)
        if not next_frontier:
            break
        layers.append(next_frontier)
        frontier = next_frontier

    return layers


def build_reverse_deps(deps: dict) -> dict[str, list[str]]:
    """构建反向依赖（谁依赖了我）"""
    reverse = defaultdict(list)
    for src, targets in deps.items():
        for t in targets:
            reverse[t].append(src)
    return reverse


def short_name(path: str) -> str:
    """缩短路径用于显示"""
    # 去掉 ../ 前缀
    while path.startswith("../"):
        path = path[3:]
    return path


def generate_layer_dot(
    deps: dict,
    layers: list[set[str]],
    layer_idx: int,
    entry: str,
) -> str:
    """生成单层 DOT：显示该层节点 + 它们的直接依赖"""
    current_nodes = layers[layer_idx]
    # 上一层节点（作为来源参考）
    prev_nodes = layers[layer_idx - 1] if layer_idx > 0 else set()
    # 下一层节点（作为目标参考）
    next_nodes = layers[layer_idx + 1] if layer_idx + 1 < len(layers) else set()

    # 收集本层的所有边
    edges = []
    all_nodes = set()

    for node in current_nodes:
        all_nodes.add(node)
        for dep in deps.get(node, []):
            # 只画到下一层或同层的边
            if dep in next_nodes or dep in current_nodes:
                edges.append((node, dep))
                all_nodes.add(dep)

    # 从上一层到本层的边
    for node in prev_nodes:
        for dep in deps.get(node, []):
            if dep in current_nodes:
                edges.append((node, dep))
                all_nodes.add(node)

    color = LAYER_COLORS[layer_idx % len(LAYER_COLORS)]
    prev_color = LAYER_COLORS[(layer_idx - 1) % len(LAYER_COLORS)] if layer_idx > 0 else "#cccccc"
    next_color = LAYER_COLORS[(layer_idx + 1) % len(LAYER_COLORS)] if layer_idx + 1 < len(layers) else "#cccccc"

    lines = [
        "digraph {",
        '  rankdir=LR;',
        '  node [shape=box, style=filled, fontsize=9];',
        f'  label="Layer {layer_idx}: {len(current_nodes)} files";',
        '  labelloc=t; fontsize=14;',
        "",
    ]

    for node in sorted(all_nodes):
        sn = short_name(node)
        if node in current_nodes:
            c = color
        elif node in prev_nodes:
            c = prev_color
        elif node in next_nodes:
            c = next_color
        else:
            c = "#eeeeee"
        lines.append(f'  "{sn}" [fillcolor="{c}"];')

    lines.append("")
    for src, dst in sorted(set(edges)):
        lines.append(f'  "{short_name(src)}" -> "{short_name(dst)}";')

    lines.append("}")
    return "\n".join(lines)


def generate_overview_dot(
    deps: dict,
    layers: list[set[str]],
    max_depth: int,
) -> str:
    """生成全局概览 DOT：所有层，按 subgraph 分组"""
    lines = [
        "digraph {",
        '  rankdir=TB;',
        '  node [shape=box, style=filled, fontsize=8];',
        f'  label="Dependency Layers (depth={max_depth}, {sum(len(l) for l in layers)} files)";',
        '  labelloc=t; fontsize=14;',
        '  compound=true;',
        "",
    ]

    all_in_scope = set()
    for layer in layers:
        all_in_scope |= layer

    # 按层分组
    for i, layer in enumerate(layers):
        color = LAYER_COLORS[i % len(LAYER_COLORS)]
        lines.append(f"  subgraph cluster_{i} {{")
        lines.append(f'    label="Layer {i} ({len(layer)} files)";')
        lines.append(f'    style=filled; color="{color}"; fillcolor="{color}20";')
        for node in sorted(layer):
            sn = short_name(node)
            lines.append(f'    "{sn}" [fillcolor="{color}"];')
        lines.append("  }")
        lines.append("")

    # 边：只画层间的
    edges = set()
    for layer in layers:
        for node in layer:
            for dep in deps.get(node, []):
                if dep in all_in_scope:
                    edges.add((short_name(node), short_name(dep)))

    for src, dst in sorted(edges):
        if src != dst:
            lines.append(f'  "{src}" -> "{dst}";')

    lines.append("}")
    return "\n".join(lines)


def render_dot(dot_content: str, dot_path: str, svg_path: str) -> bool:
    """写入 DOT 文件并渲染 SVG"""
    Path(dot_path).write_text(dot_content)
    try:
        result = subprocess.run(
            ["dot", "-Tsvg", dot_path, "-o", svg_path],
            capture_output=True,
            timeout=60,
        )
        if result.returncode == 0:
            return True
        print(f"  dot 渲染失败: {result.stderr.decode()[:200]}")
        return False
    except subprocess.TimeoutExpired:
        print(f"  dot 渲染超时（>60s），跳过")
        return False


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    json_path = sys.argv[1]
    entry_name = sys.argv[2]
    max_depth = int(sys.argv[3]) if len(sys.argv) > 3 else 3

    print(f"加载依赖数据: {json_path}")
    deps = load_deps(json_path)
    print(f"  共 {len(deps)} 个模块")

    entry = find_entry(deps, entry_name)
    if not entry:
        print(f"  找不到入口: {entry_name}")
        print(f"  可用的匹配: {[k for k in list(deps.keys())[:10]]}")
        sys.exit(1)
    print(f"  入口: {entry}")

    # BFS 分层
    layers = bfs_layers(deps, entry, max_depth)
    print(f"\n分层结果 (共 {max_depth} 层):")
    for i, layer in enumerate(layers):
        print(f"  Layer {i}: {len(layer)} 个文件")

    # 输出目录
    out_dir = Path(json_path).parent / f"layers-{Path(entry_name).stem}"
    out_dir.mkdir(exist_ok=True)
    print(f"\n输出目录: {out_dir}")

    # 生成每层的图
    for i in range(len(layers)):
        dot = generate_layer_dot(deps, layers, i, entry)
        dot_path = str(out_dir / f"layer-{i}.dot")
        svg_path = str(out_dir / f"layer-{i}.svg")
        ok = render_dot(dot, dot_path, svg_path)
        status = "OK" if ok else "FAILED"
        print(f"  Layer {i}: {len(layers[i]):>4} files → {svg_path} [{status}]")

    # 生成概览图
    overview_dot = generate_overview_dot(deps, layers, max_depth)
    dot_path = str(out_dir / "overview.dot")
    svg_path = str(out_dir / "overview.svg")
    ok = render_dot(overview_dot, dot_path, svg_path)
    status = "OK" if ok else "FAILED"
    print(f"  Overview: {sum(len(l) for l in layers):>4} files → {svg_path} [{status}]")

    # 生成汇总 Markdown
    md_lines = [
        f"# 分层依赖图：{entry_name}",
        "",
        f"入口文件: `{entry}`",
        f"最大深度: {max_depth}",
        f"总文件数: {sum(len(l) for l in layers)}",
        "",
        "## 层级概览",
        "",
        "| 层 | 文件数 | 说明 |",
        "|---|---|---|",
    ]
    layer_desc = ["入口模块", "直接依赖", "二级依赖", "三级依赖", "四级依赖", "五级依赖"]
    for i, layer in enumerate(layers):
        desc = layer_desc[i] if i < len(layer_desc) else f"{i}级依赖"
        md_lines.append(f"| Layer {i} | {len(layer)} | {desc} |")

    md_lines.extend([
        "",
        "## 图片",
        "",
        f"- [概览图](overview.svg) — 所有层的全局视图",
    ])
    for i in range(len(layers)):
        md_lines.append(f"- [Layer {i}](layer-{i}.svg) — {layer_desc[i] if i < len(layer_desc) else f'{i}级依赖'}")

    md_lines.extend([
        "",
        "## 每层文件清单",
        "",
    ])
    for i, layer in enumerate(layers):
        md_lines.append(f"### Layer {i}")
        md_lines.append("")
        for f in sorted(layer):
            md_lines.append(f"- `{short_name(f)}`")
        md_lines.append("")

    (out_dir / "README.md").write_text("\n".join(md_lines))
    print(f"\n  README: {out_dir / 'README.md'}")
    print("\n完成!")


if __name__ == "__main__":
    main()
