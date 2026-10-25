<p align="center">
  <img src="assets/icon.png" width="96" alt="DSH Shell" />
</p>

<h1 align="center">DSH Shell</h1>

<p align="center">
  DeepSeek Harness 的可换肤桌面外壳：把一个真正的 <code>dsh web</code> 装进窗口里，壁纸随便换，功能一个不少。
</p>

<p align="center">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <img alt="electron" src="https://img.shields.io/badge/electron-44-47848F.svg" />
  <img alt="platform" src="https://img.shields.io/badge/platform-linux%20%7C%20macOS%20%7C%20Windows-lightgrey.svg" />
</p>

> **English**: DSH Shell is a skinnable Electron shell around the official
> DeepSeek Harness web UI. It launches `dsh web` on loopback, loads the printed
> URL, and adds a wallpaper layer plus tray/shortcuts. No fork of DSH, no
> reimplementation: models, tools, sessions and plugins are the real web app.

---

## 为什么是"壳"而不是"移植"

官方桌面端只发布 Windows 和 macOS 构建，Linux 上没有原生的 Electron 包。
DSH Shell 不去改 DSH 的代码，而是：

- 启动官方 CLI：`dsh web --no-open --host 127.0.0.1 --port <free>`
- 从 stdout 里抓 `dsh web: http://…?token=…` 这一行（一次性 token）
- 用 Electron 打开这个 URL，之后所有交互都是真实的 DSH Web UI

所以 **模型切换、工具调用、会话管理、插件市场、设置页——页面上有什么就有什么**，
DSH 升级时只要 `dsh web` 的启动方式不变，壳不用跟着改。

## 特性

- **任意背景皮肤**：内置 4 套，也可以导入自己的图片；切换即时生效，不刷新页面
- **壁纸层与应用背景分离**：可调暗化、模糊、平铺/裁切，可选"让壁纸透出应用背景"
- **托盘常驻**：显示/隐藏、换肤、重启后端、打开日志
- **全局快捷键**：默认 `Ctrl/Cmd + Shift + Space` 唤起/隐藏（可改）
- **单实例 + `dsh://` 深链**：可选注册协议，点击通知回到窗口
- **崩溃自愈**：后端异常退出按指数退避重启，日志落盘
- **干净的安全边界**：页面无 Node 集成、无 preload 桥、上下文隔离；外链走系统浏览器

## 环境要求

| 依赖 | 说明 |
|---|---|
| Node.js | ≥ 22（推荐 24，与官方运行时同代） |
| `@deepseek-ai/dsh` | 官方 CLI：`npm i -g @deepseek-ai/dsh` |
| Linux | 建议装 `bubblewrap`（DSH 的沙箱后端），Wayland/X11 均可 |

先确认 CLI 可用：

```bash
dsh --version
dsh web --no-open --port 3080    # 能打印 dsh web: http://127.0.0.1:3080/?token=... 即可
```

> 如果 `dsh` 装在 `~/.local/bin` 而它不在 `PATH` 里，在设置中用 `dshCommand` 指定绝对路径。

## 快速开始

### 用打包好的版本

到 Releases 下载对应平台的安装包（AppImage / deb / dmg / exe），安装后直接启动。

### 从源码运行

```bash
git clone <this-repo> dsh-shell
cd dsh-shell
npm install
npm start          # 开发运行
npm run dev        # 打开 DevTools
```

### 连接到已经跑着的实例

如果 `dsh web` 已经在终端里跑着（或运行在容器/另一台机器），不必让壳再起一个进程，把地址填进设置即可：

```jsonc
// settings.json
{ "attachUrl": "http://127.0.0.1:3080/?token=…" }
```

此时壳只负责窗口与壁纸，不启停后端；「重启后端」会变成刷新页面。

### 打包

```bash
npm run dist:linux    # → dist/dsh-shell-0.1.0-amd64.deb + .AppImage
npm run dist:win      # → NSIS 安装器
npm run dist:mac      # → dmg
```

