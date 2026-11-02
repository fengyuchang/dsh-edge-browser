# Human help and recovery

## Login and verification: open the handoff, then wait

Unless the user explicitly disabled help or this task's tool returned `disabled`,
a required login, expired session, QR scan, CAPTCHA, SMS/OTP or two-factor
verification MUST trigger `bsk_assist(action=request-help)` immediately. Unknown
help settings are not a reason to wait: call the tool and let the extension enforce
the user's setting; do not invent a settings query or require an enabled signal.
Do not wait for two failures. A chat reply saying “please log in”, a page-load wait,
refreshing, or ending the turn does not create the manual-help UI. A visible Sign
in link alone is not a blocker when the task can use existing login/public content.

Tell the owning chat what site needs which action, then call request-help with
the actual owned session and tabId, a clear title and prompt, and timeoutMs 600000.
Ask the user to complete the step in that browser page and click “完成并交还控制权”.
Never request their password, cookies, QR confirmation or OTP in chat. Keep the
same browser task alive while waiting; do not call finish/stop or issue parallel
commands to that session. Do not redirect the request to another chat or profile.

For payment/consent and other human decisions, use the same handoff within the
user-authorized scope. After two attempts without progress on an ordinary page,
inspect the cause and request help if it needs the user.

Use explicit handback by default. Supply fresh targets only when useful, and omit
targets if a login rerender invalidated them. Add completionCriteria only for an
observed, stable success signal which is currently false. Do not use an already
true URL/text condition or navigation alone as proof of authentication. A user
saying “已登录” in chat is not a completed browser handoff: check the tool outcome;
if still waiting, tell them to click the page's handback button.

## Completion criteria and outcomes

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
After `continued` / `completed`, observe the same target tab again and verify the
required login/verification succeeded before resuming the original task. Do not
reuse old refs. `navigated` only reports a page change: observe to learn its state,
never claim login succeeded from that outcome alone. `cancelled` / `timed_out`
block the dependent step: report the actual outcome, preserve the page when
finishing, and do not automatically repeat the request.

With help disabled, neither request help nor re-enable it. `disabled` grants no human
action or permission. Tell the user explicitly that no help window was opened;
never pretend they were prompted or completed login. Re-observe; use existing logins, authorized inputs and alternatives
within task/host rules. Vision models may try authorized graphical verification.
Phone-only QR scans, face verification, missing SMS codes and image-only tasks for
text-only models may stay blocked. Report missing inputs/capabilities or exhausted
alternatives; continue independent work. Never repeat unknown effects or switch
backends to bypass limits. Borrow confirmation still applies.

## Recover

- Unknown browser tool after plugin reload: invoke `skill` with `name: "browser-skill"`
  again (users can enter `/browser-skill`), then retry the intended browser tool once
  after its schema appears. If it remains unavailable, report the failure.
- Stale ref: observe, then retry the intended action once.
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
