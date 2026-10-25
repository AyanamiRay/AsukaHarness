# DSH 后端架构拆解与重写指南

> 分析对象：`@deepseek-ai/dsh` 0.2.1-rc.3（Windows 桌面包内 `app.asar/dsh/node_modules/@deepseek-ai/*`）。
> 证据来源：各包 README 的设计说明、`dsh-session/lib/types/known-event-types.js`、`dsh-agent-loop` / `dsh-agent` / `dsh-tools` / `dsh-session` 的源码映射表与运行时 JS。
> 说明：以下都是"这个版本怎么做的"，不是唯一正确做法；第 12 节给出简化重写建议。

---

## 0. 一句话概括

DSH 的后端是 **Cordis 插件容器 + 事件溯源会话 + ReAct 循环 + 工具运行时 + 多 Provider LLM 适配 + 传输/投影层**。
所有能力（工具、命令、技能、UI、沙箱、压缩、子代理）都是插件，profile 决定装哪些；Agent 只是"会话 + 循环 + 工具"的组合。

---

## 1. 分层

```
┌─────────────────────────────────────────────────────────┐
│ Client: Web SPA / Electron / ACP / SDK                  │
│        HTTP + WebSocket（Typert RPC），或进程内 IPC       │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│ Host 进程（Node）                                        │
│  host-webserver（裸 http，插件注册路由）                  │
│  api-gateway（Typert RPC 双端）                          │
│  api-session-controller / api-*-controller               │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│ Cordis 容器：服务注册 / 依赖注入 / 生命周期 / 作用域       │
│  ├─ session（SessionStore，追加日志 + 投影）              │
│  ├─ agents（AgentRegistry + AgentFactory）               │
│  ├─ tools（ToolRuntime，注册表 + 执行管线）               │
│  ├─ llm（Provider 适配 + 能力探测）                       │
│  ├─ session-persistence（JSONL/Zstd）                    │
│  ├─ session-projection（todos/goals/stats 快照）          │
│  ├─ sandbox / approval / fs-policy                       │
│  └─ 插件：tool-*、command-*、skill-*、client-ui-* …       │
└─────────────────────────────────────────────────────────┘
```

要点：

- **没有"主应用对象"**。没有 `App` 类，只有容器里的一组服务；`dsh` 启动的是 profile（bundle 列表 + patch 叠层）。
- **Agent 不是进程**，是容器里的一个运行时对象 + 一个 fiber；一个进程可以有多个 Agent（主代理、子代理、团队）。
- **模型可见的事实必须可重建**：`session` 是唯一事实源，其他都是投影。

---

## 2. 一次 Turn 的时序（核心）

```
用户输入
  │  user/message（追加到 session）
  ▼
turn/start
  │  agent 打开 turn，原子领取 inbox 里的 next-turn/next-step 消息
  ▼
┌── step 循环 ────────────────────────────────────────────┐
│ step/start                                             │
│  组装：deriveMessages() + 可见工具 schema                 │
│  agent/pre-step（可 reject / 可替换消息批次）             │
│  request/header（记录本次声明的工具、provider/model）     │
│  prepareCall()（解析路由与能力）                          │
│  冻结请求 → 调 LLM（一次 attempt）                        │
│  assistant/attempt（失败/取消/重试时才有）                │
│  assistant/message（成功时落盘，含流式文本）              │
│  tool/call × N  →  工具执行管线  →  tool/result × N      │
│ step/end                                               │
│  有 tool call 或新输入 → 继续下一个 step                  │
└────────────────────────────────────────────────────────┘
  ▼
turn/end（reason + cancelCause）
```

术语：

| 概念 | 含义 |
|---|---|
| **Turn** | 一次"用户发起到模型停下来"的完整周期 |
| **Step** | 一次模型请求 + 它产生的一批工具调用 |
| **Attempt** | 一次 Provider 调用（重试会产生多个 attempt，只有一个成功落 `assistant/message`） |

