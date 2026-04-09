#!/usr/bin/env node
/**
 * Prompt 分析器：基于 extract-prompts 的输出做指令密度和模式分析
 *
 * 用法: node analyze-prompts.mjs <prompts-output-dir>
 */

import { readFileSync, readdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

const inputDir = process.argv[2] || '/tmp/prompts-output';

// ─── 加载所有提取的 prompt 文本 ───
const allPrompts = [];
const categories = ['system', 'tools', 'services', 'utils'];

for (const cat of categories) {
  const catDir = join(inputDir, cat);
  let files;
  try {
    files = readdirSync(catDir);
  } catch {
    continue;
  }
  for (const f of files) {
    if (!f.endsWith('.txt')) continue;
    const content = readFileSync(join(catDir, f), 'utf-8');
    // 解析每个 prompt 段
    const sections = content.split(/={80}\n/);
    for (let i = 1; i < sections.length; i += 2) {
      const header = sections[i].trim();
      const body = (sections[i + 1] || '').trim();
      if (!body) continue;
      const headerMatch = header.match(/\[([^\]]+)\] (\S+) @ line (\d+) \((\d+) chars\)/);
      if (!headerMatch) continue;
      allPrompts.push({
        category: cat,
        sourceFile: f.replace('.txt', ''),
        kind: headerMatch[1],
        name: headerMatch[2],
        line: +headerMatch[3],
        length: +headerMatch[4],
        text: body,
      });
    }
  }
}

console.log(`加载了 ${allPrompts.length} 个 prompt 段`);

// ─── 关键词分析 ───
const KEYWORDS = {
  // 强约束（命令式）
  'IMPORTANT': /\bIMPORTANT\b/g,
  'MUST': /\bMUST\b/g,
  'NEVER': /\bNEVER\b/g,
  'ALWAYS': /\bALWAYS\b/g,
  'REQUIRED': /\bREQUIRED\b/g,
  'CRITICAL': /\bCRITICAL\b/g,
  'DO NOT': /\bDO NOT\b/g,

  // 弱约束（建议）
  'should': /\bshould\b/g,
  'should not': /\bshould not\b/g,
  'recommended': /\brecommended\b/g,
  'prefer': /\bprefer(red)?\b/g,
  'avoid': /\bavoid\b/g,

  // 元指令
  'example': /\bexample\b/gi,
  '<example>': /<example>/g,

  // 安全相关
  'security': /\bsecurity\b/gi,
  'permission': /\bpermission\b/gi,
  'safe': /\bsafe\b/gi,
  'dangerous': /\bdangerous\b/gi,

  // 协作相关
  'user': /\buser\b/gi,
  'tool': /\btool\b/gi,
};

function countKeywords(text) {
  const result = {};
  for (const [key, regex] of Object.entries(KEYWORDS)) {
    const matches = text.match(regex) || [];
    result[key] = matches.length;
  }
  return result;
}

// ─── 计算每个 prompt 的指令密度 ───
const enrichedPrompts = allPrompts.map(p => {
  const counts = countKeywords(p.text);
  const totalHardRules = counts['IMPORTANT'] + counts['MUST'] + counts['NEVER'] +
                          counts['ALWAYS'] + counts['CRITICAL'] + counts['DO NOT'] +
                          counts['REQUIRED'];
  const totalSoftRules = counts['should'] + counts['recommended'] + counts['prefer'] +
                          counts['avoid'];
  const density = (totalHardRules + totalSoftRules) / (p.length / 1000);  // per 1000 chars
  return {
    ...p,
    keywords: counts,
    hardRules: totalHardRules,
    softRules: totalSoftRules,
    density: Math.round(density * 10) / 10,
  };
});

// ─── 总体统计 ───
const overall = {
  totalPrompts: enrichedPrompts.length,
  totalChars: enrichedPrompts.reduce((s, p) => s + p.length, 0),
  totalHardRules: enrichedPrompts.reduce((s, p) => s + p.hardRules, 0),
  totalSoftRules: enrichedPrompts.reduce((s, p) => s + p.softRules, 0),
  byCategory: {},
};

for (const p of enrichedPrompts) {
  if (!overall.byCategory[p.category]) {
    overall.byCategory[p.category] = {
      count: 0, totalChars: 0, hardRules: 0, softRules: 0,
    };
  }
  const c = overall.byCategory[p.category];
  c.count++;
  c.totalChars += p.length;
  c.hardRules += p.hardRules;
  c.softRules += p.softRules;
}

// ─── 排行榜 ───
const topByDensity = [...enrichedPrompts]
  .filter(p => p.length > 200)  // 太短的不算
  .sort((a, b) => b.density - a.density)
  .slice(0, 15);

const topByHardRules = [...enrichedPrompts]
  .sort((a, b) => b.hardRules - a.hardRules)
  .slice(0, 15);

const topByLength = [...enrichedPrompts]
  .sort((a, b) => b.length - a.length)
  .slice(0, 15);

// ─── 输出 ───
const report = {
  overall,
  topByDensity,
  topByHardRules,
  topByLength,
  enrichedPrompts: enrichedPrompts.map(p => {
    const { text, ...rest } = p;
    return rest;  // 不输出全文，太大
  }),
};

writeFileSync(join(inputDir, 'analysis.json'), JSON.stringify(report, null, 2));

// ─── 控制台输出 ───
console.log('\n=== 总体 ===');
console.log(`总 prompt 数: ${overall.totalPrompts}`);
console.log(`总字符数: ${overall.totalChars}`);
console.log(`估算 token: ~${Math.round(overall.totalChars / 4)}`);
console.log(`硬约束总数 (IMPORTANT/MUST/NEVER/ALWAYS/CRITICAL/DO NOT/REQUIRED): ${overall.totalHardRules}`);
console.log(`软约束总数 (should/recommended/prefer/avoid): ${overall.totalSoftRules}`);
console.log(`硬:软 比例 = 1 : ${(overall.totalSoftRules / overall.totalHardRules).toFixed(2)}`);

console.log('\n按类别:');
for (const [cat, info] of Object.entries(overall.byCategory)) {
  const density = ((info.hardRules + info.softRules) / (info.totalChars / 1000)).toFixed(1);
  console.log(`  ${cat.padEnd(12)} ${info.count.toString().padStart(3)} prompts | ${info.totalChars.toString().padStart(6)} chars | hard=${info.hardRules.toString().padStart(3)} soft=${info.softRules.toString().padStart(3)} | 密度=${density}/k`);
}

console.log('\nTop 10 指令密度最高 (rules per 1000 chars):');
for (const p of topByDensity.slice(0, 10)) {
  console.log(`  密度 ${p.density.toString().padStart(5)}  hard=${p.hardRules.toString().padStart(2)} soft=${p.softRules.toString().padStart(2)}  ${p.name.padEnd(30)} ${p.sourceFile}`);
}

console.log('\nTop 10 硬规则最多:');
for (const p of topByHardRules.slice(0, 10)) {
  console.log(`  hard=${p.hardRules.toString().padStart(3)}  ${p.length.toString().padStart(5)} chars  ${p.name.padEnd(30)} ${p.sourceFile}`);
}

console.log('\nTop 10 最长 prompt:');
for (const p of topByLength.slice(0, 10)) {
  console.log(`  ${p.length.toString().padStart(6)}  hard=${p.hardRules.toString().padStart(2)}  ${p.name.padEnd(30)} ${p.sourceFile}`);
}

console.log(`\n详细数据写入: ${join(inputDir, 'analysis.json')}`);
