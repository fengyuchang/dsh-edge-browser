import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plugin = 'packages/browser-skill-dsh-plugin';
for (const name of ['dsh-annotations.mjs', 'dsh-session-scope.mjs', 'dsh-task-finish.mjs']) {
  assert.equal(read(`${plugin}/lib/${name}`), read(`harness/${name}`));
}
const client = read(`${plugin}/lib/client.cjs`);
new vm.Script(client);
assert(client.includes(read('harness/dsh-annotation-client.js').trim()));
const embedded = read(`${plugin}/lib/index.mjs`).match(/^const BSK_SKILL_MARKDOWN = ("[^\n]*");/m);
const skill = read(`${plugin}/skill/SKILL.md`).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');
assert(embedded && JSON.parse(embedded[1]).trim() === skill.trim());
assert.equal(skill.trim(), read('harness/skill/SKILL.md').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '').trim());
const manifest = JSON.parse(read('extension/manifest.json'));
assert.equal(manifest.commands['dsh-annotate'].suggested_key, 'Alt+Shift+A');
assert(!manifest.permissions.includes('cookies'));
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/BrowserSkill-MIT.txt', 'licenses/dsh-doyourweb-MIT.txt']) assert(fs.existsSync(path.join(root, name)));
const page = read('docs/index.html');
for (const match of page.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const target = match[1];
  if (/^(https?:|data:)/.test(target)) continue;
  if (target.startsWith('#')) assert(page.includes(`id="${target.slice(1)}"`), `Missing page anchor: ${target}`);
  else assert(fs.existsSync(path.resolve(root, 'docs', target)), `Missing page asset: ${target}`);
}
assert(!page.includes('YOUR_GITHUB_USERNAME'), 'Fill the public project links before publishing.');
assert(read('docs/style.css').includes('prefers-reduced-motion'));

let files = 0;
function inspect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', '.cache', '验收记录'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    assert(!entry.isSymbolicLink(), `Unexpected link: ${file}`);
    if (entry.isDirectory()) { inspect(file); continue; }
    files++;
    if (!/\.(mjs|cjs|js|json|md|ps1|cmd|yml|html|css|svg|txt)$/.test(entry.name)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (file !== fileURLToPath(import.meta.url)) assert(!/C:[\\/]Users[\\/]15299|5a72db12|session-(?:66288e94|dce1c950)/i.test(content), `Personal deployment identifier in ${file}`);
    assert(!/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9]{24,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(content), `Credential-like content in ${file}`);
    if (entry.name.endsWith('.md')) {
      for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const target = match[1];
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        const local = path.resolve(path.dirname(file), target.split('#')[0]);
        assert(local.startsWith(root + path.sep) && fs.existsSync(local), `Broken local link in ${file}: ${target}`);
      }
    }
  }
}
inspect(root);
console.log(`PASS: ${files} public source files, helper/skill consistency, local documentation links, personal identifier and credential-pattern checks`);