---

## 3. Agent 是怎么组织的

### 3.1 接口与实现分离

- `dsh-agent` 定义公开的 `Agent` 接口、`AgentRegistry`、`AgentFactory` 契约。
- `dsh-agent-loop` 是唯一实现：把自己注册为 `ctx.agents` 上的 `AgentFactory`。
- 消费方只依赖 `dsh-agent`，**不 import 循环包**，所以驱动可以替换（例如以后换成非 ReAct 的循环）。

### 3.2 Initiator Scope

`dsh-agent` 用 `AsyncLocalStorage` 维护一条 "initiator 链"：驱动启动的任意异步工作（工具、子代理、回调）都能拿到"当前是哪个 Agent 发起的"，不需要层层传参。跨进程/跨队列时这个归属必须显式携带，不能靠 ALS。

### 3.3 Inbox：可持久化的待处理输入

`Agent.inbox` 不是内存数组，而是**投影**：

- 两组队列：`nextTurn`（下一轮的用户消息）和 `nextStep`（当前 step 结束后要插入的消息，用于"边跑边补充"）。
- 操作：`append / prepend / replace / remove / clear / splice`，每次变更落一条 `agent/inbox/spliced` 事件。
- 轮次边界领取消息用纯删除 splice，保证崩溃后重放能重建"哪些消息已被消费"。
- 实时通知只有三类：`agent/inbox/inserted`、`claimed`、`discarded`。

### 3.4 Step Admission（准入）

`agent/pre-step` 返回 `PreStepDecision`：

- `{ kind: 'reject' }`：不进入 step（空批次 / 被拦截）。
- `{ kind: 'enter', messages, startsRequestSeries? }`：带一批已识别、冻结的消息。

接受 ≠ 提交：`step/start` 之后、`agent/request` 与 `prepareCall()` 解析完路由，才真正把 system prompt 与 user 批次写入历史；这两个异步阶段中取消，则两者都不提交。

### 3.5 取消

- 协作式：`AbortSignal` 贯穿模型流与工具执行。
- `agent.cancel()` 默认清空 inbox；`keepInbox` 保留排队输入。
- 取消的流会把**已经推给用户的文本**作为 `interrupted: true` 的 assistant 锚点落盘，保证下一轮模型看到的内容和用户看到的一致。
- 取消后未派发的工具调用会补一对 `tool/call` + `ABORTED_BEFORE_DISPATCH` 结果，避免出现"孤立 tool call"。

### 3.6 生命周期

`AgentRegistry` 每个 Agent 一条记录（carrier + creator 关系）：

- `register()` 等待串行的 startup 监听器完成，再发布 Agent。
- 异步工厂用 `enter()`/`announce()` 拆分"创建"和"宣布"，任何一步失败都可回滚。
- teardown：停循环 → 排空 → 退出 scope → detach agent → detach session，之后 id 可复用。

---

## 4. 会话：事件溯源是整个后端的骨架

### 4.1 不变量

> **Model-visible means logged**：任何进入模型请求的内容，必须能从日志重建。

这条不变量决定了后面所有设计（重放、fork、压缩、崩溃修复、审计）。

### 4.2 事件词汇表（这个版本）

来自 `dsh-session/lib/types/known-event-types.js`，节选：

| 家族 | 事件 |
|---|---|
| 轮次/步骤 | `turn/start`、`turn/end`、`step/start`、`step/end` |
| 请求 | `request/header`、`request/context` |
| 消息 | `system/message`、`developer/message`、`user/message`、`assistant/message`、`assistant/attempt` |
| 工具 | `tool/call`、`tool/result`、`tool/ptc-dispatch-start`、`tool/ptc-dispatch` |
| 输入 | `agent/inbox/spliced`、`image/offload` |
| 压缩 | `compaction/start`、`compaction/summary`、`compaction/prune`、`compaction/end` |
| 权限 | `approval/asked`、`approval/decided`、`approval/policy`、`sandbox/mode`、`permission/preset` |
| 编排 | `subagent/*`、`team/*`、`goal/change`、`plan/mode`、`todo/write`、`schedule/change` |
| 其他 | `model/selection`、`session/title`、`feedback/*`、`hook/*`、`job/*`、`llm/retry*` |

