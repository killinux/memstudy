# 分层依赖图：tools/AgentTool/forkSubagent.ts

入口文件: `tools/AgentTool/forkSubagent.ts`
最大深度: 2
总文件数: 93

## 层级概览

| 层 | 文件数 | 说明 |
|---|---|---|
| Layer 0 | 1 | 入口模块 |
| Layer 1 | 6 | 直接依赖 |
| Layer 2 | 86 | 二级依赖 |

## 图片

- [概览图](overview.svg) — 所有层的全局视图
- [Layer 0](layer-0.svg) — 入口模块
- [Layer 1](layer-1.svg) — 直接依赖
- [Layer 2](layer-2.svg) — 二级依赖

## 每层文件清单

### Layer 0

- `tools/AgentTool/forkSubagent.ts`

### Layer 1

- `bootstrap/state.ts`
- `constants/xml.ts`
- `coordinator/coordinatorMode.ts`
- `tools/AgentTool/loadAgentsDir.ts`
- `utils/debug.ts`
- `utils/messages.ts`

### Layer 2

- `Tool.ts`
- `buddy/prompt.ts`
- `components/Spinner.tsx`
- `constants/messages.ts`
- `constants/outputStyles.ts`
- `constants/tools.ts`
- `entrypoints/agentSdkTypes.ts`
- `memdir/paths.ts`
- `services/analytics/growthbook.ts`
- `services/analytics/index.ts`
- `services/analytics/metadata.ts`
- `services/api/errors.ts`
- `services/compact/snipCompact.ts`
- `services/compact/snipProjection.ts`
- `services/diagnosticTracking.ts`
- `services/mcp/types.ts`
- `tools/AgentTool/agentColorManager.ts`
- `tools/AgentTool/agentMemory.ts`
- `tools/AgentTool/agentMemorySnapshot.ts`
- `tools/AgentTool/built-in/exploreAgent.ts`
- `tools/AgentTool/built-in/planAgent.ts`
- `tools/AgentTool/builtInAgents.ts`
- `tools/AgentTool/constants.ts`
- `tools/AskUserQuestionTool/prompt.ts`
- `tools/BashTool/BashTool.tsx`
- `tools/BashTool/toolName.ts`
- `tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`
- `tools/FileEditTool/FileEditTool.ts`
- `tools/FileEditTool/constants.ts`
- `tools/FileReadTool/FileReadTool.ts`
- `tools/FileReadTool/prompt.ts`
- `tools/FileWriteTool/FileWriteTool.ts`
- `tools/FileWriteTool/prompt.ts`
- `tools/GlobTool/prompt.ts`
- `tools/GrepTool/prompt.ts`
- `tools/SendMessageTool/constants.ts`
- `tools/SyntheticOutputTool/SyntheticOutputTool.ts`
- `tools/TaskCreateTool/constants.ts`
- `tools/TaskOutputTool/constants.ts`
- `tools/TaskStopTool/prompt.ts`
- `tools/TaskUpdateTool/constants.ts`
- `tools/TeamCreateTool/constants.ts`
- `tools/TeamDeleteTool/constants.ts`
- `types/connectorText.ts`
- `types/hooks.ts`
- `types/ids.ts`
- `types/permissions.ts`
- `utils/advisor.ts`
- `utils/agentSwarmsEnabled.ts`
- `utils/api.ts`
- `utils/array.ts`
- `utils/attachments.ts`
- `utils/bash/shellQuote.ts`
- `utils/bufferedWriter.ts`
- `utils/cleanupRegistry.ts`
- `utils/config.ts`
- `utils/crypto.ts`
- `utils/debugFilter.ts`
- `utils/displayTags.ts`
- `utils/effort.ts`
- `utils/embeddedTools.ts`
- `utils/envUtils.ts`
- `utils/format.ts`
- `utils/frontmatterParser.ts`
- `utils/fsOperations.ts`
- `utils/imageValidation.ts`
- `utils/json.ts`
- `utils/lazySchema.ts`
- `utils/log.ts`
- `utils/markdownConfigLoader.ts`
- `utils/model/model.ts`
- `utils/model/modelStrings.ts`
- `utils/permissions/PermissionMode.ts`
- `utils/permissions/permissionRuleParser.ts`
- `utils/planModeV2.ts`
- `utils/plugins/loadPluginAgents.ts`
- `utils/process.ts`
- `utils/settings/constants.ts`
- `utils/settings/settingsCache.ts`
- `utils/settings/types.ts`
- `utils/signal.ts`
- `utils/slowOperations.ts`
- `utils/stringUtils.ts`
- `utils/tasks.ts`
- `utils/teammateMailbox.ts`
- `utils/toolSearch.ts`
