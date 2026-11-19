import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const invalid = Object.entries(lock.packages).filter(([, entry]) => {
  if (!entry.resolved) return false;
  try {
    const url = new URL(entry.resolved);
    return url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.username || url.password;
  } catch {
    return true;
  }
});

assert.equal(invalid.length, 0, `Lockfile contains non-public registry URLs in: ${invalid.map(([name]) => name).join(', ')}`);
console.log('All resolved dependencies use the public npm registry.');