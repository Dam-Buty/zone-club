import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.sql',
]);

export function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

export function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

export function walkFiles(rootDir, allowedExts = TEXT_EXTENSIONS) {
  const files = [];

  function walk(current) {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }

      const ext = path.extname(entry.name);
      if (allowedExts.has(ext)) {
        files.push(absolute);
      }
    }
  }

  if (existsSync(rootDir) && statSync(rootDir).isDirectory()) {
    walk(rootDir);
  }

  return files;
}

export function lineCount(filePath) {
  const text = readText(filePath);
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length;
}
