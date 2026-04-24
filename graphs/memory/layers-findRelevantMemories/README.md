# 分层依赖图：memdir/findRelevantMemories.ts

入口文件: `memdir/findRelevantMemories.ts`
最大深度: 2
总文件数: 37

## 层级概览

| 层 | 文件数 | 说明 |
|---|---|---|
| Layer 0 | 1 | 入口模块 |
| Layer 1 | 6 | 直接依赖 |
| Layer 2 | 30 | 二级依赖 |

## 图片

- [概览图](overview.svg) — 所有层的全局视图
- [Layer 0](layer-0.svg) — 入口模块
- [Layer 1](layer-1.svg) — 直接依赖
- [Layer 2](layer-2.svg) — 二级依赖

## 每层文件清单

### Layer 0

- `memdir/findRelevantMemories.ts`

### Layer 1

- `memdir/memoryScan.ts`
- `utils/debug.ts`
- `utils/errors.ts`
- `utils/model/model.ts`
- `utils/sideQuery.ts`
- `utils/slowOperations.ts`

### Layer 2

- `bootstrap/state.ts`
- `constants/betas.ts`
- `constants/figures.ts`
- `constants/system.ts`
- `memdir/memoryTypes.ts`
- `services/analytics/index.ts`
- `services/analytics/metadata.ts`
- `services/api/claude.ts`
- `services/api/client.ts`
- `utils/auth.ts`
- `utils/betas.ts`
- `utils/bufferedWriter.ts`
- `utils/cleanupRegistry.ts`
- `utils/context.ts`
- `utils/debugFilter.ts`
- `utils/envUtils.ts`
- `utils/fingerprint.ts`
- `utils/frontmatterParser.ts`
- `utils/fsOperations.ts`
- `utils/model/aliases.ts`
- `utils/model/antModels.ts`
- `utils/model/modelAllowlist.ts`
- `utils/model/modelStrings.ts`
- `utils/model/providers.ts`
- `utils/modelCost.ts`
- `utils/permissions/PermissionMode.ts`
- `utils/process.ts`
- `utils/readFileInRange.ts`
- `utils/settings/settings.ts`
- `utils/stringUtils.ts`