未知事件类型默认**拒绝读取**（防止新版本日志被旧版本误读），除非事件带 `ignorable` 标记。

### 4.3 派生历史

- `Session` 是 append-only 日志；`surface` 是增量投影，带 `replaceGeneration`（按位置替换）和 `contentGeneration`（替换 + 插件改内容）。
- `deriveMessages()` 缓存深度冻结的投影，每次返回新数组；替换或投影决策会让缓存失效。
- 只有 `system/developer/user/assistant/tool` 这几类事件贡献模型历史；`assistant/attempt` 只用于诊断/重放。

### 4.4 request header

`request/header` 折叠出"这次请求声明了哪些工具、走的哪个 provider/model、有什么能力"。
`Session.toolHistory()` 让适配器重建 Provider 需要的工具声明——**历史请求可以精确重放**，即使工具后来改了。

### 4.5 持久化与投影

- `session-persistence-jsonl`：每个 session 一个当前 JSONL 日志；历史代际用带校验的 Zstd 帧；支持撕裂尾部恢复。
- `session-projection`：把事件同步投影成 todos/goals/stats 等 JSON 快照，快照标出"反映到哪条事件"，客户端不用重放。
- `session-query-sqlite`：跨会话检索。
- fork：复制前缀事件 + repair 未完成的 tool call，得到新 session。

### 4.6 压缩（compaction）

- 不删日志：把旧历史总结成一条 `compaction/summary`，用 `compaction/prune` 遮蔽被替代的条目。
- 重放同一日志会得到同样的压缩结果。
- `/compact` 命令、tool-result pruner、image offload 都建立在这个机制上。

---

## 5. 工具系统

### 5.1 定义

```js
ctx.tools.register(defineTool({
  name: 'todo_write',
  description: '…',
  parameters: { todos: { type: 'array', required: true, items: { … } } },
  parallelSafe: false,          // 是否允许与其他工具并行
  timeoutMs: 30_000,
  async execute(ctx, args) { … },
  finalizeContent(result) { … }, // 落盘前的模型可见内容
  present(result) { … },         // 只给 UI 的展示描述
}))
```

- 参数是一个**受限 JSON Schema 子集**，运行时校验；`output`、`execute`、`presentation` 永远不会出现在模型看到的 schema 里。
- 注册表是**分层作用域**的：全局注册，per-agent 可收窄可见集合。

### 5.2 执行管线（固定顺序）

```
tools/pre-execute   →  允许/拒绝/询问（可扩展）
  →  注册的单调 guard
  →  tools/execute  →  真正的 dispatch（可包裹）
  →  tools/post-execute（检查/替换、附加上下文）
  →  definition.finalizeContent
  →  tools/result（只读观察）
```

- 每个调用有冻结的参数、关联 token、结构化错误。
- 普通工具失败**不会结束 turn**，而是变成结构化错误让模型继续。
- 取消：调用前 `ABORTED_BEFORE_DISPATCH`，调用后 `ABORTED`；更具体的错误（拒绝、超时）优先。

### 5.3 并发模型

- `parallelSafe` 的调用进有界并发池（`maxParallelToolCalls`）。
- 非并行安全的调用是**独占屏障**，前后串行。

### 5.4 PTC 模式（Programmatic Tool Calling）

除了原生 Function Calling，还支持 `run_code`：

