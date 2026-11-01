import fs from 'node:fs';
import path from 'node:path';
const [from, to] = process.argv.slice(2).map(value => path.resolve(value));
if (to === from || to.toLowerCase().startsWith(from.toLowerCase() + path.sep)) throw new Error('Install destination must be outside the extracted package');
function copy(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const input = path.join(source, entry.name), output = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Unexpected link inside payload');
    if (entry.isDirectory()) copy(input, output);
    else fs.copyFileSync(input, output, fs.constants.COPYFILE_EXCL);
  }
}
copy(from, to);