没有 Linux 环境也能出 deb：GitHub Actions 里手动跑 `build` 工作流，或按 [docs/PACKAGING.md](docs/PACKAGING.md) 用 Docker / WSL2 构建。该文档还包括安装、卸载、依赖覆盖、签名与排错。

## 皮肤系统

### 内置皮肤

| id | 名称 | 风格 |
|---|---|---|
| `aurora` | 极光 | 深蓝 → 青绿渐变 |
| `midnight` | 午夜星空 | 近黑底 + 星点，最不打扰阅读 |
| `paper` | 纸感 | 暖白纸张纹理 |
| `forest` | 雾林 | 低饱和墨绿 + 雾带 |

用托盘菜单、`Ctrl/Cmd + Shift + K` 或菜单「皮肤」切换；也可以点「导入图片…」直接选一张本地图片。

### 自己做一个皮肤

皮肤就是 `skins/` 下的一个文件夹：

```text
skins/my-skin/
├── skin.json
├── background.jpg     # 可选
└── custom.css         # 可选，原样注入
```

```jsonc
{
  "name": "我的壁纸",
  "description": "一句话描述",
  "image": "background.jpg",
  "size": "cover",            // cover | contain | tile
  "position": "center",       // 任意 CSS background-position
  "blur": 0,                  // 0–40 px
  "dim": 0.3,                 // 0–0.95，暗化遮罩浓度
  "tint": "#000000",          // 遮罩颜色
  "transparentRoot": true,    // 是否让壁纸透出应用外层容器
  "css": "custom.css"         // 可选
}
```

把文件夹放到用户皮肤目录即可被识别（覆盖同名内置皮肤也生效）：

| 平台 | 目录 |
|---|---|
| Linux | `~/.config/dsh-shell/skins/` |
| Windows | `%APPDATA%\dsh-shell\skins\` |
| macOS | `~/Library/Application Support/dsh-shell/skins/` |

> 图片最大 20 MB；支持 jpg / png / webp / avif。壁纸会以 data URL 注入，所以切换不需要重启。

## 配置

设置文件同样在上述用户目录下的 `settings.json`，**改完重启壳生效**（皮肤相关项在界面里改是即时生效的）。

| 键 | 默认 | 说明 |
|---|---|---|
| `dshCommand` | `null` | `dsh` 可执行文件路径；`null` 自动探测 |
| `workspace` | `null` | `dsh web` 的工作目录，默认 home |
| `host` | `"127.0.0.1"` | 监听地址，仅建议回环 |
| `port` | `null` | 固定端口；`null` 每次自动选空闲端口 |
| `extraArgs` | `[]` | 追加给 `dsh web` 的参数 |
| `attachUrl` | `null` | 连接已运行的 `dsh web`，不启动子进程 |
| `skin` | `"aurora"` | 当前皮肤 id |
| `skinEnabled` | `true` | 壁纸总开关 |
| `transparentRoot` | `true` | 透出应用外层背景 |
| `closeToTray` | `true` | 关窗时最小化到托盘 |
| `globalShortcut` | `"CommandOrControl+Shift+Space"` | 全局唤起；空串禁用 |
| `spoofBrowserUA` | `true` | 从 UA 中去掉 `Electron/x` |
| `registerProtocol` | `false` | 注册 `dsh://` 协议（可能与官方桌面端冲突） |
| `zoomFactor` | `1` | 页面缩放 0.5–2.5 |
| `window` | `{…}` | 窗口尺寸/位置/最大化状态 |

环境变量 `DSH_BIN` 也可以指定 CLI 路径，优先级低于设置文件。

## 快捷键