- 模型写一段 JS/Python，运行时生成 SDK 绑定，代码里可以调用工具。
- 子调用 id 形如 `<parent>:ptc:<n>`，走同一套调度与策略。
- `run_code` 有超时、沙箱权限、审批；中间值只在这次执行内可见，只有最终结果有大小上限。
- 好处：复杂编排不用把中间结果全塞回模型上下文。

---

## 6. 模型调用

- `dsh-llm` 只做"流式调用 + 模型发现 + 能力解析"，具体协议翻译在各 provider adapter。
- **一次 stream = 一次 attempt**，必定以终止结果结束（成功/失败/取消），调用方不需要处理半截状态。
- 循环构造的请求**深度冻结**，扩展和 adapter 不能改写，防止协议不一致。
- `dsh-llm-retry` 负责重试；重试复用同一份已渲染的 assembly，不重复 `pre-step`、不重复准入用户消息。
- 请求形状：`header.config` + `deriveMessages()` + `header.tools`，**没有独立的 `system` 字段**——系统提示就是 `system/message` 节点，最新一条生效。

能力位（capability）会影响行为，例如：

- `systemPromptUpdate: 'in-history'`：支持把新系统提示追加在历史之后，保住前缀 KV cache。
- `toolUpdate`：支持不重写历史就增删工具。

---

## 7. 上下文管理（最容易被低估的部分）

DSH 在 prompt 上做了很多"admission / reconciliation"：

- 系统提示是多版本节点：新提示可以 append、可以原地替换，也可以整体合并到头部。
- 换 provider/model、surface 变化、工具 schema 变化，都可能触发"新 request series"。
- 压缩可能发生在 `pre-step` 或重试之间，因此每次请求都要**对账**（reconcile）渲染后的 prompt 与仍存活的 `system/message` 节点。
- 空洞的 system 节点用"空替换"遮蔽，而不是删除（append-only）。

这一段是 DSH 里最复杂、也最容易写错的地方。重写时可以先简化成"每次重建单条 system prompt"，接受 KV cache 失效，等稳定后再做 in-history 更新。

---

## 8. 编排能力（都是插件，不是内核）

| 能力 | 机制 |
|---|---|
| 子代理 | `dsh-subagent` + provider（本地 spawn/fork 保留 session；ACP/SDK/Codex/Claude Code 一次性） |
| 工作流 | `dsh-workflow`：JS 脚本 + `agent() / parallel() / pipeline() / phase() / log()`，脚本返回 JSON |
| 目标 | `dsh-goal` + `goal-round-driver`：多轮自动推进 |
| 计划模式 | `dsh-plan-mode`：先出计划，审批后执行 |
| 团队 | `dsh-experimental-agent-team`：成员/任务/消息投递 |
| 定时 | `dsh-schedule` + `dsh-tool-schedule` |
| 技能 | `dsh-skill` + `skill-filesystem`：把 SKILL.md 注入工具结果 |

注意：子代理不是"另起一个进程"，默认是同进程里的另一个 Agent（共享容器，独立 session）。

---

## 9. 组合与扩展：Cordis

- 一个 **profile** = `package.json` 里的 `dsh.profile.bundles`（有序）+ `cordis.patch.yml`（用户层）+ home 级 patch + `--patch`。
- bundle 的 patch 是 YAML 数组：按 `id` 覆盖配置、禁用行、插入新行；可写 `!!js` 表达式（例如按 `process.platform` 切换 bash/pwsh）。
- 插件用 `ctx.inject([...], cb)` 声明依赖服务；`ctx.effect()` 注册清理。
- **Agent preset** 是"每个 Agent 的子插件列表"，profile 里可以声明多个，会话选择其中一个。
- 好处：同一份内核可以拼出 web / headless / SDK / ACP / desktop 不同形态，甚至每个 Agent 一套工具。

---

## 10. 传输层

