import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the offline Windows package on Windows x64. Source checks work on other platforms.');
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const bsk = path.resolve(option('--bsk') || process.env.BSK_PATH || 'bin/bsk.exe');
if (!fs.existsSync(bsk)) throw new Error('Pass --bsk with the installed BrowserSkill 0.3.3 executable.');
if (!/\b0\.3\.3\b/.test(execFileSync(bsk, ['--version'], { encoding: 'utf8', windowsHide: true }))) throw new Error('This release requires BrowserSkill CLI 0.3.3.');
const output = path.resolve(source, option('--out') || 'dist/windows-x64');
if (output === source || source.startsWith(output + path.sep) || fs.existsSync(output)) throw new Error('Use a new output directory, outside the source root itself. Existing releases are never overwritten.');
fs.mkdirSync(output, { recursive: true });
function copy(from, to) {
  const entry = fs.lstatSync(from);
  if (entry.isSymbolicLink()) throw new Error('Unexpected link in package contents: ' + from);
  if (entry.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      if (['node_modules', '.git', '.npmrc', '.yarnrc', '.DS_Store'].includes(name) || name.startsWith('.env')) continue;
      copy(path.join(from, name), path.join(to, name));
    }
  } else { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
}
for (const name of ['extension', 'extension-official', 'harness', 'provenance.json', 'verify.mjs', 'annotation-check.mjs', 'annotation-client-check.mjs', 'annotation-ui-check.mjs', 'annotation-scope-live-check.mjs']) copy(path.join(source, name), path.join(output, name));
copy(bsk, path.join(output, 'bin/bsk.exe'));
copy(process.execPath, path.join(output, 'runtime/node.exe'));
copy(path.join(source, 'licenses'), path.join(output, 'LICENSES'));
for (const name of fs.readdirSync(path.join(source, 'migration'))) {
  const from = path.join(source, 'migration', name);
  let text = fs.readFileSync(from, 'utf8').replace(/^\ufeff/, '');
  if (name.endsWith('.ps1')) text = '\ufeff' + text.replace(/\r?\n/g, '\r\n');
  if (name.endsWith('.cmd')) text = text.replace(/\r?\n/g, '\r\n');
  fs.writeFileSync(path.join(output, name), text);
}

const provenance = JSON.parse(fs.readFileSync(path.join(source, 'provenance.json')));
const cache = path.join(source, '.cache/BrowserSkill-official-0.3.3.zip');
fs.mkdirSync(path.dirname(cache), { recursive: true });
if (!fs.existsSync(cache)) {
  const response = await fetch(provenance.archiveUrl, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('Upstream download failed: ' + response.status);
  fs.writeFileSync(cache, Buffer.from(await response.arrayBuffer()));
}
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (digest(cache) !== provenance.archiveSha256) throw new Error('Upstream archive checksum mismatch.');
copy(cache, path.join(output, 'BrowserSkill-official-0.3.3.zip'));

function locate(name, from) {
  const req = createRequire(path.join(from, 'package.json'));
  for (const base of req.resolve.paths(name) ?? []) {
    const candidate = path.join(base, name, 'package.json');
    if (fs.existsSync(candidate)) return fs.realpathSync(path.dirname(candidate));
  }
}
const modules = path.join(output, 'offline/node_modules');
const roots = Object.keys(JSON.parse(fs.readFileSync(path.join(source, 'package.json'))).dependencies);
const primary = new Map(), queue = [], inventory = [], installed = new Set();
function install(name, from, destination, ancestors) {
  if (inventory.length >= 1500) throw new Error('Dependency copy limit exceeded.');
  installed.add(destination);
  const meta = JSON.parse(fs.readFileSync(path.join(from, 'package.json')));
  copy(from, destination);
  inventory.push({ name, version: meta.version, license: meta.license, path: path.relative(output, destination).replaceAll('\\', '/') });
  queue.push({ from, destination, meta, ancestors: new Map([...ancestors, [name, from]]) });
}
for (const name of roots) {
  const from = locate(name, source);
  if (!from) throw new Error('Run npm ci first. Missing dependency: ' + name);
  primary.set(name, from); install(name, from, path.join(modules, name), new Map());
}
while (queue.length) {
  const item = queue.shift();
  for (const name of Object.keys({ ...item.meta.dependencies, ...item.meta.optionalDependencies, ...item.meta.peerDependencies })) {
    const from = locate(name, item.from);
    const optional = name in (item.meta.optionalDependencies ?? {}) || item.meta.peerDependenciesMeta?.[name]?.optional;
    if (!from) { if (optional) continue; throw new Error(`Missing dependency ${item.meta.name} -> ${name}`); }
    if (!primary.has(name)) { primary.set(name, from); install(name, from, path.join(modules, name), new Map()); }
    if (item.ancestors.get(name) === from || primary.get(name) === from) continue;
    const destination = path.join(item.destination, 'node_modules', name);
    if (!installed.has(destination)) install(name, from, destination, item.ancestors);
  }
}
fs.writeFileSync(path.join(output, 'dependency-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
const files = [];
function hashTree(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) hashTree(file);
    else files.push({ path: path.relative(output, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size, sha256: digest(file) });
  }
}
hashTree(output); files.sort((a, b) => a.path.localeCompare(b.path));
fs.writeFileSync(path.join(output, 'SHA256.json'), JSON.stringify({ createdAt: new Date().toISOString(), platform: 'win32-x64', files }, null, 2));
execFileSync(process.execPath, [path.join(output, 'Verify-Package.mjs')], { stdio: 'inherit', windowsHide: true });
const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
const releaseDir = path.dirname(output);
for (const [from, name] of [[output, 'dsh-edge-browser-windows-x64.zip'], [path.join(source, 'extension'), 'dsh-edge-browser-extension.zip']]) {
  const zip = path.join(releaseDir, name);
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${psQuote(from)}, ${psQuote(zip)})`], { stdio: 'inherit', windowsHide: true });
  fs.writeFileSync(zip + '.sha256', `${digest(zip)}  ${name}\n`);
}
console.log(JSON.stringify({ output, runtimeDependencies: inventory.length, files: files.length, node: process.version }));
