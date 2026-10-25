# 打包指南：deb / AppImage / dmg / exe

这份文档只讲"怎么把源码变成可安装包"，以及构建失败时怎么排查。运行方式见 [README](../README.md)。

> **一句话结论**：没有 Linux 机器也能出 deb —— 用仓库自带的 GitHub Actions，手动跑一次工作流即可下载 `asuka-harness-*-amd64.deb`。

---

## 1. 会产出什么

`npm run dist:linux` 读取 [electron-builder.yml](../electron-builder.yml)，产出（名字由 `artifactName` 决定，没有空格）：

| 文件 | 适用 | 说明 |
|---|---|---|
| `dist/asuka-harness-0.1.0-amd64.deb` | Debian / Ubuntu | 系统级安装，进应用菜单 |
| `dist/asuka-harness-0.1.0-x86_64.AppImage` | 任意发行版 | 单文件，免安装 |
| `dist/asuka-harness-0.1.0-x86_64.AppImage.zsync` | — | 自动更新用的增量索引（没配 publish 时可能不生成） |

其他平台：

| 命令 | 产物 |
|---|---|
| `npm run dist:win` | `asuka-harness-0.1.0-x64.exe`（NSIS 安装器） |
| `npm run dist:mac` | `asuka-harness-0.1.0-arm64.dmg` / `x64.dmg` |

> deb 的体系结构字段是 `amd64`，AppImage 的命名用 `x86_64`，两者都是 x64，不要被文件名差异误导。

### deb 里到底装了什么

```
/opt/Asuka Harness/                      应用本体（asar: false，皮肤/图标是真实文件）
/usr/bin/asuka-harness                   启动器（符号链接）
/usr/share/applications/asuka-harness.desktop
/usr/share/icons/hicolor/16x16/apps/asuka-harness.png
...
/usr/share/icons/hicolor/512x512/apps/asuka-harness.png
```

用户数据不在包里，运行时写到 `~/.config/asuka-harness/`（皮肤、设置、日志）。卸载包不会删用户数据。

检查内容：

```bash
dpkg-deb -I dist/asuka-harness-0.1.0-amd64.deb        # 元数据 + Depends
dpkg-deb -c dist/asuka-harness-0.1.0-amd64.deb | head -40
```

---

## 2. 构建前的检查表

| 项 | 说明 |
|---|---|
| Node.js ≥ 20 | `node -v` |
| 版本号 | `npm version patch`（会改 `package.json` 并打 tag） |
| `author.email` | **deb 的 Maintainer 字段来自这里**，缺了会直接构建失败 |
| 图标 | `assets/icon.png` 至少 512×512，当前是 512 |
| 产品名 | `productName: Asuka Harness`；可执行文件名固定为 `asuka-harness` |
| 依赖锁 | 保留 `package-lock.json`，CI 用 `npm ci` |

`package.json` 里已经写好：

```json
"author": {
  "name": "Asuka Harness contributors",
  "email": "asuka-harness@users.noreply.github.com"
}
```

**发布前请改成你自己的名字和邮箱**，deb 的 Maintainer 会直接展示它。

---

## 3. 在 Linux / WSL2 上构建

```bash
sudo apt update
sudo apt install -y build-essential python3

npm ci
npm run dist:linux
```

不需要预装 Electron、fpm、dpkg-deb 之外的打包器：electron-builder 会下载对应版本的 Electron 预编译包，deb 由它内置的 `app-builder` 生成。

> **WSL2 注意**：把仓库放在 WSL 的 Linux 文件系统里（例如 `~/asuka-harness`），不要在 `/mnt/c/...` 下构建。跨文件系统会丢符号链接权限，deb 的 `/usr/bin/asuka-harness` 和图标可能出错。

构建耗时：首次约 2–5 分钟（要下 Electron ~100MB），之后 30 秒左右。

只出 deb：

```bash
npx electron-builder --linux deb --publish never
```

只出 AppImage：

```bash
npx electron-builder --linux AppImage --publish never
```

出 arm64（在 x64 机器上交叉打包也可以，因为没有原生模块）：

```bash
npx electron-builder --linux deb --arm64
```

---

## 4. 没有 Linux：用 GitHub Actions（推荐）

