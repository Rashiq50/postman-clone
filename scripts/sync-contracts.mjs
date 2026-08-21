import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'packages', 'contracts');
const pkgName = '@raven/contracts';
const consumers = ['backend', 'frontend'];

if (!existsSync(join(pkgDir, 'node_modules', '.bin', 'tsc'))) {
  console.log('==> installing contracts toolchain');
  execSync('yarn install --silent', { cwd: pkgDir, stdio: 'inherit' });
}

console.log(`==> building ${pkgName}`);
execSync('yarn --silent build', { cwd: pkgDir, stdio: 'inherit' });

if (!existsSync(join(pkgDir, 'dist', 'index.js'))) {
  console.error('[error] contracts build produced no dist/index.js');
  process.exit(1);
}

for (const app of consumers) {
  const dest = join(root, app, 'node_modules', pkgName);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(pkgDir, 'package.json'), join(dest, 'package.json'));
  cpSync(join(pkgDir, 'dist'), join(dest, 'dist'), { recursive: true });
  console.log(`    installed into ${app}/node_modules/${pkgName}`);
}

/**
 * Vite pre-bundles this package (its dist is CommonJS, so it cannot be served
 * to the browser as-is) and caches the result in node_modules/.vite. That
 * cache is keyed on package.json and the lockfile — neither of which changes
 * when contracts is rebuilt in place — so without this the dev server keeps
 * serving the *previous* build. The symptom is a runtime
 * "X is not a function" for a newly added export, while tsc, the editor and
 * `yarn build` all pass, because every one of those reads the .d.ts instead.
 *
 * Deleting the cache here rather than telling developers to `--force`: the
 * cache is invalid exactly when this script runs, and never otherwise.
 */
const viteCache = join(root, 'frontend', 'node_modules', '.vite');
if (existsSync(viteCache)) {
  rmSync(viteCache, { recursive: true, force: true });
  console.log('    cleared frontend Vite dep cache');
}