- `host-webserver`：裸 `node:http`（可 HTTPS），只做路由匹配（精确 → 最长前缀 → fallback），**不懂任何 harness 概念**；`/api`、插件 bundle、HMR、SPA 都由插件注册。
- `api-gateway`：Typert 双向 RPC。Host 端提供 `ctx.typertGateway`，Client 端提供 `ctx.remote`；共享生成的 `InvocationDescriptor` 契约。
- `api-session-controller`：session 生命周期/历史、skills、file references 等命名空间。
- 投影：客户端拿快照 + 变更通知，不用重放事件。
- Electron 桌面端：SPA 走 `file://`，fetch 走 IPC bridge（不是 HTTP）。

---

## 11. 安全与权限

- 沙箱按平台选后端：Linux `bwrap` → `landlock`；macOS `seatbelt`；Windows ACL。
- 文件策略：`read-only` / `workspace-write` / `danger-full-access`，由 `fs-sandbox` 与命令沙箱共同执行。
- 审批：`user-approval` + `permission-presets`；工具管线里的 `pre-execute` 可以要求 ask。
- PTC 的权限提升需要 justification + 审批，且只对本次执行生效。

---

## 12. 如果你要重写一个类似的

### 12.1 先守住三条不变量

1. **模型可见 = 已落盘**。任何进入请求的内容都必须能从日志重建；UI 状态、临时变量不许混进历史。
2. **turn / step / attempt 三层分离**。重试是 attempt，不是新 step；用户补充输入是下一个 step，不是新 turn。
3. **工具调用必须配对**。每个 `tool/call` 最终都要有 `tool/result`（成功、失败、取消、未知），否则后续请求会坏。

### 12.2 最小内核（建议 2–3 周）

```
session/
  log.ts          # append(event), readAll()
  events.ts       # 事件类型（先 10 个够用）
  derive.ts       # event[] -> Message[]
  store.ts        # JSONL 读写 + 崩溃恢复
llm/
  types.ts        # StreamEvent = text | tool_call | usage | done
  adapter.ts      # 一个 provider 先跑通
tools/
  registry.ts     # name -> {schema, execute, parallelSafe, timeout}
  run.ts          # 校验 -> 执行 -> 结构化结果
agent/
  loop.ts         # turn/step 状态机
  inbox.ts        # 队列（先内存 + 落盘）
context/
  compact.ts      # 摘要 + 遮蔽
cli/
  main.ts
```

MVP 工具只要四个：`read_file`、`write_file`、`edit_file`、`bash`。
先做单 Agent、单 provider、无插件、无沙箱（明确警告），把"能连续跑 20 轮、崩溃能恢复、压缩后能继续"跑通。

### 12.3 参考接口（TS）

```ts
type SessionEvent =
  | { seq: number; type: 'turn/start'; turn: string; at: number }
  | { seq: number; type: 'user/message'; id: string; content: Content[] }
  | { seq: number; type: 'assistant/message'; id: string; content: Content[] }
  | { seq: number; type: 'tool/call'; id: string; name: string; args: unknown }
  | { seq: number; type: 'tool/result'; callId: string; ok: boolean; content: Content[] }
  | { seq: number; type: 'turn/end'; turn: string; reason: string };

interface LlmAdapter {
  stream(req: {
    messages: Message[];
    tools: ToolSchema[];
    signal: AbortSignal;
  }): AsyncIterable<
    | { kind: 'text'; text: string }
    | { kind: 'tool_call'; id: string; name: string; args: string }
    | { kind: 'usage'; input: number; output: number }
    | { kind: 'done'; stop: 'end' | 'tool_calls' | 'length' }
  >;
}

interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema;
  parallelSafe?: boolean;
  timeoutMs?: number;
  execute(ctx: ToolContext, args: unknown): Promise<ToolResult>;
}
```

循环伪代码：

