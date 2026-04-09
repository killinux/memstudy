# 分层依赖图：thinking.ts

入口文件: `utils/thinking.ts`
最大深度: 3
总文件数: 117

## 层级概览

| 层 | 文件数 | 说明 |
|---|---|---|
| Layer 0 | 1 | 入口模块 |
| Layer 1 | 6 | 直接依赖 |
| Layer 2 | 41 | 二级依赖 |
| Layer 3 | 69 | 三级依赖 |

## 图片

- [概览图](overview.svg) — 所有层的全局视图
- [Layer 0](layer-0.svg) — 入口模块
- [Layer 1](layer-1.svg) — 直接依赖
- [Layer 2](layer-2.svg) — 二级依赖
- [Layer 3](layer-3.svg) — 三级依赖

## 每层文件清单

### Layer 0

- `utils/thinking.ts`

### Layer 1

- `services/analytics/growthbook.ts`
- `utils/model/model.ts`
- `utils/model/modelSupportOverrides.ts`
- `utils/model/providers.ts`
- `utils/settings/settings.ts`
- `utils/theme.ts`

### Layer 2

- `bootstrap/state.ts`
- `constants/figures.ts`
- `constants/keys.ts`
- `services/analytics/firstPartyEventLogger.ts`
- `services/analytics/index.ts`
- `services/remoteManagedSettings/syncCacheState.ts`
- `utils/array.ts`
- `utils/auth.ts`
- `utils/config.ts`
- `utils/context.ts`
- `utils/debug.ts`
- `utils/diagLogs.ts`
- `utils/env.ts`
- `utils/envUtils.ts`
- `utils/errors.ts`
- `utils/file.ts`
- `utils/fileRead.ts`
- `utils/fsOperations.ts`
- `utils/git/gitignore.ts`
- `utils/http.ts`
- `utils/json.ts`
- `utils/log.ts`
- `utils/model/aliases.ts`
- `utils/model/antModels.ts`
- `utils/model/modelAllowlist.ts`
- `utils/model/modelStrings.ts`
- `utils/modelCost.ts`
- `utils/permissions/PermissionMode.ts`
- `utils/platform.ts`
- `utils/settings/constants.ts`
- `utils/settings/internalWrites.ts`
- `utils/settings/managedPath.ts`
- `utils/settings/mdm/settings.ts`
- `utils/settings/settingsCache.ts`
- `utils/settings/types.ts`
- `utils/settings/validation.ts`
- `utils/signal.ts`
- `utils/slowOperations.ts`
- `utils/startupProfiler.ts`
- `utils/stringUtils.ts`
- `utils/user.ts`

### Layer 3

- `bridge/bridgeEnabled.ts`
- `buddy/types.ts`
- `constants/betas.ts`
- `constants/oauth.ts`
- `constants/xml.ts`
- `entrypoints/agentSdkTypes.ts`
- `entrypoints/sandboxTypes.ts`
- `memdir/paths.ts`
- `memdir/teamMemPaths.ts`
- `schemas/hooks.ts`
- `services/mcp/types.ts`
- `services/mockRateLimits.ts`
- `services/oauth/client.ts`
- `services/oauth/codex-client.ts`
- `services/oauth/getOauthProfile.ts`
- `tools/AgentTool/agentColorManager.ts`
- `types/hooks.ts`
- `types/ids.ts`
- `types/logs.ts`
- `types/permissions.ts`
- `utils/authFileDescriptor.ts`
- `utils/authPortable.ts`
- `utils/aws.ts`
- `utils/awsAuthStatusManager.ts`
- `utils/betas.ts`
- `utils/bufferedWriter.ts`
- `utils/bundledMode.ts`
- `utils/cachePaths.ts`
- `utils/cleanupRegistry.ts`
- `utils/configConstants.ts`
- `utils/crypto.ts`
- `utils/cwd.ts`
- `utils/debugFilter.ts`
- `utils/displayTags.ts`
- `utils/effort.ts`
- `utils/execFileNoThrow.ts`
- `utils/fastMode.ts`
- `utils/fileReadCache.ts`
- `utils/findExecutable.ts`
- `utils/git.ts`
- `utils/imageResizer.ts`
- `utils/jsonRead.ts`
- `utils/lazySchema.ts`
- `utils/lockfile.ts`
- `utils/memoize.ts`
- `utils/memory/types.ts`
- `utils/model/bedrock.ts`
- `utils/model/configs.ts`
- `utils/model/modelCapabilities.ts`
- `utils/model/modelOptions.ts`
- `utils/path.ts`
- `utils/plugins/schemas.ts`
- `utils/privacyLevel.ts`
- `utils/process.ts`
- `utils/profilerBase.ts`
- `utils/secureStorage/index.ts`
- `utils/secureStorage/keychainPrefetch.ts`
- `utils/secureStorage/macOsKeychainHelpers.ts`
- `utils/sequential.ts`
- `utils/settings/mdm/constants.ts`
- `utils/settings/mdm/rawRead.ts`
- `utils/settings/permissionValidation.ts`
- `utils/settings/schemaOutput.ts`
- `utils/settings/validationTips.ts`
- `utils/sleep.ts`
- `utils/toolSchemaCache.ts`
- `utils/userAgent.ts`
- `utils/which.ts`
- `utils/workloadContext.ts`
