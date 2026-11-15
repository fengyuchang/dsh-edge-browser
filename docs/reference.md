# 参考项目与本轮取舍

参考 [SheepofSheep/dsh-doyourweb](https://github.com/SheepofSheep/dsh-doyourweb)，版本 0.1.7，固定提交 `0cbc4bf444d262caf6c47e046b90cab3d24e280f`，MIT。对照 README、工具与提示、标注实现、客户端入口及架构文档。

| 借鉴点 | 本项目实现 |
| --- | --- |
| 明确的聊天绑定 | 服务端从任务归属锁定原聊天；输入栏只提供名称；归属缺失、含糊或变化时拒绝发送 |
| 确认与重试 | Harness 确认后才显示成功；失败保留文字和选区；重复提交去重 |
| 完整定位信息 | 裁剪截图、坐标、视口、有限区域文字和标签/角色/选择器 |
| 网页数据边界 | 网页文字仅作定位数据；转义控制引用，不将网页指令当作用户授权 |
| 按需阅读 | 技能增加分段观察、按需继续和刷新引用，复用原生 maxTokens / nextCursor |

参考项目默认把标注加入输入草稿。本项目按明确的人机协作流程，点对勾或按 Enter 直接提交到实际控制网页的原聊天。沿用 BrowserSkill 控制器，不再引入第二套浏览器连接。

当前尚未实现：Harness `@` 菜单选已有标签、另一套 summary/handle 阅读协议，以及 WebMCP 网站工具发现。它们需要各自的协议与界面验证，不在当前版本中宣传为已有功能。可中断小批量操作已在 0.4.2-dsh.5 实现。

适配的客户端设计保留原 MIT 署名，见 [归属声明](../THIRD_PARTY_NOTICES.md)。

## dsh-pilot 的调用速度设计

0.4.2-dsh.4 对照 [momasiku/dsh-pilot](https://github.com/momasiku/dsh-pilot) 的官方说明与本机 0.7.2 发行代码，研究常驻 worker、组合动作和未变化图像去重。本项目采用减少重复调用与按需截图的思路，继续使用原生浏览器归属、目标和取消检查，没有复制其桌面输入实现。具体范围与本机测量见 [性能说明](performance-0.4.2-dsh.4.md)。

## agent-browser 的模型操作与诊断设计

0.4.2-dsh.5 参考 [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) 的语义定位、小批量调用、按需观察与版本一致性思路。使用官方 0.43.0 Windows 二进制进行独立后台对照，未向日常 Harness 安装第二套浏览器后端；没有复制其 Rust、MCP 或桌面实现。保留原生 DSH 会话归属、合作控制、标注与页面收尾。[本轮说明](automation-0.4.2-dsh.5.md)。
