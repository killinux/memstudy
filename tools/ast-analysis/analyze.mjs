#!/usr/bin/env node
/**
 * AST 分析：基于 ts-morph 对 free-code45 做多维度静态分析
 *
 * 用法：
 *   node analyze.mjs <project-root>
 *
 * 输出：
 *   - exports.json     每个文件的 export 清单
 *   - tools.json       所有 Tool 定义
 *   - commands.json    所有 Command 定义
 *   - functions.json   函数统计（参数数、复杂度、async 比例）
 *   - components.json  React 组件统计
 *   - imports.json     模块被引用次数排行
 *   - summary.md       人类可读总结
 */

import { Project, SyntaxKind } from 'ts-morph';
import { writeFileSync } from 'fs';
import { join } from 'path';

const projectRoot = process.argv[2] || '/opt/workspace/myclaude/free-code45';
const outputDir = process.argv[3] || '/tmp/ast-analysis/output';

console.log(`项目根目录: ${projectRoot}`);
console.log(`输出目录: ${outputDir}`);

// 创建输出目录
import { mkdirSync } from 'fs';
mkdirSync(outputDir, { recursive: true });

console.log('\n[1/7] 加载 TypeScript 项目...');
const project = new Project({
  tsConfigFilePath: join(projectRoot, 'tsconfig.json'),
  skipAddingFilesFromTsConfig: false,
});

const sourceFiles = project.getSourceFiles().filter(f => {
  const path = f.getFilePath();
  return path.includes('/src/') &&
         !path.includes('/node_modules/') &&
         !path.includes('.test.') &&
         !path.includes('.spec.');
});
console.log(`加载了 ${sourceFiles.length} 个源文件`);

const projectPathPrefix = projectRoot + '/';

function relPath(file) {
  return file.getFilePath().replace(projectPathPrefix, '');
}

// ─── 分析 1: 每个文件的 export 数 ───
console.log('\n[2/7] 分析 export...');
const exportStats = [];
for (const file of sourceFiles) {
  const exports = file.getExportedDeclarations();
  const namedExports = [];
  for (const [name, decls] of exports) {
    for (const decl of decls) {
      const kindName = decl.getKindName();
      namedExports.push({ name, kind: kindName });
    }
  }
  if (namedExports.length > 0) {
    exportStats.push({
      file: relPath(file),
      count: namedExports.length,
      exports: namedExports,
    });
  }
}
exportStats.sort((a, b) => b.count - a.count);
writeFileSync(join(outputDir, 'exports.json'), JSON.stringify(exportStats, null, 2));
console.log(`  总 export 数: ${exportStats.reduce((s, f) => s + f.count, 0)}`);
console.log(`  Top 3 export 最多的文件:`);
for (const f of exportStats.slice(0, 3)) {
  console.log(`    ${f.count.toString().padStart(4)}  ${f.file}`);
}