仓库自带 [.github/workflows/build.yml](../.github/workflows/build.yml)：

- `push` / `PR`：只跑单元测试
- `v*` tag **或手动触发**：三平台打包并上传 artifact

### 方式 A：打 tag

```bash
npm version patch
git push --follow-tags
```

工作流会跑 `test` → `package`，完成后在该次运行页面底部下载：

```
asuka-harness-linux.zip    → 里面是 .deb 和 .AppImage
asuka-harness-windows.zip
asuka-harness-macos.zip
```

### 方式 B：手动触发（不发版）

GitHub → **Actions** → 左侧 `build` → **Run workflow** → 选 `main` → Run。

条件里已经允许 `workflow_dispatch`，不需要 tag 也能出包。

### 自建 runner

Actions 的 Linux 包在 `ubuntu-latest` 上构建；如果要内网构建，把 workflow 的 `runs-on` 换成自建 runner，并保证能访问 npm registry 与 GitHub Releases（Electron 二进制从那里下载）。

---

## 5. 没有 Linux：用 Docker

```bash
docker run --rm -it \
  -v "$PWD":/project \
  -w /project \
  electronuserland/builder:latest \
  bash -lc "npm ci && npm run dist:linux"
```

产物直接落到宿主机的 `./dist/`。

如果不想用这个镜像，`node:22-bookworm` 也可以，只是要自己补工具：

```bash
docker run --rm -it -v "$PWD":/project -w /project node:22-bookworm \
  bash -lc "apt-get update && apt-get install -y --no-install-recommends python3 make g++ && npm ci && npm run dist:linux"
```

注意：

- macOS / Windows 的 Docker Desktop 挂载卷较慢，Electron 解压会明显变慢，属正常
- 容器内以 root 运行，产物属主是 root；需要的话构建后 `sudo chown -R $USER dist`
- **不要在 Windows/macOS 上直接 `npm run dist:linux`**：electron-builder 不支持跨平台生成 deb/AppImage，必须进 Linux 容器、WSL 或 CI

---

## 6. 安装、验证、卸载

### deb

```bash
sudo apt install ./asuka-harness-0.1.0-amd64.deb
# 或者
sudo dpkg -i asuka-harness-0.1.0-amd64.deb && sudo apt -f install
```

验证：

```bash
which asuka-harness
asuka-harness                     # 或从应用菜单启动
desktop-file-validate /usr/share/applications/asuka-harness.desktop
# 如果启用了 dsh:// 协议：
xdg-mime query default x-scheme-handler/dsh
```

卸载：

```bash
sudo apt remove asuka-harness     # 保留 ~/.config/asuka-harness
sudo apt purge asuka-harness      # 用户数据仍然保留，需要手动删
```

> deb 只装"壳"，**不包含 `dsh` CLI**。目标机器仍需要 `npm i -g @deepseek-ai/dsh`，或在 `~/.config/asuka-harness/settings.json` 里填 `dshCommand`。

### AppImage

```bash
chmod +x dist/asuka-harness-0.1.0-x86_64.AppImage
./dist/asuka-harness-0.1.0-x86_64.AppImage
```

常见两个报错：

1. `dlopen(): error loading libfuse.so.2`
   ```bash
   sudo apt install libfuse2        # 24.04 上是 libfuse2t64
   ```
   或者不进 FUSE，直接解包运行：
   ```bash
   ./asuka-harness-0.1.0-x86_64.AppImage --appimage-extract-and-run
   ```

2. `The SUID sandbox helper binary was found, but is not configured correctly`
   Ubuntu 23.10+ 默认限制非特权 user namespace：
   ```bash
   sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
   ```
   或者在解包目录里修正权限：
   ```bash
   ./asuka-harness-0.1.0-x86_64.AppImage --appimage-extract
   sudo chown root:root squashfs-root/chrome-sandbox
   sudo chmod 4755 squashfs-root/chrome-sandbox
   ./squashfs-root/asuka-harness
   ```
   最后手段才是 `--no-sandbox`（会降低浏览器进程隔离，不建议长期用）。

---

## 7. 定制打包

### 改名字 / 图标 / 分类

`electron-builder.yml`：

