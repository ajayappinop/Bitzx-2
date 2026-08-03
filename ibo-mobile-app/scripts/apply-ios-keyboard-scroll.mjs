import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const scrollImport = "import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';";
const kavImport = "import AdaptiveKeyboardAvoidingView from '@/components/common/AdaptiveKeyboardAvoidingView';";

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files);
    else if (/\.(tsx|ts)$/.test(ent.name)) files.push(p);
  }
  return files;
}

let scrollCount = 0;
let kavCount = 0;

for (const file of walk(root)) {
  if (file.includes('iosKeyboardScroll.ts') || file.includes('AdaptiveKeyboardAvoidingView.tsx')) continue;
  let src = fs.readFileSync(file, 'utf8');
  let changed = false;

  if (src.includes('keyboardShouldPersistTaps="handled"')) {
    src = src.replace(/keyboardShouldPersistTaps="handled"/g, '{...iosManualKeyboardScrollProps()}');
    if (!src.includes('iosManualKeyboardScrollProps')) {
      const idx = src.lastIndexOf('\nimport ');
      const lineEnd = src.indexOf('\n', idx + 1);
      src = `${src.slice(0, lineEnd + 1)}${scrollImport}\n${src.slice(lineEnd + 1)}`;
    }
    changed = true;
    scrollCount += 1;
  }

  if (/\bKeyboardAvoidingView\b/.test(src) && !file.endsWith('AdaptiveKeyboardAvoidingView.tsx')) {
    src = src.replace(/\bKeyboardAvoidingView\b/g, 'AdaptiveKeyboardAvoidingView');
    src = src.replace(/,\s*AdaptiveKeyboardAvoidingView\s*,/g, ',');
    src = src.replace(/AdaptiveKeyboardAvoidingView,\s*/g, '');
    src = src.replace(/,\s*AdaptiveKeyboardAvoidingView/g, '');
    src = src.replace(/\{\s*AdaptiveKeyboardAvoidingView\s*\}/g, '{}');
    if (!src.includes("AdaptiveKeyboardAvoidingView from '@/components/common/AdaptiveKeyboardAvoidingView'")) {
      const idx = src.lastIndexOf('\nimport ');
      const lineEnd = src.indexOf('\n', idx + 1);
      src = `${src.slice(0, lineEnd + 1)}${kavImport}\n${src.slice(lineEnd + 1)}`;
    }
    changed = true;
    kavCount += 1;
  }

  if (changed) fs.writeFileSync(file, src, 'utf8');
}

console.log(`Updated scroll props in ${scrollCount} file(s), KAV in ${kavCount} file(s)`);