// ─── 分析 2: 找出所有 Tool 定义 ───
console.log('\n[3/7] 分析 Tool 定义...');
const tools = [];
for (const file of sourceFiles) {
  const path = relPath(file);
  // 只看 tools/ 目录下的 Tool 主文件（如 BashTool.tsx），跳过 utils 文件
  if (!path.includes('/tools/')) continue;

  for (const varStmt of file.getVariableStatements()) {
    if (!varStmt.isExported()) continue;
    for (const decl of varStmt.getDeclarations()) {
      const name = decl.getName();
      if (!name.endsWith('Tool')) continue;

      // 通用方法：在 const 内任意位置查找 name: 'XXX' 字段
      // 同时尝试找出包装函数（buildTool / createTool 等）
      const fullText = decl.getText();
      const wrapperMatch = fullText.match(/^\w+\s*=\s*(\w+)\s*[<({]/);
      const wrapper = wrapperMatch ? wrapperMatch[1] : null;

      // 查找最近的 name: 'xxx' 字段
      const nameMatch = fullText.match(/\bname:\s*['"`]([^'"`]+)['"`]/);
      const toolName = nameMatch ? nameMatch[1] : null;

      tools.push({
        varName: name,
        toolName: toolName,
        wrapper: wrapper,
        file: path,
        line: decl.getStartLineNumber(),
      });
    }
  }
}
writeFileSync(join(outputDir, 'tools.json'), JSON.stringify(tools, null, 2));
console.log(`  找到 ${tools.length} 个潜在 Tool 定义`);

// ─── 分析 3: 找所有 Command 定义 ───
console.log('\n[4/7] 分析 Command 定义...');
const commands = [];
for (const file of sourceFiles) {
  const path = relPath(file);
  if (!path.includes('/commands/')) continue;

  // 检查整个文件文本：是否包含 type: 'prompt'/'local'/'local-jsx' 这种 Command 形态
  const fileText = file.getFullText();
  // 找到所有 const xxx = { ... type: 'prompt' ... }
  const constRegex = /(?:const|let)\s+(\w+)\s*[=:]\s*[{<]/g;
  for (const declStmt of file.getVariableStatements()) {
    for (const decl of declStmt.getDeclarations()) {
      const declText = decl.getText();
      if (/\btype:\s*['"](local|prompt|local-jsx)['"]/i.test(declText)) {
        const nameMatch = declText.match(/\bname:\s*['"]([^'"]+)['"]/);
        const typeMatch = declText.match(/\btype:\s*['"](\w+(?:-\w+)?)['"]/);
        commands.push({
          varName: decl.getName(),
          name: nameMatch ? nameMatch[1] : null,
          type: typeMatch ? typeMatch[1] : null,
          exported: declStmt.isExported(),
          file: path,
          line: decl.getStartLineNumber(),
        });
      }
    }
  }
}
writeFileSync(join(outputDir, 'commands.json'), JSON.stringify(commands, null, 2));
console.log(`  找到 ${commands.length} 个 Command 定义`);

// ─── 分析 4: 函数统计（参数数、async/sync、generator） ───
console.log('\n[5/7] 函数统计...');
const funcStats = {
  total: 0,
  async: 0,
  generator: 0,
  asyncGenerator: 0,
  arrow: 0,
  named: 0,
  paramDistribution: {},
  topByParams: [],
};

const allFunctions = [];
for (const file of sourceFiles) {
  const path = relPath(file);
  const funcs = [
    ...file.getFunctions(),
    ...file.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ...file.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
  ];
  for (const fn of funcs) {
    funcStats.total++;
    if (fn.isAsync && fn.isAsync()) funcStats.async++;
    if (fn.isGenerator && fn.isGenerator()) {
      funcStats.generator++;
      if (fn.isAsync && fn.isAsync()) funcStats.asyncGenerator++;
    }
    if (fn.getKind() === SyntaxKind.ArrowFunction) funcStats.arrow++;
    else funcStats.named++;
    const params = fn.getParameters().length;
    funcStats.paramDistribution[params] = (funcStats.paramDistribution[params] || 0) + 1;
    allFunctions.push({
      name: fn.getName?.() || '<anonymous>',
      file: path,
      line: fn.getStartLineNumber(),
      params,
      async: fn.isAsync?.() || false,
    });
  }
}
allFunctions.sort((a, b) => b.params - a.params);
funcStats.topByParams = allFunctions.slice(0, 20);
writeFileSync(join(outputDir, 'functions.json'), JSON.stringify(funcStats, null, 2));
console.log(`  总函数数: ${funcStats.total}`);
console.log(`  async: ${funcStats.async} (${(funcStats.async/funcStats.total*100).toFixed(1)}%)`);
console.log(`  generator: ${funcStats.generator}`);
console.log(`  async generator: ${funcStats.asyncGenerator}`);
console.log(`  Top 函数参数数: ${allFunctions[0]?.params} (${allFunctions[0]?.name})`);

// ─── 分析 5: React 组件统计 ───
console.log('\n[6/7] React 组件统计...');
const components = [];
for (const file of sourceFiles) {
  if (!file.getFilePath().endsWith('.tsx')) continue;
  const path = relPath(file);

  // 找以大写字母开头的导出函数
  const allDecls = [
    ...file.getFunctions(),
    ...file.getVariableStatements().flatMap(v => v.getDeclarations()),
  ];
  for (const decl of allDecls) {
    const name = decl.getName?.() || '';
    if (!name || !/^[A-Z]/.test(name)) continue;

    let body;
    if (decl.getBody) body = decl.getBody?.();
    else {
      const init = decl.getInitializer?.();
      if (init && (init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression)) {
        body = init.getBody?.();
      }
    }
    if (!body) continue;

    const text = body.getText();
    // 简单启发式：包含 JSX 或 React.createElement
    if (!/<[A-Z][\w.]*[\s/>]|React\.createElement|jsx\(/.test(text)) continue;

    const useStateCount = (text.match(/useState\b/g) || []).length;
    const useEffectCount = (text.match(/useEffect\b/g) || []).length;
    const useCallbackCount = (text.match(/useCallback\b/g) || []).length;
    const useMemoCount = (text.match(/useMemo\b/g) || []).length;
    const useCustomCount = (text.match(/use[A-Z]\w+/g) || []).length;

    components.push({
      name,
      file: path,
      line: decl.getStartLineNumber?.() || 0,
      useState: useStateCount,
      useEffect: useEffectCount,
      useCallback: useCallbackCount,
      useMemo: useMemoCount,
      hooksTotal: useCustomCount,
    });
  }
}
components.sort((a, b) => b.hooksTotal - a.hooksTotal);
writeFileSync(join(outputDir, 'components.json'), JSON.stringify(components, null, 2));
console.log(`  找到 ${components.length} 个 React 组件`);

// ─── 分析 6: Import 排行（哪些模块被引用最多） ───
console.log('\n[7/7] Import 引用统计...');
const importCount = {};
for (const file of sourceFiles) {
  for (const imp of file.getImportDeclarations()) {
    const moduleSpecifier = imp.getModuleSpecifierValue();
    importCount[moduleSpecifier] = (importCount[moduleSpecifier] || 0) + 1;
  }
}
const importRanking = Object.entries(importCount)
  .map(([module, count]) => ({ module, count }))
  .sort((a, b) => b.count - a.count);
writeFileSync(join(outputDir, 'imports.json'), JSON.stringify(importRanking, null, 2));
console.log(`  总 import 语句: ${importRanking.reduce((s, i) => s + i.count, 0)}`);
console.log(`  唯一模块: ${importRanking.length}`);
console.log(`  Top 5 被引用最多:`);
for (const { module, count } of importRanking.slice(0, 5)) {
  console.log(`    ${count.toString().padStart(4)}  ${module}`);
}

// ─── 生成 Markdown 总结 ───
const summary = `# AST 分析报告

源文件数: ${sourceFiles.length}
总函数数: ${funcStats.total}
总 Export 数: ${exportStats.reduce((s, f) => s + f.count, 0)}
React 组件数: ${components.length}
Tool 定义数: ${tools.length}
Command 定义数: ${commands.length}

## 函数特征

| 特征 | 数量 | 比例 |
|---|---|---|
| async | ${funcStats.async} | ${(funcStats.async/funcStats.total*100).toFixed(1)}% |
| generator | ${funcStats.generator} | ${(funcStats.generator/funcStats.total*100).toFixed(1)}% |
| async generator | ${funcStats.asyncGenerator} | ${(funcStats.asyncGenerator/funcStats.total*100).toFixed(1)}% |
| arrow | ${funcStats.arrow} | ${(funcStats.arrow/funcStats.total*100).toFixed(1)}% |
| 命名函数 | ${funcStats.named} | ${(funcStats.named/funcStats.total*100).toFixed(1)}% |

## 参数数分布

| 参数数 | 函数数 |
|---|---|
${Object.entries(funcStats.paramDistribution).sort((a,b)=>+a[0]-+b[0]).map(([n,c])=>`| ${n} | ${c} |`).join('\n')}

## Export 最多的文件 Top 10

| Rank | Count | File |
|---|---|---|
${exportStats.slice(0, 10).map((f, i) => `| ${i+1} | ${f.count} | \`${f.file}\` |`).join('\n')}

## 被引用最多的模块 Top 20

| Rank | Count | Module |
|---|---|---|
${importRanking.slice(0, 20).map((m, i) => `| ${i+1} | ${m.count} | \`${m.module}\` |`).join('\n')}

## React 组件 Hook 使用最多 Top 10

| Component | useState | useEffect | useCallback | useMemo | Total Hooks | File |
|---|---|---|---|---|---|---|
${components.slice(0, 10).map(c => `| ${c.name} | ${c.useState} | ${c.useEffect} | ${c.useCallback} | ${c.useMemo} | ${c.hooksTotal} | \`${c.file}\` |`).join('\n')}
`;
writeFileSync(join(outputDir, 'summary.md'), summary);

console.log('\n✓ 完成！');
console.log(`  报告: ${join(outputDir, 'summary.md')}`);
