const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro on Windows crashes when Gradle/CMake deletes native scratch dirs under
 * node_modules while FallbackWatcher still tries to watch them (ENOENT).
 *
 * Do NOT use exclusionList() — it anchors patterns with `$` (end-of-path only),
 * so deep paths like `android/.cxx/Debug/.../cmTC_1b58c.dir` slip through.
 */
const config = {
  resolver: {
    blockList:
      /[/\\]\.cxx(?:[/\\]|$)|[/\\]android[/\\]build(?:[/\\]|$)|[/\\]android[/\\]\.gradle(?:[/\\]|$)|[/\\]__tests__[/\\]/,
  },
  watcher: {
    healthCheck: {
      enabled: true,
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
