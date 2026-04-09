# AST 分析报告

源文件数: 1932
总函数数: 20181
总 Export 数: 8611
React 组件数: 573
Tool 定义数: 42
Command 定义数: 73

## 函数特征

| 特征 | 数量 | 比例 |
|---|---|---|
| async | 2835 | 14.0% |
| generator | 50 | 0.2% |
| async generator | 45 | 0.2% |
| arrow | 9649 | 47.8% |
| 命名函数 | 10532 | 52.2% |

## 参数数分布

| 参数数 | 函数数 |
|---|---|
| 0 | 6249 |
| 1 | 10144 |
| 2 | 2518 |
| 3 | 740 |
| 4 | 271 |
| 5 | 118 |
| 6 | 58 |
| 7 | 34 |
| 8 | 17 |
| 9 | 14 |
| 10 | 10 |
| 11 | 4 |
| 12 | 3 |
| 17 | 1 |

## Export 最多的文件 Top 10

| Rank | Count | File |
|---|---|---|
| 1 | 215 | `src/bootstrap/state.ts` |
| 2 | 135 | `src/entrypoints/sdk/coreSchemas.ts` |
| 3 | 114 | `src/utils/messages.ts` |
| 4 | 94 | `src/utils/sessionStorage.ts` |
| 5 | 73 | `src/entrypoints/agentSdkTypes.ts` |
| 6 | 61 | `src/utils/auth.ts` |
| 7 | 55 | `src/ink.ts` |
| 8 | 54 | `src/utils/teammateMailbox.ts` |
| 9 | 52 | `src/utils/attachments.ts` |
| 10 | 51 | `src/utils/hooks.ts` |

## 被引用最多的模块 Top 20

| Rank | Count | Module |
|---|---|---|
| 1 | 761 | `react` |
| 2 | 395 | `react/compiler-runtime` |
| 3 | 254 | `path` |
| 4 | 240 | `../../ink.js` |
| 5 | 194 | `bun:bundle` |
| 6 | 167 | `../../Tool.js` |
| 7 | 147 | `../ink.js` |
| 8 | 146 | `fs/promises` |
| 9 | 128 | `zod/v4` |
| 10 | 127 | `../../commands.js` |
| 11 | 125 | `../../bootstrap/state.js` |
| 12 | 117 | `crypto` |
| 13 | 104 | `./types.js` |
| 14 | 99 | `src/services/analytics/index.js` |
| 15 | 95 | `../../utils/errors.js` |
| 16 | 94 | `../debug.js` |
| 17 | 89 | `../bootstrap/state.js` |
| 18 | 89 | `figures` |
| 19 | 86 | `../../utils/log.js` |
| 20 | 84 | `../../utils/debug.js` |

## React 组件 Hook 使用最多 Top 10

| Component | useState | useEffect | useCallback | useMemo | Total Hooks | File |
|---|---|---|---|---|---|---|
| REPL | 65 | 38 | 43 | 14 | 371 | `src/screens/REPL.tsx` |
| PromptInput | 17 | 13 | 26 | 26 | 160 | `src/components/PromptInput/PromptInput.tsx` |
| Config | 15 | 2 | 6 | 1 | 67 | `src/components/Settings/Config.tsx` |
| ManagePlugins | 14 | 6 | 5 | 4 | 56 | `src/commands/plugin/ManagePlugins.tsx` |
| InstallGitHubApp | 2 | 2 | 5 | 0 | 39 | `src/commands/install-github-app/install-github-app.tsx` |
| LogSelector | 17 | 8 | 0 | 0 | 38 | `src/components/LogSelector.tsx` |
| MCPRemoteServerMenu | 13 | 1 | 6 | 0 | 34 | `src/components/mcp/MCPRemoteServerMenu.tsx` |
| ModeIndicator | 2 | 2 | 0 | 1 | 34 | `src/components/PromptInput/PromptInputFooterLeftSide.tsx` |
| MessagesImpl | 1 | 2 | 5 | 14 | 30 | `src/components/Messages.tsx` |
| VirtualMessageList | 2 | 2 | 6 | 0 | 30 | `src/components/VirtualMessageList.tsx` |