| 快捷键 | 作用 |
|---|---|
| `Ctrl/Cmd + Shift + Space` | 显示 / 隐藏窗口（全局，可配置） |
| `Ctrl/Cmd + Shift + K` | 打开皮肤选择器 |
| `Ctrl/Cmd + R` | 重新加载页面（等同 DSH 自带刷新） |
| `Ctrl/Cmd + +/-/0` | 缩放 |

DSH 页面内部的快捷键（`/` 命令、`Ctrl+Enter` 等）完全不受影响。

## 常见问题

**壁纸看不见？**
DSH 的应用外壳有不透明背景。到「皮肤」里打开「壁纸透出应用背景」；如果某个版本改了结构，在自己的皮肤里加 `custom.css` 覆盖即可，例如：

```css
#root > div { background: transparent !important; }
```

**切了皮肤没反应？**
`did-finish-load` 之后才会注入。页面还在启动时先等它加载完；也可以按 `Ctrl/Cmd + R` 重载。

**提示找不到 dsh？**
装 CLI：`npm i -g @deepseek-ai/dsh`；或在 `settings.json` 里写 `"dshCommand": "/home/you/.local/bin/dsh"`。

**端口冲突？**
默认每次自动挑空闲端口，不用管；固定端口被占用时会自动退回到随机端口。

**Linux 上沙箱报 `SANDBOX_UNAVAILABLE`？**
这是 DSH 自己的沙箱。装 `bubblewrap`；某些 Ubuntu 版本还需要放开非特权 user namespace：

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

**和官方桌面端有什么区别？**
官方壳提供托盘、自动更新、内置运行时和账号登录的桌面实现；本壳用 Web UI + 系统运行时替代。依赖 Electron 专属 API 的插件（例如自己起 Electron 窗口的桌宠仍可用，但依赖官方壳 IPC 的功能不行）在 Web 下不可用。

**Wayland 下全局快捷键没反应？**
Electron 的 `globalShortcut` 依赖 X11；纯 Wayland 会话里可能注册失败。用托盘/菜单唤起，或改用 X11（登录界面选 "Ubuntu on Xorg"）。应用本身在 Wayland 下可正常运行。

**账号登录？**
Web 版在本机 HTTP 访问时支持 DeepSeek 账号登录；也可以直接用 API Key。

## 开发

```bash
npm install
npm test          # 纯逻辑单元测试（不需要 Electron）
npm start
```

没有安装 `dsh` 时可以用仓库里的假后端开发界面：

```bash
node scripts/fixtures/fake-dsh.cjs --port 3123      # 终端 A
# 写入 settings.json: {"attachUrl":"http://127.0.0.1:3123/"}
npm start                                           # 终端 B
```

打包自检（不弹窗场景可用）：`npm run smoke` 会在页面加载后把皮肤状态写进日志并退出。

用户目录可以用环境变量 `DSH_SHELL_USER_DATA` 重定向，方便便携安装或隔离测试。

目录结构：

```text
src/
├── main.js            # 应用装配：窗口、托盘、菜单、IPC、生命周期
├── backend.js         # dsh web 子进程：启动、解析 URL、退出、重启
├── window.js          # BrowserWindow 策略：UA、外链、缩放、可见区域
├── tray.js            # 托盘
├── skin-manager.js    # 皮肤发现、缩略图、CSS 注入
├── preload-picker.cjs # 皮肤选择器的受限桥
└── lib/               # 纯函数：配置、定位、URL、端口、皮肤清单/CSS、日志
ui/                    # splash + 皮肤选择器
skins/                 # 内置皮肤
scripts/               # 资源生成（Pillow）
test/                  # node:test
```

重新生成内置壁纸与图标：

```bash
python3 scripts/generate-assets.py   # 需要 Pillow + NumPy
```

## 安全说明

- 页面运行在 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 下，没有 preload 桥
- 只允许同源导航，其余链接交给系统浏览器
- 权限请求按白名单放行（通知、麦克风、剪贴板读取、全屏）
- 一次性 launch token 只存在于窗口 URL 中，不写入磁盘

## License

MIT
