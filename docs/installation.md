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

**0.4.2-dsh.5 升级到 dsh.6：** 本轮修复隐藏页面角色/标签查询挂起、读取取消未及时结束等待，以及未知引用/视口不可测量的诊断。备份并更新扩展与原生插件，先重载 Edge，再单独重载 Harness 中的 BrowserSkill；无法单独重载时等其他任务结束后正常重开 Harness。两端修订号需一致，CLI / 协议仍为 0.4.2 / 1.8。用运行状态的 pluginVersion 与 diagnose 确认生效，不能只看磁盘文件或宿主进程启动时间。[修复和验收范围](recovery-0.4.2-dsh.6.md)。

**0.4.2-dsh.4 升级到 dsh.5：** 任务结束后备份并更新本项目扩展和原生插件，CLI 仍为 0.4.2、协议 1.8。重新加载 Edge 扩展，再单独重载 BrowserSkill；无法单独重载时正常重开 Harness。不要为此更新整个配置的依赖。新聊天读取新版技能，旧聊天重新调用 `/browser-skill`。新定位和批量操作会核对活动扩展修订号；不匹配时先停止输入并提示加载，不能通过换实例规避。

**0.4.2-dsh.1 / .2 / .3 升级到 dsh.4：** 本轮同时更新扩展与 Harness 浏览器原生插件，CLI 仍为 0.4.2、协议 1.8。等浏览器任务结束后备份两端，只替换本项目的扩展和原生插件，固定到本版 TGZ；保留原有模型、其他插件与依赖。先在 `edge://extensions` 重新加载扩展，确认已连接，再重载 `browserskill`（不能单独重载时正常重开 Harness）。新任务页使用新版；旧任务页需刷新。不要在现有配置运行全量依赖更新。

**0.4.2-dsh.1 升级到 dsh.2：** 本次只修复原生插件的模型选择读取，Edge 和 CLI 不变。完成当前浏览器任务后，备份原生插件，使用新版原生 TGZ 或完整包中的原生插件更新，并将已存在的浏览器依赖固定到新版发行地址。只重载 `browserskill`，无法单独重载时再正常重开 Harness；无需重载 Edge。保留其他依赖和配置，不在现有配置运行全量依赖更新。

**r4 及更早版本升级到 r5：** 本版新增任务结束收尾，包含此前的原聊天路由和工具通知修复，需要同时更新两端。等当前任务完成，正常退出 Harness；备份当前扩展目录和原生插件目录后，使用完整包中的 `extension/` 和 `offline/node_modules/@wxg-prc-cpg/browser-skill-dsh-plugin/` 替换对应部署文件，保留已有配置和模型依赖。若原生插件是目录链接，应更新其实际目标目录。重开 Harness，再重新加载 Edge 扩展。更新后从原聊天创建新任务页；上次任务的浏览器窗口可能已随退出关闭。

全新安装器会拒绝覆盖旧部署，不要为了升级删除整个 Harness 配置。定制过插件的用户先合并变更，保留备份。

等当前任务结束后再重载扩展。已经打开的旧页面可能仍保留旧内容脚本，在更新后的新任务页使用，或刷新旧页。仅更新快捷键和界面时不必重启 Harness；修改接收端或客户端桥接时需要加载对应新版。

在目标聊天中创建浏览器任务，在进行中的 Edge 任务页标注。建议始终回到实际控制该网页的原聊天；切换查看别的聊天不会改投。核对面板中的名称和 ID 尾号。归属缺失、含糊或变化时保留建议并拒绝发送。

模型用 `bsk_session(action=finish, keepTabIds)` 判断结果页去留，保留页成为普通页面，借入的原有标签归还；指针、调试连接和控制提示撤掉。dsh.4 中，模型漏调收尾、取消或错误停止时关闭临时任务页，保护人工操作、未提交表单和无法安全判断的内容并释放控制。等待人工求助时不清理。再次操作或标注保留页时，让 AI 创建任务并借入该页。仅复用插件留下的空闲后台窗口，不接管普通 Edge 窗口或已有结果标签。

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

**需要登录却没有弹出人工接手窗口。** 主提示词和工具说明要求模型在任务被登录、扫码或验证码阻挡时立即调用 `bsk_assist(action=request-help, timeoutMs=600000)`，在同一任务里等待；最终回复“请先登录”、普通 wait 或 finish 均不能替代。确认扩展的“允许请求人工协助”已开启；不要让模型替你改这个设置。该请求会恢复任务窗口并显示“AI 已暂停等待，会话不会结束”。完成后点击“完成并交还控制权”，模型重新观察再继续。若只在聊天回复“已登录”，工具可能仍在等页面上的交还按钮。更新后让已有聊天重新加载 `/browser-skill`。

**点击后黄色光晕和小窗格闪一下。** dsh.4 修复普通视口/元素截图暂时隐藏控件的路径。需要同时加载新版扩展和浏览器技能；旧任务页刷新或重建。普通截图会包含 DeepSeek 工具界面，模型应忽略这些控件。全页干净导出、局部标注和页面导航另有显示切换，不属于此次连续点击截图的保证范围。

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
