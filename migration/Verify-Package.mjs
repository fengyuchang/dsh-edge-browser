import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'SHA256.json')));
for (const item of manifest.files) {
  const file = path.resolve(root, item.path);
  if (!file.startsWith(root + path.sep)) throw new Error('Invalid manifest path');
  const sha = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (sha !== item.sha256) throw new Error('Checksum mismatch: ' + item.path);
}
await import(pathToFileURL(path.join(root, 'offline/node_modules/@wxg-prc-cpg/browser-skill-dsh-plugin/lib/index.mjs')));
const nativeRoot = path.join(root, 'offline/node_modules/@wxg-prc-cpg/browser-skill-dsh-plugin');
const embeddedSkill = fs.readFileSync(path.join(nativeRoot, 'lib/index.mjs'), 'utf8').match(/^const BSK_SKILL_MARKDOWN = ("[^\n]*");/m);
const sourceSkill = fs.readFileSync(path.join(nativeRoot, 'skill/SKILL.md'), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');
if (!embeddedSkill || JSON.parse(embeddedSkill[1]).trim() !== sourceSkill.trim()) throw new Error('Embedded browser skill differs from its Markdown source');
const clientSource = fs.readFileSync(path.join(nativeRoot, 'lib/client.cjs'), 'utf8');
new vm.Script(clientSource);
if (!clientSource.includes(fs.readFileSync(path.join(root, 'harness/dsh-annotation-client.js'), 'utf8').trim())) throw new Error('Native client differs from the selected-chat bridge source');
for (const name of ['dsh-annotations.mjs', 'dsh-session-scope.mjs']) if (fs.readFileSync(path.join(nativeRoot, 'lib', name), 'utf8') !== fs.readFileSync(path.join(root, 'harness', name), 'utf8')) throw new Error('Native helper differs from source: ' + name);
execFileSync(path.join(root, 'bin/bsk.exe'), ['--version'], { windowsHide: true });
await import(pathToFileURL(path.join(root, 'verify.mjs')));
await import(pathToFileURL(path.join(root, 'annotation-check.mjs')));
await import(pathToFileURL(path.join(root, 'annotation-client-check.mjs')));
await import(pathToFileURL(path.join(root, 'notice-check.mjs')));
console.log(`PASS: ${manifest.files.length} files, offline plugin imports, bundled CLI and extension checks`);
