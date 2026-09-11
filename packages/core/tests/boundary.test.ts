import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const corePackage = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8'));
const opencodePackage = JSON.parse(
  readFileSync(join(root, 'packages/opencode/package.json'), 'utf8'),
);

test('core does not depend on or import the OpenCode adapter', async () => {
  expect(
    JSON.stringify({
      dependencies: corePackage.dependencies,
      devDependencies: corePackage.devDependencies,
    }),
  ).not.toMatch(/@opencode-ai\//);
  let source = '';
  for await (const file of new Bun.Glob('**/*.ts').scan({
    cwd: join(root, 'packages/core/src'),
    absolute: true,
  }))
    source += readFileSync(file, 'utf8');
  expect(source).not.toMatch(/@opencode-ai|packages\/opencode|plugin/);
});

test('OpenCode package depends on Core', () => {
  expect(opencodePackage.dependencies['@aifcoding/memory-core']).toBeDefined();
});
