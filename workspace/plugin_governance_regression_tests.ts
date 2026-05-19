import { PluginRegistry } from '../src/framework/core/PluginRegistry.ts';

async function testPluginRegistryIsIdempotent() {
  const registry = new PluginRegistry();
  const plugin = { name: 'DuplicateGuardPlugin', version: '1.0.0' };

  registry.register(plugin);
  registry.register(plugin);

  const matches = registry.listPlugins().filter(item => item.name === plugin.name);
  if (matches.length !== 1) {
    throw new Error(`Expected one plugin registration, got ${matches.length}`);
  }
}

const tests = [
  ['plugin registry is idempotent', testPluginRegistryIsIdempotent]
] as const;

const results = [];
for (const [name, run] of tests) {
  const start = Date.now();
  try {
    await run();
    results.push({ name, ok: true, ms: Date.now() - start });
  } catch (err: any) {
    results.push({ name, ok: false, error: err.message, ms: Date.now() - start });
  }
}

console.log(JSON.stringify(results, null, 2));
if (results.some(r => !r.ok)) process.exit(1);
