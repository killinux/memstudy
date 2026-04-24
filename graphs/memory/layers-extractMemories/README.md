# 分层依赖图：services/extractMemories/extractMemories.ts

入口文件: `services/extractMemories/extractMemories.ts`
最大深度: 2
总文件数: 142

## 层级概览

| 层 | 文件数 | 说明 |
|---|---|---|
| Layer 0 | 1 | 入口模块 |
| Layer 1 | 24 | 直接依赖 |
| Layer 2 | 117 | 二级依赖 |

## 图片

- [概览图](overview.svg) — 所有层的全局视图
- [Layer 0](layer-0.svg) — 入口模块
- [Layer 1](layer-1.svg) — 直接依赖
- [Layer 2](layer-2.svg) — 二级依赖

## 每层文件清单

### Layer 0

- `services/extractMemories/extractMemories.ts`

### Layer 1

- `Tool.ts`
- `bootstrap/state.ts`
- `hooks/useCanUseTool.tsx`
- `memdir/memdir.ts`
- `memdir/memoryScan.ts`
- `memdir/paths.ts`
- `memdir/teamMemPaths.ts`
- `services/analytics/growthbook.ts`
- `services/analytics/index.ts`
- `services/analytics/metadata.ts`
- `services/extractMemories/prompts.ts`
- `tools/BashTool/toolName.ts`
- `tools/FileEditTool/constants.ts`
- `tools/FileReadTool/prompt.ts`
- `tools/FileWriteTool/prompt.ts`
- `tools/GlobTool/prompt.ts`
- `tools/GrepTool/prompt.ts`
- `tools/REPLTool/constants.ts`
- `utils/abortController.ts`
- `utils/array.ts`
- `utils/debug.ts`
- `utils/forkedAgent.ts`
- `utils/hooks/postSamplingHooks.ts`
- `utils/messages.ts`

### Layer 2

- `buddy/prompt.ts`
- `commands.ts`
- `components/Spinner.tsx`
- `components/permissions/PermissionRequest.tsx`
- `constants/keys.ts`
- `constants/messages.ts`
- `constants/outputStyles.ts`
- `constants/xml.ts`
- `context/notifications.tsx`
- `entrypoints/agentSdkTypes.ts`
- `hooks/toolPermission/PermissionContext.ts`
- `hooks/toolPermission/handlers/coordinatorHandler.ts`
- `hooks/toolPermission/handlers/interactiveHandler.ts`
- `hooks/toolPermission/handlers/swarmWorkerHandler.ts`
- `hooks/toolPermission/permissionLogging.ts`
- `ink.ts`
- `memdir/memoryTypes.ts`
- `memdir/teamMemPrompts.ts`
- `query.ts`
- `services/analytics/firstPartyEventLogger.ts`
- `services/api/claude.ts`
- `services/api/errors.ts`
- `services/api/logging.ts`
- `services/compact/snipCompact.ts`
- `services/compact/snipProjection.ts`
- `services/diagnosticTracking.ts`
- `services/mcp/officialRegistry.ts`
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
- `tools/BashTool/bashPermissions.ts`
- `tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`
- `tools/FileEditTool/FileEditTool.ts`
- `tools/FileReadTool/FileReadTool.ts`
- `tools/FileWriteTool/FileWriteTool.ts`
- `tools/NotebookEditTool/constants.ts`
- `tools/SendMessageTool/constants.ts`
- `tools/TaskCreateTool/constants.ts`
- `tools/TaskOutputTool/constants.ts`
- `tools/TaskUpdateTool/constants.ts`
- `types/connectorText.ts`
- `types/generated/events_mono/claude_code/v1/claude_code_internal_event.ts`
- `types/generated/events_mono/common/v1/auth.ts`
- `types/hooks.ts`
- `types/ids.ts`
- `types/permissions.ts`
- `utils/advisor.ts`
- `utils/agentContext.ts`
- `utils/agentSwarmsEnabled.ts`
- `utils/api.ts`
- `utils/attachments.ts`
- `utils/auth.ts`
- `utils/autoModeDenials.ts`
- `utils/bash/shellQuote.ts`
- `utils/betas.ts`
- `utils/bufferedWriter.ts`
- `utils/classifierApprovals.ts`
- `utils/cleanupRegistry.ts`
- `utils/commitAttribution.ts`
- `utils/computerUse/common.ts`
- `utils/config.ts`
- `utils/crypto.ts`
- `utils/debugFilter.ts`
- `utils/displayTags.ts`
- `utils/embeddedTools.ts`
- `utils/env.ts`
- `utils/envDynamic.ts`
- `utils/envUtils.ts`
- `utils/errors.ts`
- `utils/fileHistory.ts`
- `utils/fileStateCache.ts`
- `utils/format.ts`
- `utils/frontmatterParser.ts`
- `utils/fsOperations.ts`
- `utils/git.ts`
- `utils/http.ts`
- `utils/imageValidation.ts`
- `utils/json.ts`
- `utils/log.ts`
- `utils/model/model.ts`
- `utils/model/modelStrings.ts`
- `utils/path.ts`
- `utils/pdfUtils.ts`
- `utils/permissions/PermissionResult.ts`
- `utils/permissions/denialTracking.ts`
- `utils/permissions/permissionRuleParser.ts`
- `utils/permissions/permissionSetup.ts`
- `utils/permissions/permissions.ts`
- `utils/planModeV2.ts`
- `utils/platform.ts`
- `utils/process.ts`
- `utils/readFileInRange.ts`
- `utils/sessionStorage.ts`
- `utils/settings/constants.ts`
- `utils/settings/settings.ts`
- `utils/settings/settingsCache.ts`
- `utils/settings/types.ts`
- `utils/signal.ts`
- `utils/slowOperations.ts`
- `utils/stringUtils.ts`
- `utils/systemPromptType.ts`
- `utils/tasks.ts`
- `utils/teammate.ts`
- `utils/teammateMailbox.ts`
- `utils/theme.ts`
- `utils/thinking.ts`
- `utils/toolResultStorage.ts`
- `utils/toolSearch.ts`
- `utils/user.ts`
- `utils/uuid.ts`
