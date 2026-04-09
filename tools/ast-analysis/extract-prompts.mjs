#!/usr/bin/env node
/**
 * Prompt 提取器：从 free-code45 中提取所有 prompt 字符串
 *
 * 提取策略：
 * 1. 找所有 export const xxx = '...' 的字符串常量（template literal 或 string literal）
 * 2. 找所有 function getXxxPrompt() / getXxxSection() 函数体里的字符串
 * 3. 按文件归类: constants/prompts.ts, tools/X/prompt.ts, commands/X, 其他
 *
 * 输出：
 *   prompts/<category>/<filename>.txt  — 提取的纯文本 prompt
 *   prompts/index.json                  — 索引和元数据
 *   prompts/stats.json                  — 统计数据
 */

import { Project, SyntaxKind } from 'ts-morph';
import { writeFileSync, mkdirSync } from 'fs';
import { join, basename, dirname } from 'path';

const projectRoot = process.argv[2] || '/opt/workspace/myclaude/free-code45';
const outputDir = process.argv[3] || '/tmp/prompts-output';

mkdirSync(outputDir, { recursive: true });
mkdirSync(join(outputDir, 'tools'), { recursive: true });
mkdirSync(join(outputDir, 'system'), { recursive: true });
mkdirSync(join(outputDir, 'services'), { recursive: true });
mkdirSync(join(outputDir, 'utils'), { recursive: true });

console.log('加载 TypeScript 项目...');
const project = new Project({
  tsConfigFilePath: join(projectRoot, 'tsconfig.json'),
});

const projectPathPrefix = projectRoot + '/';
const relPath = f => f.getFilePath().replace(projectPathPrefix, '');

// 只看 prompt 相关文件
const promptFiles = project.getSourceFiles().filter(f => {
  const path = f.getFilePath();
  return path.includes('/src/') &&
         (path.endsWith('/prompt.ts') ||
          path.endsWith('/prompts.ts') ||
          path.endsWith('constants/prompts.ts'));
});

console.log(`发现 ${promptFiles.length} 个 prompt 文件`);

const allPrompts = [];

function categorize(path) {
  if (path.includes('/tools/')) return 'tools';
  if (path.includes('/services/')) return 'services';
  if (path.includes('/constants/')) return 'system';
  if (path.includes('/commands/')) return 'commands';
  if (path.includes('/buddy/')) return 'system';
  return 'utils';
}

function extractStringContent(node) {
  // StringLiteral: '...'
  if (node.getKind() === SyntaxKind.StringLiteral) {
    return node.getLiteralValue();
  }
  // NoSubstitutionTemplateLiteral: `...`
  if (node.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return node.getLiteralValue();
  }
  // TemplateExpression: `...${var}...`
  if (node.getKind() === SyntaxKind.TemplateExpression) {
    // 提取所有静态部分，把变量替换成占位符
    const head = node.getHead().getLiteralText();
    let result = head;
    for (const span of node.getTemplateSpans()) {
      const exprText = span.getExpression().getText();
      result += `\${${exprText}}`;
      result += span.getLiteral().getLiteralText();
    }
    return result;
  }
  return null;
}

function isPromptLike(text) {
  if (!text || text.length < 30) return false;
  // 至少有一定的句子结构（不是简单的标识符或路径）
  if (!/[.\n]/.test(text)) return false;
  return true;
}

// ─── 提取 ───
for (const file of promptFiles) {
  const path = relPath(file);
  const category = categorize(path);
  const fileBasename = basename(dirname(path)) + '__' + basename(path).replace(/\.ts$/, '');
  const prompts = [];

  // 1. 顶层 const 字符串导出
  for (const varStmt of file.getVariableStatements()) {
    if (!varStmt.isExported()) continue;
    for (const decl of varStmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      const text = extractStringContent(init);
      if (text && isPromptLike(text)) {
        prompts.push({
          kind: 'export-const',
          name: decl.getName(),
          line: decl.getStartLineNumber(),
          length: text.length,
          text: text,
        });
      }
    }
  }

  // 2. 函数返回的字符串（getXxxPrompt / getXxxSection / renderPromptTemplate 等）
  const allFunctions = [
    ...file.getFunctions(),
    ...file.getDescendantsOfKind(SyntaxKind.ArrowFunction),
  ];
  for (const fn of allFunctions) {
    const fnName = fn.getName?.() || '';
    // 只关注名字像 prompt 相关的函数
    if (!/(prompt|section|instruction|template|description)/i.test(fnName)) continue;
    const body = fn.getBody?.();
    if (!body) continue;

    // 找 return 语句里的字符串字面量
    const returnStmts = body.getDescendantsOfKind(SyntaxKind.ReturnStatement);
    for (const ret of returnStmts) {
      const expr = ret.getExpression();
      if (!expr) continue;
      const text = extractStringContent(expr);
      if (text && isPromptLike(text)) {
        prompts.push({
          kind: 'function-return',
          name: fnName,
          line: ret.getStartLineNumber(),
          length: text.length,
          text: text,
        });
      }
    }
  }

  if (prompts.length === 0) continue;

  // 写入分类目录
  const outFile = join(outputDir, category, fileBasename + '.txt');
  let content = `// FILE: ${path}\n// CATEGORY: ${category}\n// PROMPTS: ${prompts.length}\n\n`;
  for (const p of prompts) {
    content += `${'='.repeat(80)}\n`;
    content += `[${p.kind}] ${p.name} @ line ${p.line} (${p.length} chars)\n`;
    content += `${'='.repeat(80)}\n`;
    content += p.text;
    content += '\n\n';
  }
  writeFileSync(outFile, content);

  for (const p of prompts) {
    allPrompts.push({
      file: path,
      category: category,
      kind: p.kind,
      name: p.name,
      line: p.line,
      length: p.length,
    });
  }
}

console.log(`提取了 ${allPrompts.length} 个 prompt 段`);

// ─── 统计 ───
const stats = {
  totalPrompts: allPrompts.length,
  totalChars: allPrompts.reduce((s, p) => s + p.length, 0),
  byCategory: {},
  byFile: {},
  topByLength: [...allPrompts].sort((a, b) => b.length - a.length).slice(0, 30),
};

for (const p of allPrompts) {
  if (!stats.byCategory[p.category]) {
    stats.byCategory[p.category] = { count: 0, totalChars: 0 };
  }
  stats.byCategory[p.category].count++;
  stats.byCategory[p.category].totalChars += p.length;

  if (!stats.byFile[p.file]) {
    stats.byFile[p.file] = { count: 0, totalChars: 0 };
  }
  stats.byFile[p.file].count++;
  stats.byFile[p.file].totalChars += p.length;
}

writeFileSync(join(outputDir, 'index.json'), JSON.stringify(allPrompts, null, 2));
writeFileSync(join(outputDir, 'stats.json'), JSON.stringify(stats, null, 2));

console.log('\n=== 统计 ===');
console.log(`总字符数: ${stats.totalChars}`);
console.log(`估算 token 数: ~${Math.round(stats.totalChars / 4)}`);
console.log('\n按类别:');
for (const [cat, info] of Object.entries(stats.byCategory)) {
  console.log(`  ${cat.padEnd(12)} ${info.count.toString().padStart(4)} prompts, ${info.totalChars.toString().padStart(7)} chars`);
}

console.log('\nTop 10 最长 prompt:');
for (const p of stats.topByLength.slice(0, 10)) {
  console.log(`  ${p.length.toString().padStart(6)}  ${p.kind.padEnd(15)} ${p.name.padEnd(35)} ${p.file}`);
}

console.log(`\n输出目录: ${outputDir}`);
