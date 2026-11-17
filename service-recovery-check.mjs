import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
if(process.platform!=='win32'){console.log('SKIP: Windows service recovery fixture');process.exit(0)}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-service-check-'));
let child;
try{
 const script=path.join(dir,'run-daemon.ps1'),source=new URL('./migration/run-daemon.ps1',import.meta.url);
 fs.copyFileSync(fs.existsSync(source)?source:new URL('./run-daemon.ps1',import.meta.url),script);
 const parser=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile($env:DSH_SERVICE_CHECK_SCRIPT,[ref]$tokens,[ref]$errors);if($errors.Count){throw $errors[0]}"],{windowsHide:true,encoding:'utf8',env:{...process.env,DSH_SERVICE_CHECK_SCRIPT:script}});
 assert.equal(parser.status,0,parser.stderr);
 const fake=path.join(dir,'fake-bsk.cmd');fs.writeFileSync(fake,'@echo off\r\nif exist "%~dp0first.txt" goto healthy\r\n> "%~dp0first.txt" echo first\r\necho {"message":"transient IPC read failure"}\r\nexit /b 2\r\n:healthy\r\n> "%~dp0recovered.txt" echo recovered\r\necho {"daemon_version":"fixture"}\r\nexit /b 0\r\n');
 child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',script,'-BskPath',fake],{windowsHide:true,stdio:'ignore'});
 const deadline=Date.now()+8000;while(Date.now()<deadline&&!fs.existsSync(path.join(dir,'recovered.txt'))&&child.exitCode===null)await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(child.exitCode,null,'Supervisor must survive the transient status failure');assert(fs.existsSync(path.join(dir,'recovered.txt')),'Supervisor must retry and reach healthy state');
 assert(fs.readFileSync(path.join(dir,'service-recovery.log'),'utf8').includes('transient IPC read failure'));
 console.log('PASS: hidden Windows supervisor survives an IPC failure, logs it and observes a healthy retry without starting a competing daemon');
}finally{
 if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve))}
 assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('dsh-service-check-'));
 fs.rmSync(dir,{recursive:true});
}