```ts
async function runTurn(agent, input) {
  session.append({ type: 'turn/start' });
  session.append({ type: 'user/message', content: input });

  for (;;) {
    const step = session.append({ type: 'step/start' });
    const messages = derive(session.events());
    const tools = registry.schemas();

    const assistant = await llm.collect({ messages, tools, signal });
    session.append({ type: 'assistant/message', content: assistant.content });

    if (assistant.toolCalls.length === 0) break;

    const results = await runTools(assistant.toolCalls); // 并行池 + 独占屏障
    for (const r of results) session.append({ type: 'tool/result', ...r });

    session.append({ type: 'step/end' });
    if (!agent.inbox.hasNextStep()) continue;
  }
  session.append({ type: 'turn/end', reason: 'completed' });
}
```

### 12.4 里程碑

| 阶段 | 目标 | 验收 |
|---|---|---|
| M1 | 会话日志 + 单 provider + 4 个工具 + CLI | 能连续完成一个多步任务 |
| M2 | 崩溃恢复 + 重试 + 取消 | kill -9 后 resume，历史不坏 |
| M3 | 压缩 + 工具结果裁剪 | 超长会话能继续，且可重放 |
| M4 | 子代理 + 并行 | 两个子任务并行，父级汇总 |
| M5 | 权限 + 沙箱 + 多 provider | 越权写被拒，可切换模型 |

### 12.5 不要一开始做

- 插件容器 / 热重载 / 多 profile（先用一个 config 对象）
- PTC / workflow / team / ACP
- 跨平台沙箱（先把"危险但明确"的模式跑通）
- 精细的 prompt 对账（先每次重建 system prompt）
- 多 provider 能力位、KV cache 优化、图片 offload

### 12.6 最容易踩的坑

1. 把 UI 状态（折叠、选中、草稿）写进历史 → 重放不一致。
2. 工具调用没配对就结束 turn → 下一次请求被 provider 拒绝。
3. 压缩时直接删消息 → 日志不可重放；正确做法是"摘要 + 遮蔽"。
4. 取消后把半截文本丢掉 → 用户看到的和模型下一轮看到的不一致。
5. 多 Agent 共享一个 session → 事件交错、无法归属；一个 Agent 一个 session。
6. 流式文本和最终消息两份数据 → 必须只有一份落盘。
7. 重试时重新执行工具 → 副作用重复；重试只能重发模型请求。

### 12.7 与 DSH 的取舍

| 维度 | DSH | 简化版建议 |
|---|---|---|
| 插件模型 | Cordis，全功能可组合 | 先硬编码模块，接口清晰即可 |
| 会话 | 事件溯源 + 投影 + fork + 多层持久化 | JSONL + derive + 单文件快照 |
| Prompt | 多版本节点 + 对账 + series | 单条 system prompt，每次重建 |
| 工具 | 管线 + guard + 展示 + PTC | 校验 + 执行 + 结果三件事 |
| 传输 | Typert RPC + 多 surface | HTTP + SSE/WS 一套 |
| 沙箱 | 三平台四后端 | 先无沙箱，后加 Linux bwrap |
| 包数量 | 300+ | 10 个模块以内 |

---

## 13. 关键包索引（读源码时按这个顺序）

| 顺序 | 包 | 看什么 |
|---|---|---|
| 1 | `dsh-session` | 事件类型、`deriveMessages`、repair、fork |
| 2 | `dsh-agent-loop` | `agent.ts` 状态机、`tool-calls.ts` 调度 |
| 3 | `dsh-agent` | Agent 接口、inbox、registry、initiator scope |
| 4 | `dsh-tools` | `defineTool`、执行管线、PTC |
| 5 | `dsh-llm` | 流契约、能力、请求形状 |
| 6 | `dsh-compaction` | 摘要与遮蔽 |
| 7 | `dsh-app-boot` | profile 组合、boot、HMR |
| 8 | `dsh-api-gateway` / `host-webserver` | 传输层 |
| 9 | `dsh-subagent` / `dsh-workflow` | 编排 |
| 10 | `dsh-sandbox-local` / `fs-sandbox` | 安全边界 |
