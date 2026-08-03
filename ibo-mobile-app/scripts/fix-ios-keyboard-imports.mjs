import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const imp = "import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';";

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

let n = 0;
for (const file of walk(root)) {
  if (file.includes('iosKeyboardScroll.ts')) continue;
  let src = fs.readFileSync(file, 'utf8');
  if (!src.includes('iosManualKeyboardScrollProps')) continue;
  if (src.includes("from '@/utils/iosKeyboardScroll'") || src.includes('from "../../utils/iosKeyboardScroll"')) continue;
  const idx = src.lastIndexOf('\nimport ');
  const lineEnd = src.indexOf('\n', idx + 1);
  src = `${src.slice(0, lineEnd + 1)}${imp}\n${src.slice(lineEnd + 1)}`;
  fs.writeFileSync(file, src, 'utf8');
  n += 1;
  console.log(path.relative(root, file));
}
console.log(`added imports: ${n}`);
