# Human help and recovery

With help enabled, use `bsk_assist` action `request-help` for login, CAPTCHA,
OTP, payment confirmation, consent, or after two attempts without progress. Supply
a precise prompt and fresh targets; completion criteria need a stable success signal.
`all` and `any` support at most eight conditions in total. `urlMatches` accepts
RE2-compatible regular expressions of at most 128 characters. A compiled pattern
may contain at most 4096 instructions, and all URL-regex conditions together at most
8192, counting repeated patterns each time. Invalid or over-budget patterns return
`invalid_params` before help starts.
URL conditions do not auto-complete on URLs longer than 8192 characters; the user
can still finish manually. The protocol treats empty, null, and omitted
`url_matches` values as no URL-regex condition.

RE2 rejects JavaScript patterns such as `\u0061`, `a{1001}`, `[^]`, lookahead,
lookbehind, and backreferences. Some accepted patterns differ in meaning: `\a`
is a control character in RE2 rather than `a`, and RE2's `\s` does not include
Unicode whitespace. Rewrite patterns in RE2 syntax; use `urlContains` when a
substring is enough.
Resume only on `continued` / `completed`, then observe. Cancellation/timeout blocks
the step; do not repeat the request. Navigation alone is not success.

With help disabled, neither request help nor re-enable it. `disabled` grants no human
action or permission. Re-observe; use existing logins, authorized inputs and alternatives
within task/host rules. Vision models may try authorized graphical verification.
Phone-only QR scans, face verification, missing SMS codes and image-only tasks for
text-only models may stay blocked. Report missing inputs/capabilities or exhausted
alternatives; continue independent work. Never repeat unknown effects or switch
backends to bypass limits. Borrow confirmation still applies.

## Recover

- Unknown browser tool after plugin reload: invoke `skill` with `name: "browser-skill"`
  again (users can enter `/browser-skill`), then retry the intended browser tool once
  after its schema appears. If it remains unavailable, report the failure.
- Stale ref or target failure: inspect the live target and choose the appropriate action.
  A missing, hidden or covered target is not evidence of human takeover.
- `precondition_failed`: compare `target`, `field`, `expected` and `actual`, then reconsider
  the decision. A new context does not make the expected value true.
- Control revoked: wait-user while the person is active, then sync and reconcile completed steps.
- Unknown tab/session: list owned resources or start a session with the required
  browser selector, if any; never guess IDs.
- Failed/interrupted stop: accepted cleanup continues in the background. Retry the
  same stop; completed cleanup returns `alreadyClosed: true`. For multiple pending
  stops, specify `session` or the owned `requestId` from the result/list/error,
  never both. The request ID identifies the original operation even if its short
  session ID is reused. Never switch sessions to retry cleanup.
- Timeout/unknown effect: inspect before retrying; the action may have happened.
- Unconfirmed fill: read the field. Formatting may satisfy the goal; correct only a
  remaining difference instead of blindly refilling or requesting help.
- Other errors: follow the hint; on unrecoverable failure, report and stop the owned session.
## 后台读取与加载诊断

- `ready:false / reason:blank_page`：空标签没有可读内容，也没有获得输入上下文。新任务页先用 `bsk_page(action=navigate)` 打开目标 URL；也可切换、归还或结束任务。不要反复刷新空白页，不要为消除错误改写借用的用户页面。
- `The strict observation changed before this action`：运行 `bsk_session(action=sync)`，核对新状态，再决定是否执行 evaluate 等动作。没有自动重放脚本。
- 明确提示“不属于当前聊天”时保留会话隔离；提示“当前聊天没有可用的这个浏览器任务”时先 `bsk_session(action=list)` 核对，它可能已结束、被关闭或在重启后失去关联。不要据此接管其他聊天的任务。

- 更新后用 `bsk_session(action=diagnose)` 核对运行版本；旧 action 枚举不含 diagnose/batch 时，宿主插件或聊天工具 schema 尚未更新。只重载 Edge 不能替代 Harness 的 BrowserSkill 重载。
- 未知 ref 表示未观察到、已失效或不属此标签，不代表元素不存在；增加观察预算并使用实际返回引用。语义 locator 未匹配时检查准确名称，不拼接猜测。
- `@view 0x0` 或 `viewport unavailable` 可能是捕获失败，不代表空页面；等候后同步，不自动激活窗口。仍不可测量时报告错误并保留需要人工处理的页面，避免循环重试。
- 取消结束读取等待后，Chrome 仍可能持有旧命令。迟到回执不授权继续动作；原命令未结束前的读取拒绝是保护。待它结束后重新同步；一直无响应时仅回收自己的任务。不要重放不确定的点击或提交。
- 后台截图超时不等于视口归零；核对新观察中的尺寸和页面。`Viewport capture timed out while ...` 会说明准备渲染、抓取像素或身份核验阶段。没有旧读取在途、页面仍相同时，仅重试截图一次；持续失败则说明图像不可用，暂停依赖视觉的步骤，可独立完成的 DOM 读取继续。不要自动激活窗口或重放之前的点击/提交。
