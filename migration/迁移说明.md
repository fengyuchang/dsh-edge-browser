# 安装与更新

完整离线包面向 Windows x64。需要已经安装并初始化 Microsoft Edge 和兼容的 DeepSeek Harness Desktop，并配置可用模型。扩展使用 Manifest V3，要求 Chromium 125+。

## 推荐：完整发行包

1. 在 [Releases](https://github.com/fengyuchang/dsh-edge-browser/releases/latest) 下载 `dsh-edge-browser-windows-x64.zip` 并全部解压。
2. 正常退出 Harness，运行“一键安装.cmd”。默认位置 `D:\DeepSeek浏览器助手`。
3. 在日常使用并登录网站的 Edge 配置中打开 `edge://extensions`，开启并保持“开发人员模式”，加载安装目录中的 `extension`。
4. 扩展启用本地连接，端口 **52800**；重开 Harness。
5. 从扩展中核对浏览器实例 ID，用 `/browser-skill` 让 AI 连接该实例。

需要更改安装位置时，在解压目录中打开 PowerShell：

```powershell
.\Install.ps1 -InstallRoot 'E:\DSH-Edge-Browser'
```

多个 Harness 配置时，用 `-ProfilePath` 指向已经初始化且包含 `package.json` 的配置目录。目标已有目录、原生 BrowserSkill 插件或同名计划任务时，安装器停止，不覆盖。已有 BrowserSkill 的用户需备份后手工合并插件与配置，或用独立的已初始化配置。

仅有 `dsh-edge-browser-extension.zip` 时，只能加载扩展；标注还需要 Harness 端 helper 和客户端桥接。完整包包含已经接入的原生插件以及运行依赖。

## 从源码构建

Node.js 24+，Windows x64，安装 BrowserSkill CLI 0.3.3。CLI 获取方法见 [BrowserSkill 官方项目](https://github.com/Tencent/BrowserSkill)。

```powershell
npm ci --ignore-scripts --legacy-peer-deps
npm test
npm run build:release -- --bsk 'E:\tools\bsk.exe'
```

输出 `dist/dsh-edge-browser-windows-x64.zip`、扩展 ZIP 和对应 `.sha256` 文件。构建器只复制仓库和 npm 运行依赖，验证固定上游扩展的 SHA-256；不读取个人 Harness 资料。

## 手工接入现有配置

这部分适合熟悉 Harness 插件配置的用户。先备份并正常退出 Harness。

- 把 `packages/browser-skill-dsh-plugin` 作为原生 BrowserSkill 插件的完整替换发行代码，保留 `lib`、`skill` 和许可证。可将依赖设为 `file:` 目录；确保运行 peer dependencies 可解析。
- 在 `cordis.patch.yml` 的既有 `browserskill` 配置中设置 `bskPath` 为 CLI 路径、`observationEnabled: true`、`lazyTools: false`。不要追加第二个重复配置项。
- 使用仓库的 `extension/`，不要混用其他版本的后台、内容脚本和弹窗文件。
- 重开 Harness，刷新其聊天界面以加载选择同步；重新加载 Edge 扩展。

默认 Harness HTTP 服务是 **127.0.0.1:3080**，接收地址位于 `extension/dsh-annotations.js`。浏览器连接是 **127.0.0.1:52800**。自定义 Harness 端口时需同步接收地址，浏览器端口在扩展弹窗设置。

## 日常更新与使用

等当前任务结束后再重载扩展。已经打开的旧页面可能仍保留旧内容脚本，在更新后的新任务页使用，或刷新旧页。仅更新快捷键和界面时不必重启 Harness；修改接收端或客户端桥接时需要加载对应新版。

先在 Harness 选中接收聊天，再去 Edge 标注。确认标注面板中的目标名称和 ID 尾号。目标切换、多窗口目标不一致或目标缺失时会显示错误，保留建议供重试。

Alt+Shift+A 打开标注；Enter 发送；Shift+Enter 换行；Esc 取消。组合键在 `edge://extensions/shortcuts` 自定义。不要把实例 ID 硬编码为其他电脑的值。

## 验证与回滚

在解压后的完整包运行：

```powershell
.\runtime\node.exe .\Verify-Package.mjs
.\Install.ps1 -InstallRoot 'E:\DSH-Edge-Browser' -WhatIf
```

安装器成功后，回滚必须在**安装目录**运行 `Rollback.ps1`。它验证状态文件和配置是否被后续修改，再恢复安装前配置、解除自己创建的链接并停用对应后台任务。文件和备份保留。Edge 中手工停用扩展。

## 常见问题

**扩展已连接，但没有标注目标。** 先在 Harness 选中聊天，确认界面已加载新版客户端桥接；多窗口选择不同聊天时请只保留一个明确目标。

**快捷键没有反应。** 去 `edge://extensions/shortcuts` 确认分配成功；确认当前是控制中的任务页，且已重载新版扩展。

**收到 format v4 来源错误。** 使用包含 `browserskill-annotation` 来源的修正版原生插件；旧 `source.kind=plugin` 不能用于当前接收端。

**不想听到网页声音。** 任务页会自动静音，但不会强制开始播放，也不会改变网站播放许可。

**网站需要验证码。** 由智能体请求人工接手，人在同一网页完成后交还控制权。扩展不自动解验证码。
