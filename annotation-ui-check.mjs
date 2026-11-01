import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { registerAnnotationRoutes } from './harness/dsh-annotations.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const browser = process.argv[process.argv.indexOf('--browser') + 1];
assert(process.argv.includes('--browser') && browser, 'Pass a previously verified Edge instance with --browser');
const output = path.join(root, '验收记录'); fs.mkdirSync(output, { recursive: true });
const extensionId = 'a'.repeat(32), routes = new Map(), delivered = [];
let snapshot = '', session, rejectNextSubmit = true;
const fakeAgent = { id: 'isolated-ui-conversation', status: 'running', options: { provider: 'fixture', model: 'fixture' }, steer: value => delivered.push(value) };
const stopRoutes = registerAnnotationRoutes({ get: name => ({
  webServer: { register: route => { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
  agents: { get: id => id === fakeAgent.id ? fakeAgent : undefined }, llm: { resolveModelInfo: async () => ({ inputModalities: ['text'] }) },
  attachments: { validateImage: async () => {}, saveFile: async ({ data, name }) => ({ attachmentId: 'isolated-png', bytes: data.length, name }) }
})[name] }, { isUsable: id => id === 'isolated-ui-browser', dshOwnersOf: () => [fakeAgent.id] }, value => ({ id: 'isolated-message', ...value }));
const server = http.createServer((req, res) => {
  if (req.url === '/fixture/controls.js' || req.url === '/fixture/pointer.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(root, 'extension/content-scripts', req.url.includes('controls') ? 'dsh-controls.js' : 'dsh-pointer.js')));
  }
  if (['/fixture/context', '/fixture/submit', '/fixture/client'].includes(req.url)) {
    if (req.url === '/fixture/submit' && rejectNextSubmit) {
      rejectNextSubmit = false; res.writeHead(409, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: '测试发送失败：目标聊天已变化，建议已保留。' }));
    }
    // Simulate only the extension transport; never call the real Harness host.
    if (req.url === '/fixture/client') req.headers['x-dsh-browser-client'] = '11111111-1111-4111-8111-111111111111';
    else { req.headers.origin = `chrome-extension://${extensionId}`; req.headers['x-dsh-browser-extension'] = extensionId; }
    return void routes.get('/bsk-observation/annotations' + req.url.slice('/fixture'.length))(req, res);
  }
  if (req.url === '/fixture/snapshot') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ snapshot })); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>DeepSeek 局部标注与提示收起验收</title><style>body{font:18px system-ui;background:#edf4fb;color:#173149;margin:50px}main{max-width:780px;padding:35px;background:white;border-radius:18px}table{border-collapse:collapse;width:100%}td,th{padding:15px;text-align:left;border-bottom:1px solid #ddd}h1{font-size:30px}button{font:inherit;padding:10px 15px;background:#ff8735;border:0;border-radius:8px}</style><main><h1>DeepSeek 浏览器局部标注</h1><p>用于测试框选、建议发送与浮层收起；全部内容为合成数据。</p><table id="results"><tr><th>项目</th><th>内容</th></tr><tr><td>论文标题</td><td>合成论文 A</td></tr><tr><td>下载操作</td><td><button id="download">下载合成文件</button></td></tr></table><input type="password" value="DO-NOT-CAPTURE" hidden></main>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const publishSelection = await fetch(url + 'fixture/client', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: 1, targetId: fakeAgent.id, active: true, title: '局部标注隔离验收会话' }) });
assert.equal(publishSelection.status, 200);
const cliPath = fs.existsSync(path.join(root, 'bin/bsk.exe')) ? path.join(root, 'bin/bsk.exe') : (process.env.BSK_PATH || 'bsk');
const cli = async (...args) => {
  const result = await promisify(execFile)(cliPath, [...args, '--json'], { env: { ...process.env, BSK_AUTO_START: '0' }, windowsHide: true, timeout: 45000, maxBuffer: 8e6 });
  return JSON.parse(result.stdout);
};
const run = (...args) => cli(...args, '--session', session);
const evaluate = async expression => { const result = await run('evaluate', expression); assert(result.ok, JSON.stringify(result)); return result.value; };
const report = { scope: 'Real Edge DOM; simulated extension transport and pointer events; isolated Harness receiver. No real user conversation messages.', checks: [] };
try {
  session = (await cli('session', 'start', '--browser', browser, '--no-focus', '--name', 'DeepSeek 批注组件验收')).session_id;
  await run('navigate', url);
  await evaluate("document.querySelectorAll('#dsh-automation-pointer').forEach(node=>node.remove());true");
  const initial = path.join(output, 'annotation-fixture.png'); await run('screenshot', '--out', initial);
  snapshot = 'data:image/png;base64,' + fs.readFileSync(initial).toString('base64');
  await evaluate(`(async()=>{
    globalThis.__dshControlsInstalled=false;globalThis.__dshPointerInstalled=false;
    document.querySelectorAll('#dsh-browser-controls,#dsh-automation-pointer').forEach(node=>node.remove());
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
    globalThis.__testRoots={};const attach=Element.prototype.attachShadow;
    Element.prototype.attachShadow=function(options){const shadow=attach.call(this,options);if(this.id.startsWith('dsh-'))globalThis.__testRoots[this.id]=shadow;return shadow;};
    const listeners=[],changed=[],storage={};
    globalThis.__testBus={emit:message=>listeners.forEach(listener=>listener(message,{},()=>{})),runtime:{onMessage:{addListener:f=>listeners.push(f)},sendMessage:async message=>{
      if(message.kind==='dsh-annotation-begin'){const r=await fetch('/fixture/context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({browserSessionId:'isolated-ui-browser'})});const context=await r.json();const image=await(await fetch('/fixture/snapshot')).json();return {ok:r.ok,...context,...image,expiresAt:Date.now()+300000,url:location.href,title:document.title};}
      if(message.kind==='dsh-annotation-submit'){const r=await fetch('/fixture/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...message.annotation,token:message.token})});return {ok:r.ok,...await r.json()};}
      return {ok:true};}},storage:{local:{get:async()=>storage,set:async values=>{const changes={};for(const [key,value]of Object.entries(values)){storage[key]=value;changes[key]={newValue:value};}changed.forEach(f=>f(changes,'local'));}},onChanged:{addListener:f=>changed.push(f)}}};
    Function('chrome',await(await fetch('/fixture/controls.js')).text())(__testBus);Function('chrome',await(await fetch('/fixture/pointer.js')).text())(__testBus);
    __testBus.emit({type:'bh-agent-overlay-state',mode:'control',sessionId:'isolated-ui-browser'});
    __testBus.emit({type:'dsh-visual-activity',action:'wait_for_navigation',label:'等待网页加载',phase:'complete'});
    const pill=document.createElement('div');pill.id='test-control-pill';pill.textContent='DeepSeek 正在控制 · 局部标注';pill.style.cssText='position:fixed;bottom:32px;left:30%;background:white;padding:14px;border-radius:28px';document.documentElement.append(pill);dshBindControlPill(pill);Element.prototype.attachShadow=attach;return Object.keys(__testRoots);
  })()`);
  assert.equal(await evaluate(`(()=>{const b=__testRoots['dsh-automation-pointer'].querySelector('.activity-hide'),r=b.getBoundingClientRect();return getComputedStyle(b).pointerEvents==='auto'&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2).id==='dsh-automation-pointer'})()`), true, 'The hide button must receive a real human click above the native input blocker');
  assert.equal(await evaluate(`(()=>{__testBus.emit({type:'bh-automation-bypass',enabled:true});const result=getComputedStyle(__testRoots['dsh-automation-pointer'].querySelector('.activity-hide')).pointerEvents==='none';__testBus.emit({type:'bh-automation-bypass',enabled:false});return result})()`), true, 'AI input must pass through the interactive hint buttons');
  assert.equal(await evaluate(`(()=>{const r=__testRoots['dsh-automation-pointer'];r.querySelector('.activity-hide').click();return r.querySelector('.activity').style.display==='none'&&!__testRoots['dsh-browser-controls'].querySelector('.activity-dock').hidden})()`), true);
  assert.equal(await evaluate(`(()=>{__testRoots['dsh-browser-controls'].querySelector('.expand-activity').click();return __testRoots['dsh-automation-pointer'].querySelector('.activity').style.display==='block'})()`), true);
  assert.equal(await evaluate(`(()=>{dshCollapseControl(true);return document.getElementById('test-control-pill').style.display==='none'&&!__testRoots['dsh-browser-controls'].querySelector('.control-dock').hidden})()`), true);
  await evaluate(`__testRoots['dsh-browser-controls'].querySelector('.expand-control').click();true`);
  assert.equal(await evaluate(`document.getElementById('test-control-pill').style.display`), 'flex');
  report.checks.push('Step hint and control pill collapse, dock and restore independently');
  assert.equal(await evaluate(`(()=>{__testBus.emit({type:'bh-agent-overlay-state',mode:'hidden'});__testBus.emit({kind:'dsh-annotation-open'});return __testRoots['dsh-browser-controls'].querySelector('.editor').hidden})()`), true);
  assert.equal(await evaluate(`(async()=>{__testBus.emit({type:'bh-agent-overlay-state',mode:'control',sessionId:'isolated-ui-browser'});dshCollapseControl(true);__testBus.emit({kind:'dsh-annotation-open'});for(let i=0;i<150&&__testRoots['dsh-browser-controls'].querySelector('.editor').hidden;i++)await new Promise(resolve=>setTimeout(resolve,30));return !__testRoots['dsh-browser-controls'].querySelector('.editor').hidden})()`), true);
  await evaluate('dshCollapseControl(false);true');
  report.checks.push('Annotation shortcut opens only a controlled task page, including with the control pill collapsed');
  const selection = await evaluate(`(()=>{const r=__testRoots['dsh-browser-controls'],stage=r.querySelector('.stage');stage.setPointerCapture=()=>{};const fire=(node,type,x,y)=>node.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,button:0,clientX:x,clientY:y}));fire(stage,'pointerdown',85,215);fire(stage,'pointermove',620,410);fire(stage,'pointerup',620,410);const b=r.querySelector('.box');fire(b,'pointerdown',220,270);fire(stage,'pointermove',240,280);fire(stage,'pointerup',240,280);const handle=r.querySelector('.resize');fire(handle,'pointerdown',640,420);fire(stage,'pointermove',665,440);fire(stage,'pointerup',665,440);r.querySelector('textarea').value='请提取框内表格，并点击下载按钮。';r.querySelector('textarea').dispatchEvent(new Event('input'));return {hidden:b.hidden,style:b.style.cssText,enabled:!r.querySelector('.send').disabled,status:r.querySelector('.status').textContent}})()`);
  assert.equal(selection.hidden, false); assert.equal(selection.enabled, true); assert(selection.style.includes('left: 105px')); assert(selection.style.includes('width: 560px'));
  report.checks.push('Rectangle draws, moves, resizes and enables suggestion send');
  assert.equal(await evaluate(`(()=>{const n=__testRoots['dsh-browser-controls'].querySelector('textarea');return [{isComposing:true},{keyCode:229},{shiftKey:true},{ctrlKey:true},{altKey:true},{metaKey:true}].every(options=>n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true,cancelable:true,...options})))})()`), true, 'IME confirmation and modified Enter must retain their native behavior');
  assert.equal(delivered.length, 0);
  await evaluate(`__testRoots['dsh-browser-controls'].querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true}));true`);
  assert.equal(delivered.length, 0, 'Holding Enter must not start a new submission');
  report.checks.push('IME Enter and keyCode 229 do not send; Shift+Enter keeps newline; repeated Enter does not resend');
  assert.equal(await evaluate(`__testRoots['dsh-browser-controls'].querySelector('.target').title`), fakeAgent.id);
  await run('screenshot', '--out', path.join(output, '局部标注界面.png'));
  assert.equal(await evaluate(`(async()=>{const r=__testRoots['dsh-browser-controls'];r.querySelector('.send').click();for(let i=0;i<150&&!r.querySelector('.status').classList.contains('error');i++)await new Promise(resolve=>setTimeout(resolve,30));return r.querySelector('.status').textContent.includes('测试发送失败')&&!r.querySelector('.editor').hidden&&r.querySelector('textarea').value.includes('请提取框内表格')})()`), true);
  assert.equal(delivered.length, 0);
  report.checks.push('Failed submission keeps its visible error, rectangle and advice for retry');
  assert.equal(await evaluate(`(async()=>{const r=__testRoots['dsh-browser-controls'],n=r.querySelector('textarea'),e=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true,cancelable:true});n.dispatchEvent(e);n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true}));for(let i=0;i<150&&!r.querySelector('.editor').hidden;i++)await new Promise(resolve=>setTimeout(resolve,30));return e.defaultPrevented&&r.querySelector('.editor').hidden})()`), true);
  assert.equal(delivered.length, 1);
  assert(delivered[0].content[0].text.includes('请提取框内表格'));
  assert(!delivered[0].content[0].text.includes('DO-NOT-CAPTURE'));
  assert.equal(delivered[0].content[1].type, 'file');
  assert.equal(await evaluate(`__testRoots['dsh-browser-controls'].querySelector('.editor').hidden`), true);
  report.checks.push('Cropped PNG and suggestion reach the isolated target conversation; password values excluded');
  report.checks.push('Enter submits exactly once, blocks a second press while sending, and retains the same destination');
  await evaluate('dshCollapseControl(true);dshCollapseActivity(true);true');
  await run('screenshot', '--out', path.join(output, '提示收起到页面边缘.png'));
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.message; throw error; }
finally {
  if (session) { await cli('session', 'stop', session); report.cleanedUp = true; }
  stopRoutes(); await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(output, 'annotation-ui-component.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
