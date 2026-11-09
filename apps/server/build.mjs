import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

for (const entry of ['index', 'migrate']) {
  await build({
    entryPoints: [`src/${entry}.ts`],
    outfile: `dist/${entry}.js`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
    alias: { '@khatm/shared': shared },
  });
}