```yaml
appId: com.example.asuka-harness          # 改这里
productName: Asuka Harness                # 窗口/菜单显示名
artifactName: ${name}-${version}-${arch}.${ext}
executableName: asuka-harness             # 与 StartupWMClass 保持一致

linux:
  category: Development
  icon: assets/icon.png
  desktop:
    entry:
      StartupWMClass: asuka-harness
      MimeType: x-scheme-handler/dsh
```

图标换掉后，重新生成 `assets/icon.png`（≥512×512）即可，electron-builder 会自动生成各尺寸。

### 改版本

```bash
npm version 0.2.0 --no-git-tag-version   # 只改 package.json
npx electron-builder --linux --publish never
```

### 覆盖 deb 依赖

electron-builder 会写入一组默认依赖（gtk3、nss、notify 等）。Ubuntu 24.04 把 `libasound2` 改名成 `libasound2t64`，如果装机时报依赖找不到，可以显式覆盖：

```yaml
deb:
  depends:
    - libgtk-3-0
    - libnotify4
    - libnss3
    - libxss1
    - libxtst6
    - xdg-utils
    - libatspi2.0-0
    - libuuid1
    - libsecret-1-0
    - libasound2t64
```

改完用 `dpkg-deb -I dist/*.deb | grep Depends` 确认。

### 压缩与体积

```yaml
compression: maximum     # 顶层字段；deb/AppImage 会明显变小，构建变慢
```

### 自动更新

- **AppImage** 可以用 electron-updater（需要 `publish` 配置与 `latest-linux.yml`）
- **deb** 不走 electron-updater，标准做法是自建 apt 仓库（`reprepro` / `aptly`）或让用户手动下载新包

当前仓库把 `publish` 设为 `null`，即只出包、不发布。

---

## 8. 排错表

| 现象 | 原因 | 处理 |
|---|---|---|
| `Please specify author 'email' in the application package.json` | deb 需要 Maintainer | 填 `author.email`（已预填占位） |
| `Application icon is not set` / 图标糊 | 图标缺失或小于 512 | 检查 `assets/icon.png` |
| `spawn ... app-builder ENOEXEC` | `/tmp` 挂载了 `noexec` | `TMPDIR=$HOME/.cache/tmp npm run dist:linux` |
| `mksquashfs: not found` | AppImage 工具缺失 | 用 `electronuserland/builder` 镜像；或装 `squashfs-tools` |
| deb 安装报 `libasound2` 不可用 | 24.04 改名 | 见 7 节的 `deb.depends` |
| 启动空白/找不到 dsh | 目标机没装 CLI | `npm i -g @deepseek-ai/dsh`，或改 `dshCommand` |
| 中文显示为方块 | 缺 CJK 字体 | `sudo apt install fonts-noto-cjk` |
| GNOME 看不到托盘 | 缺 AppIndicator | 装 `gnome-shell-extension-appindicator` |
| AppImage 起不来，日志有 sandbox | userns 被限制 | 见第 6 节 |
| `dist` 里混入旧包 | electron-builder 不清理 | `rm -rf dist` 再构建 |
| macOS 构建未签名，打开被拦 | Gatekeeper | 本地测试用 `xattr -dr com.apple.quarantine`，发布需开发者证书与公证 |

---

## 9. 发布前的最小验收

```bash
# 1. 包元数据
dpkg-deb -I dist/asuka-harness-0.1.0-amd64.deb

# 2. 桌面入口合法
dpkg-deb -x dist/asuka-harness-0.1.0-amd64.deb /tmp/dsh-deb
desktop-file-validate /tmp/dsh-deb/usr/share/applications/asuka-harness.desktop

# 3. 干净环境装一次（建议用容器/虚拟机）
docker run --rm -it -v "$PWD/dist:/pkg" ubuntu:24.04 bash
#   apt update && apt install -y /pkg/asuka-harness-0.1.0-amd64.deb
#   asuka-harness --version

# 4. 校验和
sha256sum dist/*.deb dist/*.AppImage > dist/SHA256SUMS
```

最小验收通过的标准：**在没装过 Node 的干净系统上，`asuka-harness` 能启动、能加载 Web UI、能换皮肤**（`dsh` CLI 仍需按 README 安装）。
