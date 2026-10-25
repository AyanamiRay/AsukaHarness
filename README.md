# Asuka Harness

> 一个本地优先的编码 Agent 宿主：可换肤的桌面壳 + 事件溯源内核 + 会记住自己的人设。
> A local-first coding-agent harness: skinnable desktop shell, event-sourced core, persistent persona.

<p>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D22-339933.svg" />
  <img alt="platform" src="https://img.shields.io/badge/platform-linux%20%7C%20macOS%20%7C%20Windows-lightgrey.svg" />
</p>

仓库：<https://github.com/AyanamiRay/AsukaHarness>

---

## 里面有什么

```
asuka-harness/
├── apps/
│   └── desktop/        # Asuka Harness Desktop：可换肤 Electron 壳（现在就能跑）
├── packages/
│   └── core/           # 内核骨架：会话事件日志 + 派生 + 人设记忆（已带测试）
├── docs/
│   ├── ARCHITECTURE.md # 整体方案：循环、事件、工具、压缩、人设、路线图
│   ├── PERSONA.md      # 人设与自我记忆的完整规格
│   └── DSH-ANALYSIS.md # 对 DeepSeek Harness 后端的拆解（设计参考）
└── packages/core/test/ # 纯逻辑测试，不需要 Electron
```

| 模块 | 状态 |
|---|---|
| Desktop 壳（窗口、皮肤、托盘、悬浮换壁纸按钮） | ✅ 可用 |
| Core：`SessionLog` / `deriveMessages` / `PersonaStore` | ✅ 有实现与测试 |
| Core：Agent 循环 / LLM 适配 / 工具运行时 | 🚧 按 `docs/ARCHITECTURE.md` 的 P0–P8 推进 |
| 桌面与 Core 的 HTTP 对接 | 🚧 Core 提供 HTTP 后，桌面用 `attachUrl` 接入 |

## 快速开始

```bash
# 桌面壳依赖官方 DSH CLI 提供 Web UI
npm i -g @deepseek-ai/dsh

npm install
npm start                 # 启动桌面壳
npm test                  # 跑全部 workspace 测试
npm run test:core         # 只跑内核（会话/人设）
```

当前桌面壳的默认后端仍是 `dsh web`；等 `@asuka/core` 的 HTTP 服务就绪后，在设置里填 `attachUrl` 即可切换到自有内核。

## 桌面壳

- 任意壁纸：内置 4 套 + 页面右下角悬浮按钮（点击选图 / 拖图 / 右键管理 / 可拖动位置）
- 托盘、全局快捷键、`dsh://` 深链、崩溃自愈
- 打包：`npm run dist:linux`（deb + AppImage）、`npm run dist:win`、`npm run dist:mac`
- 详见 [apps/desktop/README.md](apps/desktop/README.md) 与 [apps/desktop/docs/PACKAGING.md](apps/desktop/docs/PACKAGING.md)

## 人设与自我记忆

人设不是一段提示词，而是两层：

1. **人设卡**：名字、身份、背景、性格、语气、价值观、边界（用户编辑）
2. **自我记忆**：模型对自己形成的持久事实（偏好、习惯、承诺、自述），由模型提议、策略或用户批准，跨会话保留

注入是编译出来的：按 `显著度 × 新近度 × 相关度` 选 Top-K，限制 token 预算，渲染在 system 头部，turn 内冻结。
记忆追加而非覆盖，支持去重、冲突标记、衰减、整合与遗忘。

规格见 [docs/PERSONA.md](docs/PERSONA.md)，实现见 [packages/core/src/persona.js](packages/core/src/persona.js)。

## 架构与路线

整体方案（分层、turn/step/attempt、事件模型、工具管线、压缩、人设、12 周排期）见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## License

MIT
