import { PluginRegistry } from '../src/framework/core/PluginRegistry.ts';
import { globalPluginRegistry } from '../src/framework/core/PluginRegistry.ts';
import { registerEnterpriseFeatures } from '../src/framework/plugins/EnterpriseFeatures.ts';

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

async function testStubGroundednessIsNotDefault() {
  delete process.env.ORCHESTRA_ENABLE_STUB_GROUNDEDNESS;

  registerEnterpriseFeatures();

  const names = globalPluginRegistry.listPlugins().map(plugin => plugin.name);
  if (names.includes('GroundednessEvaluatorPlugin')) {
    throw new Error('GroundednessEvaluatorPlugin is a stub and must not be registered by default.');
  }
}

const tests = [
  ['plugin registry is idempotent', testPluginRegistryIsIdempotent],
  ['stub groundedness is not default', testStubGroundednessIsNotDefault]
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
