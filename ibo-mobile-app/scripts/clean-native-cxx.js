/**
 * Remove transient Android native build caches that crash Metro on Windows.
 * Only targets android/.cxx, android/build, android/.gradle under node_modules.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ANDROID_MARK = `${path.sep}android${path.sep}`;
const PRUNE_IN_ANDROID = new Set(['.cxx', 'build', '.gradle']);

function pruneAndroidBuildDirs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);

    if (full.includes(ANDROID_MARK) && PRUNE_IN_ANDROID.has(entry.name)) {
      try {
        fs.rmSync(full, { recursive: true, force: true });
        console.log('removed', full);
      } catch (err) {
        console.warn('skip', full, err.message);
      }
      continue;
    }

    pruneAndroidBuildDirs(full);
  }
}

pruneAndroidBuildDirs(path.join(ROOT, 'node_modules'));
const appCxx = path.join(ROOT, 'android', 'app', '.cxx');
if (fs.existsSync(appCxx)) {
  fs.rmSync(appCxx, { recursive: true, force: true });
  console.log('removed', appCxx);
}
console.log('Android native cache cleanup done.');
