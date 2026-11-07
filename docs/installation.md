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

Node.js 24+，Windows x64，安装 BrowserSkill CLI 0.4.2。CLI 获取方法见 [BrowserSkill 官方项目](https://github.com/Tencent/BrowserSkill)。

```powershell
pnpm install --frozen-lockfile
pnpm test
# 可选：从固定上游重新构建（需要 git + pnpm 10.17）
pnpm run build:source -- --check
pnpm run build:release -- --bsk 'E:\tools\bsk.exe'
```

输出 `dist/dsh-edge-browser-windows-x64.zip`、扩展 ZIP 和对应 `.sha256` 文件。构建器只复制仓库和 npm 运行依赖，验证固定上游扩展的 SHA-256；不读取个人 Harness 资料。

## 手工接入现有配置

这部分适合熟悉 Harness 插件配置的用户。先备份并正常退出 Harness。

- 把 `packages/browser-skill-dsh-plugin` 作为原生 BrowserSkill 插件的完整替换发行代码，保留 `lib`、`skill` 和许可证。可将依赖设为 `file:` 目录；确保运行 peer dependencies 可解析。
- 在 `cordis.patch.yml` 的既有 `browserskill` 配置中设置 `bskPath` 为 CLI 路径、`observationEnabled: true`、`lazyTools: false`。不要追加第二个重复配置项。
- 使用仓库的 `extension/`，不要混用其他版本的后台、内容脚本和弹窗文件。
- 重开 Harness，刷新其聊天界面以加载选择同步；重新加载 Edge 扩展。

默认 Harness HTTP 服务是 **127.0.0.1:3080**，接收地址位于 `source/extension/dsh-annotations.js`（构建时 `BSK_DSH_HTTP_BASE`）。浏览器连接是 **127.0.0.1:52800**。自定义 Harness 端口时需同步接收地址，浏览器端口在扩展弹窗设置。

## 日常更新与使用

**0.4.2-dsh.1 升级到 dsh.2：** 本次只修复原生插件的模型选择读取，Edge 和 CLI 不变。完成当前浏览器任务后，备份原生插件，使用新版原生 TGZ 或完整包中的原生插件更新，并将已存在的浏览器依赖固定到新版发行地址。只重载 `browserskill`，无法单独重载时再正常重开 Harness；无需重载 Edge。保留其他依赖和配置，不在现有配置运行全量依赖更新。

**r4 及更早版本升级到 r5：** 本版新增任务结束收尾，包含此前的原聊天路由和工具通知修复，需要同时更新两端。等当前任务完成，正常退出 Harness；备份当前扩展目录和原生插件目录后，使用完整包中的 `extension/` 和 `offline/node_modules/@wxg-prc-cpg/browser-skill-dsh-plugin/` 替换对应部署文件，保留已有配置和模型依赖。若原生插件是目录链接，应更新其实际目标目录。重开 Harness，再重新加载 Edge 扩展。更新后从原聊天创建新任务页；上次任务的浏览器窗口可能已随退出关闭。

全新安装器会拒绝覆盖旧部署，不要为了升级删除整个 Harness 配置。定制过插件的用户先合并变更，保留备份。

等当前任务结束后再重载扩展。已经打开的旧页面可能仍保留旧内容脚本，在更新后的新任务页使用，或刷新旧页。仅更新快捷键和界面时不必重启 Harness；修改接收端或客户端桥接时需要加载对应新版。

在目标聊天中创建浏览器任务，在进行中的 Edge 任务页标注。建议始终回到实际控制该网页的原聊天；切换查看别的聊天不会改投。核对面板中的名称和 ID 尾号。归属缺失、含糊或变化时保留建议并拒绝发送。

r5 在回答完成时结束控制。模型用 `bsk_session(action=finish, keepTabIds)` 判断结果页去留，保留页成为普通页面，借入的原有标签归还；指针、调试连接和控制提示撤掉。模型漏调收尾、取消或错误停止时，保守保留剩余页面并释放控制。需要再次操作或标注保留页时，让 AI 创建任务并借入该页；不要让它在最终回答后保持控制。

Alt+Shift+A 打开标注；Enter 发送；Shift+Enter 换行；Esc 取消。组合键在 `edge://extensions/shortcuts` 自定义。不要把实例 ID 硬编码为其他电脑的值。

## 验证与回滚

在解压后的完整包运行：

```powershell
.\runtime\node.exe .\Verify-Package.mjs
.\Install.ps1 -InstallRoot 'E:\DSH-Edge-Browser' -WhatIf
```

安装器成功后，回滚必须在**安装目录**运行 `Rollback.ps1`。它验证状态文件和配置是否被后续修改，再恢复安装前配置、解除自己创建的链接并停用对应后台任务。文件和备份保留。Edge 中手工停用扩展。

**r5 升级到 r6：** 本版增强登录接手提示词和 Harness 工具卡，只需备份并更新 Harness 原生插件，等浏览器任务结束后重载插件或正常重开 Harness。Edge 扩展与 r5 相同，无需重新加载。已有聊天重新调用 `/browser-skill`，使模型读到最新指引。若第三方安装或更新覆盖了本项目的原生插件，请从完整包恢复本项目版本，保留已有配置和其他本机定制。

## 常见问题

**r6 升级到 r7。** 本版更新定位、观察和会话恢复指引及工具参数说明，只需备份并更新 Harness 原生插件，等浏览器任务结束后重载插件或正常重开 Harness；已有聊天重新调用 `/browser-skill`。Edge 扩展仍与 r5 相同，无需重新加载。

**r7 升级到 r8。** 本版修复点击时指针和控制提示的闪烁。等当前浏览器任务结束后，备份已加载的扩展目录，用 r8 包中的 `extension/` 内容替换该目录下的对应文件，保持加载路径不变；在 `edge://extensions` 对“DeepSeek Harness”点击“重新加载”，确认“已连接”。已打开的旧页需刷新，或让模型创建新任务页。Harness 原生插件与 r7 相同，无需为这次修复重启 Harness。完整包同时包含 r7 的定位恢复和此前的人工接手、会话隔离与标注修复。

**点不到“返回”或列表里的按钮。** 让模型先重新 observe，确认当前页面和操作是否已经生效，再使用这次返回的可见控件引用。`text=…` 不受支持；不要拼接多个猜测选择器或点击隐藏副本。页面稳定时引用可复用；分页 cursor 失效需去掉 cursor 重新观察，不能循环重试。

**需要登录却没有弹出人工接手窗口。** 当前主提示词要求模型在任务被登录、扫码或验证码阻挡时立即调用 `bsk_assist(action=request-help)`，只回复“请先登录”或等待网页加载不会弹窗。确认扩展的“允许请求人工协助”已开启；不要让模型替你改这个设置。在浏览器完成登录后点击“完成并交还控制权”，模型会重新确认页面再继续。若只在聊天里回复“已登录”，浏览器工具可能仍在等待页面上的交还操作。更新提示词后，让已有聊天重新加载 `/browser-skill`。

**扩展已连接，但没有标注目标。** 从目标聊天创建或重新打开浏览器任务，并确认原聊天仍在 Harness 中打开。接收目标来自服务端任务归属，不能通过切换其他聊天指定。

**快捷键没有反应。** 去 `edge://extensions/shortcuts` 确认分配成功；确认当前是控制中的任务页，且已重载新版扩展。

**收到 format v4 来源错误。** 升级 r4 或更新的 Harness 原生插件，并正常重启 Harness。标注与工具可用性通知均已修正；旧 `source.kind=plugin` 不能用于当前接收端。仅重载 Edge 扩展不足以更新 Harness 通知。

**不想听到网页声音。** 任务页会自动静音，但不会强制开始播放，也不会改变网站播放许可。

**网站需要验证码。** 由智能体请求人工接手，人在同一网页完成后交还控制权。扩展不自动解验证码。

## 0.4.2 大版本升级

扩展、CLI、原生插件必须一起升级，旧 1.3 协议不能与新 1.8 混用。

1. 等所有浏览器任务结束，保存未提交的页面。备份原扩展、CLI、原生插件、配置的 package.json 和 pnpm-lock.yaml。
2. 使用本版完整包替换浏览器相关文件，保留其他插件和 Harness 核心。原生包应固定为本地 file: 发行目录或 .tgz，避免插件市场恢复成未定制的上游包。
3. 仅重启浏览器后台服务、重载浏览器原生插件，再在 edge://extensions 重新加载扩展。无法单独重载时再正常重开 Harness。
4. 确认 CLI/扩展均为 0.4.2、协议 1.8，核对原浏览器实例。重新建立任务，不沿用旧控制上下文。

不要在现有 Harness 配置运行全量依赖升级。`scripts/pack-native.mjs` 生成可固定的原生插件 .tgz；`scripts/pin-browser-package.mjs <配置目录> <tgz>` 只更改 BrowserSkill 的依赖和锁定项，运行前备份配置并确保 yaml 包可从该配置解析。它不安装其他依赖、不修改核心、也不主动重启 Harness。

新版默认后台打开任务，普通任务窗口会最小化。用户主动查看和登录/验证码接手仍可显示页面；保留结果页也不会主动抢前台。
