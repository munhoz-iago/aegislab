import { existsSync, lstatSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const packageDir = realpathSync(process.cwd());
const relative = packageDir.slice(workspace.length + 1).replaceAll('\\', '/');
const allowed = new Set(['apps/demo-target', 'apps/worker', 'packages/scanners']);
if (!packageDir.startsWith(`${workspace}${sep}`) || !allowed.has(relative)) {
  throw new Error('Refusing to clean outside a known AegisLab package');
}

const target = join(packageDir, 'dist');
if (basename(target) !== 'dist' || dirname(target) !== packageDir) {
  throw new Error('Refusing an unexpected build path');
}
if (existsSync(target)) {
  if (lstatSync(target).isSymbolicLink() || !realpathSync(target).startsWith(`${packageDir}${sep}`)) {
    throw new Error('Refusing to clean a linked or external build path');
  }
  rmSync(target, { recursive: true, force: true });
}
