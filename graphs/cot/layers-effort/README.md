# 分层依赖图：effort.ts

入口文件: `utils/effort.ts`
最大深度: 2
总文件数: 59

## 层级概览

| 层 | 文件数 | 说明 |
|---|---|---|
| Layer 0 | 1 | 入口模块 |
| Layer 1 | 8 | 直接依赖 |
| Layer 2 | 50 | 二级依赖 |

## 图片

- [概览图](overview.svg) — 所有层的全局视图
- [Layer 0](layer-0.svg) — 入口模块
- [Layer 1](layer-1.svg) — 直接依赖
- [Layer 2](layer-2.svg) — 二级依赖

## 每层文件清单

### Layer 0

- `utils/effort.ts`

### Layer 1

- `entrypoints/sdk/runtimeTypes.ts`
- `services/analytics/growthbook.ts`
- `utils/auth.ts`
- `utils/envUtils.ts`
- `utils/model/modelSupportOverrides.ts`
- `utils/model/providers.ts`
- `utils/settings/settings.ts`
- `utils/thinking.ts`

### Layer 2

- `bootstrap/state.ts`
- `constants/keys.ts`
- `constants/oauth.ts`
- `services/analytics/firstPartyEventLogger.ts`
- `services/analytics/index.ts`
- `services/mockRateLimits.ts`
- `services/oauth/client.ts`
- `services/oauth/codex-client.ts`
- `services/oauth/getOauthProfile.ts`
- `services/remoteManagedSettings/syncCacheState.ts`
- `utils/array.ts`
- `utils/authFileDescriptor.ts`
- `utils/authPortable.ts`
- `utils/aws.ts`
- `utils/awsAuthStatusManager.ts`
- `utils/betas.ts`
- `utils/config.ts`
- `utils/debug.ts`
- `utils/diagLogs.ts`
- `utils/errors.ts`
- `utils/execFileNoThrow.ts`
- `utils/file.ts`
- `utils/fileRead.ts`
- `utils/fsOperations.ts`
- `utils/git/gitignore.ts`
- `utils/http.ts`
- `utils/json.ts`
- `utils/lockfile.ts`
- `utils/log.ts`
- `utils/memoize.ts`
- `utils/model/model.ts`
- `utils/model/modelStrings.ts`
- `utils/platform.ts`
- `utils/secureStorage/index.ts`
- `utils/secureStorage/keychainPrefetch.ts`
- `utils/secureStorage/macOsKeychainHelpers.ts`
- `utils/settings/constants.ts`
- `utils/settings/internalWrites.ts`
- `utils/settings/managedPath.ts`
- `utils/settings/mdm/settings.ts`
- `utils/settings/settingsCache.ts`
- `utils/settings/types.ts`
- `utils/settings/validation.ts`
- `utils/signal.ts`
- `utils/sleep.ts`
- `utils/slowOperations.ts`
- `utils/startupProfiler.ts`
- `utils/theme.ts`
- `utils/toolSchemaCache.ts`
- `utils/user.ts`
