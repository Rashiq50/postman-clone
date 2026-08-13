import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'packages', 'contracts');
const pkgName = '@postman-clone/contracts';
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
