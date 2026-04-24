# 分层依赖图：services/autoDream/autoDream.ts

入口文件: `services/autoDream/autoDream.ts`
最大深度: 2
总文件数: 131

## 层级概览

| 层 | 文件数 | 说明 |
|---|---|---|
| Layer 0 | 1 | 入口模块 |
| Layer 1 | 18 | 直接依赖 |
| Layer 2 | 112 | 二级依赖 |

## 图片

- [概览图](overview.svg) — 所有层的全局视图
- [Layer 0](layer-0.svg) — 入口模块
- [Layer 1](layer-1.svg) — 直接依赖
- [Layer 2](layer-2.svg) — 二级依赖

## 每层文件清单

### Layer 0

- `services/autoDream/autoDream.ts`

### Layer 1

- `Task.ts`
- `Tool.ts`
- `bootstrap/state.ts`
- `memdir/paths.ts`
- `services/analytics/growthbook.ts`
- `services/analytics/index.ts`
- `services/autoDream/config.ts`
- `services/autoDream/consolidationLock.ts`
- `services/autoDream/consolidationPrompt.ts`
- `services/extractMemories/extractMemories.ts`
- `tasks/DreamTask/DreamTask.ts`
- `tools/FileEditTool/constants.ts`
- `tools/FileWriteTool/prompt.ts`
- `utils/debug.ts`
- `utils/forkedAgent.ts`
- `utils/hooks/postSamplingHooks.ts`
- `utils/messages.ts`
- `utils/sessionStorage.ts`

### Layer 2

- `buddy/prompt.ts`
- `commands.ts`
- `components/Spinner.tsx`
- `constants/keys.ts`
- `constants/messages.ts`
- `constants/outputStyles.ts`
- `constants/xml.ts`
- `context/notifications.tsx`
- `entrypoints/agentSdkTypes.ts`
- `hooks/useCanUseTool.tsx`
- `memdir/memdir.ts`
- `memdir/memoryScan.ts`
- `memdir/teamMemPaths.ts`
- `query.ts`
- `services/analytics/firstPartyEventLogger.ts`
- `services/analytics/metadata.ts`
- `services/api/claude.ts`
- `services/api/errors.ts`
- `services/api/logging.ts`
- `services/api/sessionIngress.ts`
- `services/compact/snipCompact.ts`
- `services/compact/snipProjection.ts`
- `services/diagnosticTracking.ts`
- `services/extractMemories/prompts.ts`
- `services/mcp/types.ts`
- `state/AppState.tsx`
- `tools/AgentTool/agentColorManager.ts`
- `tools/AgentTool/built-in/exploreAgent.ts`
- `tools/AgentTool/built-in/planAgent.ts`
- `tools/AgentTool/builtInAgents.ts`
- `tools/AgentTool/constants.ts`
- `tools/AgentTool/loadAgentsDir.ts`
- `tools/AskUserQuestionTool/prompt.ts`
- `tools/BashTool/BashTool.tsx`
- `tools/BashTool/toolName.ts`
- `tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`
- `tools/FileEditTool/FileEditTool.ts`
- `tools/FileReadTool/FileReadTool.ts`
- `tools/FileReadTool/prompt.ts`
- `tools/FileWriteTool/FileWriteTool.ts`
- `tools/GlobTool/prompt.ts`
- `tools/GrepTool/prompt.ts`
- `tools/REPLTool/constants.ts`
- `tools/SendMessageTool/constants.ts`
- `tools/TaskCreateTool/constants.ts`
- `tools/TaskOutputTool/constants.ts`
- `tools/TaskUpdateTool/constants.ts`
- `types/connectorText.ts`
- `types/hooks.ts`
- `types/ids.ts`
- `types/logs.ts`
- `types/permissions.ts`
- `utils/abortController.ts`
- `utils/advisor.ts`
- `utils/agentSwarmsEnabled.ts`
- `utils/api.ts`
- `utils/array.ts`
- `utils/attachments.ts`
- `utils/bash/shellQuote.ts`
- `utils/bufferedWriter.ts`
- `utils/cleanupRegistry.ts`
- `utils/commitAttribution.ts`
- `utils/concurrentSessions.ts`
- `utils/config.ts`
- `utils/crypto.ts`
- `utils/cwd.ts`
- `utils/debugFilter.ts`
- `utils/diagLogs.ts`
- `utils/displayTags.ts`
- `utils/embeddedTools.ts`
- `utils/envUtils.ts`
- `utils/errors.ts`
- `utils/fileHistory.ts`
- `utils/fileStateCache.ts`
- `utils/format.ts`
- `utils/fsOperations.ts`
- `utils/genericProcessUtils.ts`
- `utils/getWorktreePaths.ts`
- `utils/git.ts`
- `utils/gracefulShutdown.ts`
- `utils/http.ts`
- `utils/imageValidation.ts`
- `utils/json.ts`
- `utils/listSessionsImpl.ts`
- `utils/log.ts`
- `utils/model/model.ts`
- `utils/model/modelStrings.ts`
- `utils/path.ts`
- `utils/permissions/denialTracking.ts`
- `utils/permissions/permissionRuleParser.ts`
- `utils/permissions/permissionSetup.ts`
- `utils/planModeV2.ts`
- `utils/process.ts`
- `utils/sessionStoragePortable.ts`
- `utils/settings/constants.ts`
- `utils/settings/settings.ts`
- `utils/settings/settingsCache.ts`
- `utils/settings/types.ts`
- `utils/signal.ts`
- `utils/slowOperations.ts`
- `utils/stringUtils.ts`
- `utils/systemPromptType.ts`
- `utils/task/diskOutput.ts`
- `utils/task/framework.ts`
- `utils/tasks.ts`
- `utils/teammateMailbox.ts`
- `utils/theme.ts`
- `utils/thinking.ts`
- `utils/toolResultStorage.ts`
- `utils/toolSearch.ts`
- `utils/user.ts`
- `utils/uuid.ts`
