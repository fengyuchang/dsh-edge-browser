import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the shipped lazy-tool hook, including the recovery notice which used
// the legacy kind=plugin. No real chats or installed runtime are needed.
const sourceFile = ['./packages/browser-skill-dsh-plugin/lib/index.mjs', './offline/node_modules/@wxg-prc-cpg/browser-skill-dsh-plugin/lib/index.mjs'].map(path => new URL(path, import.meta.url)).find(path => fs.existsSync(path));
assert(sourceFile, 'Native browser plugin must be included');
const source = fs.readFileSync(sourceFile, 'utf8');
const start = source.indexOf('function armLazyTools(');
assert(start >= 0);
const hooks = new Map();
const sandbox = vm.createContext({
  SkillInvocationState: class { consume() {} },
  isSkillGesture: message => message.skill === true,
  isSkillInvocationMessage: message => message.skill === true,
  gestureIdentity: message => message.id,
  skillNameOf: args => args?.name,
  disposeAll: disposers => disposers.forEach(dispose => dispose()),
  createUserMessage: value => {
    assert(value.source.kind && value.source.kind !== 'plugin', 'Every notice needs a v4 producer-owned source kind');
    return { id: 'notice-fixture', role: 'user', ...value };
  }
});
vm.runInContext(source.slice(start, source.indexOf('\n//#endregion', start)), sandbox);
const sourceStart=source.indexOf('function browserSkillSource(');
assert(sourceStart>=0);
vm.runInContext(source.slice(sourceStart,source.indexOf('\n//#endregion',sourceStart)),sandbox);
let unavailable = true;
const ctx = { logger: { error() {} }, get: () => ({ list: () => [] }),
  on: (event, hook) => { hooks.set(event, hook); return () => hooks.delete(event); },
  inject: () => ({ dispose() {} }) };
sandbox.ctx = ctx;
sandbox.registerSuite = () => { if (unavailable) throw new Error('fixture unavailable'); return () => {}; };
const dispose = vm.runInContext('armLazyTools(ctx, registerSuite)', sandbox);
const owner = { session: { events: [] } }, other = { session: { events: [] } };
const preStep = hooks.get('agent/pre-step');
const step = (agent, messages = []) => preStep({ agent, messages, signal: new AbortController().signal }, async () => ({ kind: 'continue', messages }));
try {
  const failure = await step(owner, [{ id: 'invoke-1', skill: true }]);
  assert.equal(failure.messages.at(-1).source.kind, 'plugin:@wxg-prc-cpg/browser-skill-dsh-plugin');
  assert.match(failure.messages.at(-1).content[0].text, /unavailable/);
  assert.equal((await step(other)).messages.length, 0, 'No notice may be injected into a chat that did not invoke this skill');
  assert.equal((await step(owner)).messages.length, 0, 'Repeated failures do not spam the owning chat');
  unavailable = false;
  const recovery = await step(owner, [{ id: 'invoke-2', skill: true }]);
  assert.equal(recovery.messages.at(-1).source.kind, 'plugin:@wxg-prc-cpg/browser-skill-dsh-plugin');
  assert.match(recovery.messages.at(-1).content[0].text, /now available/);
  assert.equal((await step(other)).messages.length, 0);
  assert.equal((await step(owner)).messages.length, 0);
  console.log('PASS: native lazy-tool unavailable/recovery notices use v4 sources, stay in the invoking chat and deduplicate');
} finally { dispose(); }
