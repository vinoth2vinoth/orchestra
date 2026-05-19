import '../src/framework/tools/ExternalTools.ts';
import { globalToolRegistry } from '../src/framework/tools/ToolRegistry.ts';
import { globalIAMInterceptor } from '../src/framework/security/IAMInterceptor.ts';

globalIAMInterceptor.registerPolicy({
  tenantId: 'GLOBAL',
  allowedTools: ['fetchUrl', 'httpRequest', 'executeCodeSandbox'],
  requiredSecrets: {}
});

async function testMockModeIsExplicit() {
  process.env.ORCHESTRA_TOOL_FETCHURL_MODE = 'mock';
  const result = await globalToolRegistry.getAllTools().fetchUrl.execute({ url: 'https://example.com' });
  if (!String(result).startsWith('[MOCK Content')) {
    throw new Error(`Expected explicit mock fetch result, got ${result}`);
  }
}

async function testDisabledModeBlocksTool() {
  process.env.ORCHESTRA_TOOL_HTTPREQUEST_MODE = 'disabled';
  try {
    await globalToolRegistry.getAllTools().httpRequest.execute({ method: 'GET', url: 'https://example.com' });
  } catch (err: any) {
    if (!err.message.includes('disabled')) throw err;
    return;
  } finally {
    delete process.env.ORCHESTRA_TOOL_HTTPREQUEST_MODE;
  }
  throw new Error('Expected disabled httpRequest tool to throw.');
}

async function testLiveModeStillBlocksLocalUrls() {
  process.env.ORCHESTRA_TOOL_HTTPREQUEST_MODE = 'live';
  try {
    await globalToolRegistry.getAllTools().httpRequest.execute({ method: 'GET', url: 'http://127.0.0.1:3000' });
  } catch (err: any) {
    if (!err.message.includes('internal/locally-hosted')) throw err;
    return;
  } finally {
    delete process.env.ORCHESTRA_TOOL_HTTPREQUEST_MODE;
  }
  throw new Error('Expected live httpRequest to block local URL.');
}

async function testCodeSandboxDisabledByDefault() {
  delete process.env.ORCHESTRA_ENABLE_CODE_SANDBOX;
  try {
    await globalToolRegistry.getAllTools().executeCodeSandbox.execute({ language: 'javascript', code: '1 + 1' });
  } catch (err: any) {
    if (!err.message.includes('disabled by default')) throw err;
    return;
  }
  throw new Error('Expected executeCodeSandbox to be disabled by default.');
}

const tests = [
  ['mock mode is explicit', testMockModeIsExplicit],
  ['disabled mode blocks tool', testDisabledModeBlocksTool],
  ['live mode blocks local URLs', testLiveModeStillBlocksLocalUrls],
  ['code sandbox disabled by default', testCodeSandboxDisabledByDefault]
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
