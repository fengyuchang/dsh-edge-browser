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

## Target and observation recovery

This applies to any site; keep site-specific selectors and private task data out
of the general rule. The installed CLI accepts snapshot refs and CSS, not
`text=...`, XPath, Playwright locators or arbitrary natural-language targets.
Prefer a ref from the current observation. Use a scoped CSS selector only when
its markup and intended visible target have been verified; bounded HTML can help
when observe lacks the needed detail. Do not fetch HTML to replace a usable ref.

| Failure | Recovery |
| --- | --- |
| `DOM Error while querying` | Check the target syntax first. Stop using unsupported text locators; observe the current page and use its visible target ref. This error alone does not prove the site is unavailable. |
| `selector did not match` (including `any element`) | Verify the owned tab, current view, dialog and loaded content. Re-observe and choose a current ref; inspect bounded HTML if no ref is exposed. Do not join guessed alternatives with commas; verify candidates individually. |
| `element not visible` / `no content quads` | A broad selector may hit a hidden duplicate, template or off-screen control. Observe the visible component, reveal a required hover/menu or use scroll-to, then choose its ref. Do not force-click hidden nodes or infer the intended action from a generic button class. |
| Stale or unknown ref | Observe the same owned tab again and choose its newly returned ref. Navigation, rerendering and observation continuation can invalidate earlier refs. |
| Expired/invalid observe cursor | Start a fresh observe without cursor, with a small maxTokens budget. Discard the old continuation and refs; never loop on the expired cursor. |
| Observe itself fails without usable refs | Read the error/hint and check the owned session/tab. Use snapshot, bounded HTML or screenshot through the loaded tool schema when supported; never invent refs from an error or retry the same broken observation indefinitely. |
| Missing/closed browser session | List this chat's owned sessions and inspect the actual state. If the task is gone, start a new session bound to the previously verified browser, navigate/borrow only as authorized, and observe. Never guess IDs, select another chat's session, or replay a possibly completed action. |

The fixed recovery sequence is: **failure → fresh observe → inspect whether the
previous action already succeeded → choose a fresh visible target → retry once
only if still needed → verify the outcome**. For an observe/cursor error, the fresh
observe itself is the retry. A timeout or lost reply is not proof an action failed.
Check completion before repeating a submit, delete, send, upload or other mutation.
Another failure after corrected targeting needs diagnosis, not an unbounded loop.

A ref may be reused for repeated clicks while its snapshot and page remain
unchanged. Do not refresh on every click just to renumber refs. Re-observe after
navigation, relevant DOM changes, stale-target errors, or a changed observation;
identical labels/row positions do not establish ref identity.

If ordinary targeting still fails after a fresh observation and one justified
retry, read [website debugging](debugging.md). For a data-reading task, a read-only
debug capture can inspect the requests/responses triggered by the authorized page
action. Start capture before reproducing, filter to the relevant business request,
and respect redaction/coverage limits. This is a diagnostic alternative, not an
automatic switch to replay, request modification, direct API calls, credential
extraction, or another browser controller. Login/verification blockers follow the
manual handoff above. If no supported path works, report the specific blocker.

## Recover

- Unknown browser tool after plugin reload: invoke `skill` with `name: "browser-skill"`
  again (users can enter `/browser-skill`), then retry the intended browser tool once
  after its schema appears. If it remains unavailable, report the failure.
- Failed target, stale ref or observe cursor: use the recovery matrix above;
  inspect the current state before any justified retry.
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
- Other errors: follow the hint; on unrecoverable failure, report and finish the
  owned task, preserving useful/unsaved/uncertain pages as described in the main skill.
