# Contributing

先用 issue 描述具体触发和预期结果。修复请尽量沿用已有 BrowserSkill 调用、页面浮层和 Harness 接收入口，不另起控制器争用标签页。

1. 使用 Node.js 24+，运行 `npm test`。
2. 修改 `harness/` helper 时，同步 `packages/browser-skill-dsh-plugin/lib/`；修改客户端桥接时同步已接入的 `client.cjs`。修改技能时也需同步 `index.mjs` 内置文本。
3. 测试新的分支和真实用户可见行为。涉及会话目标时要覆盖缺失、含糊、切换与重复提交。
4. 可选真实浏览器检查：设置 `BSK_PATH` 指向 CLI，然后运行 `node annotation-ui-check.mjs --browser YOUR_INSTANCE_ID`。测试会创建并清理自己的合成任务窗口。
5. 提交时保留上游版权，说明变化及验证范围。不要提交依赖目录、运行日志、Cookie、用户配置、真实聊天内容或 API 密钥。

源码测试不需要安装运行依赖；构建离线包前用 `npm ci --ignore-scripts --legacy-peer-deps` 安装固定依赖。原生 Harness 插件发行代码来自上游，若要重构其完整 TypeScript 构建流程，请先讨论范围。
