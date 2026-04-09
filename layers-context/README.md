# 分层依赖图：context.ts

入口文件: `context.ts`
最大深度: 3
总文件数: 156

## 层级概览

| 层 | 文件数 | 说明 |
|---|---|---|
| Layer 0 | 1 | 入口模块 |
| Layer 1 | 9 | 直接依赖 |
| Layer 2 | 41 | 二级依赖 |
| Layer 3 | 105 | 三级依赖 |

## 图片

- [概览图](overview.svg) — 所有层的全局视图
- [Layer 0](layer-0.svg) — 入口模块
- [Layer 1](layer-1.svg) — 直接依赖
- [Layer 2](layer-2.svg) — 二级依赖
- [Layer 3](layer-3.svg) — 三级依赖

## 每层文件清单

### Layer 0

- `context.ts`

### Layer 1

- `bootstrap/state.ts`
- `constants/common.ts`
- `utils/claudemd.ts`
- `utils/diagLogs.ts`
- `utils/envUtils.ts`
- `utils/execFileNoThrow.ts`
- `utils/git.ts`
- `utils/gitSettings.ts`
- `utils/log.ts`

### Layer 2

- `constants/files.ts`
- `constants/xml.ts`
- `entrypoints/agentSdkTypes.ts`
- `memdir/memdir.ts`
- `memdir/paths.ts`
- `memdir/teamMemPaths.ts`
- `services/analytics/growthbook.ts`
- `services/analytics/index.ts`
- `tools/AgentTool/agentColorManager.ts`
- `types/hooks.ts`
- `types/ids.ts`
- `types/logs.ts`
- `utils/cachePaths.ts`
- `utils/config.ts`
- `utils/crypto.ts`
- `utils/cwd.ts`
- `utils/debug.ts`
- `utils/detectRepository.ts`
- `utils/displayTags.ts`
- `utils/errors.ts`
- `utils/execFileNoThrowPortable.ts`
- `utils/file.ts`
- `utils/fileStateCache.ts`
- `utils/frontmatterParser.ts`
- `utils/fsOperations.ts`
- `utils/git/gitFilesystem.ts`
- `utils/hooks.ts`
- `utils/memoize.ts`
- `utils/memory/types.ts`
- `utils/model/model.ts`
- `utils/model/modelStrings.ts`
- `utils/path.ts`
- `utils/permissions/filesystem.ts`
- `utils/privacyLevel.ts`
- `utils/settings/constants.ts`
- `utils/settings/settings.ts`
- `utils/settings/settingsCache.ts`
- `utils/settings/types.ts`
- `utils/signal.ts`
- `utils/slowOperations.ts`
- `utils/which.ts`

### Layer 3

- `Tool.ts`
- `bridge/bridgeEnabled.ts`
- `buddy/types.ts`
- `constants/figures.ts`
- `constants/keys.ts`
- `entrypoints/sandboxTypes.ts`
- `entrypoints/sdk/coreTypes.ts`
- `entrypoints/sdk/runtimeTypes.ts`
- `entrypoints/sdk/toolTypes.ts`
- `memdir/memoryTypes.ts`
- `memdir/teamMemPrompts.ts`
- `schemas/hooks.ts`
- `services/analytics/firstPartyEventLogger.ts`
- `services/mcp/types.ts`
- `services/remoteManagedSettings/syncCacheState.ts`
- `state/AppState.tsx`
- `tools/AgentTool/agentMemory.ts`
- `tools/FileEditTool/constants.ts`
- `tools/FileReadTool/prompt.ts`
- `tools/GrepTool/prompt.ts`
- `tools/REPLTool/constants.ts`
- `utils/ShellCommand.ts`
- `utils/array.ts`
- `utils/attachments.ts`
- `utils/auth.ts`
- `utils/bash/shellPrefix.ts`
- `utils/bufferedWriter.ts`
- `utils/cleanupRegistry.ts`
- `utils/combinedAbortSignal.ts`
- `utils/commitAttribution.ts`
- `utils/configConstants.ts`
- `utils/context.ts`
- `utils/debugFilter.ts`
- `utils/embeddedTools.ts`
- `utils/env.ts`
- `utils/execSyncWrapper.ts`
- `utils/fileHistory.ts`
- `utils/fileRead.ts`
- `utils/fileReadCache.ts`
- `utils/format.ts`
- `utils/generators.ts`
- `utils/git/gitConfigParser.ts`
- `utils/git/gitignore.ts`
- `utils/hash.ts`
- `utils/hooks/AsyncHookRegistry.ts`
- `utils/hooks/execAgentHook.ts`
- `utils/hooks/execHttpHook.ts`
- `utils/hooks/execPromptHook.ts`
- `utils/hooks/hookEvents.ts`
- `utils/hooks/hooksConfigSnapshot.ts`
- `utils/hooks/hooksSettings.ts`
- `utils/hooks/sessionHooks.ts`
- `utils/http.ts`
- `utils/imageResizer.ts`
- `utils/json.ts`
- `utils/jsonRead.ts`
- `utils/lazySchema.ts`
- `utils/lockfile.ts`
- `utils/messageQueueManager.ts`
- `utils/messages.ts`
- `utils/model/aliases.ts`
- `utils/model/antModels.ts`
- `utils/model/bedrock.ts`
- `utils/model/configs.ts`
- `utils/model/modelAllowlist.ts`
- `utils/model/modelOptions.ts`
- `utils/model/providers.ts`
- `utils/modelCost.ts`
- `utils/permissions/PermissionMode.ts`
- `utils/permissions/PermissionResult.ts`
- `utils/permissions/PermissionRule.ts`
- `utils/permissions/PermissionUpdate.ts`
- `utils/permissions/PermissionUpdateSchema.ts`
- `utils/permissions/permissionRuleParser.ts`
- `utils/permissions/permissions.ts`
- `utils/plans.ts`
- `utils/platform.ts`
- `utils/plugins/pluginDirectories.ts`
- `utils/plugins/pluginOptionsStorage.ts`
- `utils/plugins/schemas.ts`
- `utils/process.ts`
- `utils/sequential.ts`
- `utils/sessionEnvironment.ts`
- `utils/sessionStorage.ts`
- `utils/sessionStoragePortable.ts`
- `utils/settings/internalWrites.ts`
- `utils/settings/managedPath.ts`
- `utils/settings/mdm/settings.ts`
- `utils/settings/permissionValidation.ts`
- `utils/settings/validation.ts`
- `utils/shell/powershellDetection.ts`
- `utils/shell/powershellProvider.ts`
- `utils/shell/readOnlyCommandValidation.ts`
- `utils/shell/shellProvider.ts`
- `utils/startupProfiler.ts`
- `utils/stringUtils.ts`
- `utils/subprocessEnv.ts`
- `utils/task/TaskOutput.ts`
- `utils/telemetry/events.ts`
- `utils/telemetry/sessionTracing.ts`
- `utils/theme.ts`
- `utils/toolResultStorage.ts`
- `utils/user.ts`
- `utils/windowsPaths.ts`
- `utils/yaml.ts`
