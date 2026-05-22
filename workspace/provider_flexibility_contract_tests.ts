import { ProviderRegistry, type LLMConfig, type ProviderType } from '../src/framework/index.ts';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

type FetchCall = {
  url: string;
  init: RequestInit;
};

function installFetchMock(handler: (url: string, init: RequestInit) => any) {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const request = init || {};
    calls.push({ url, init: request });
    return handler(url, request);
  }) as typeof fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

function jsonResponse(body: any, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}

async function testExplicitProviderBypassesKeyGuessing() {
  const cases: Array<[ProviderType, LLMConfig]> = [
    ['openai', { provider: 'openai', apiKey: 'local-key', modelName: 'local-openai-model' }],
    ['anthropic', { provider: 'anthropic', apiKey: 'local-key', modelName: 'local-claude-model' }],
    ['gemini', { provider: 'gemini', apiKey: 'local-key', modelName: 'local-gemini-model' }],
    ['deepseek', { provider: 'deepseek', apiKey: 'local-key', modelName: 'local-deepseek-model' }]
  ];

  for (const [expected, config] of cases) {
    const actual = ProviderRegistry.detectProvider(config.apiKey, config.modelName, config.baseURL, config.provider);
    assert(actual === expected, `Expected explicit provider ${expected}, got ${actual}`);
  }
}

async function testOpenAiCompatibleNativeRestContract() {
  const mock = installFetchMock((_url, init) => {
    const payload = JSON.parse(String(init.body));
    assert(payload.model === 'local-model', `Expected model local-model, got ${payload.model}`);
    assert(payload.messages[0].role === 'system', 'Expected system prompt to be mapped into OpenAI-compatible messages');
    assert(payload.messages[1].content === 'hello', 'Expected user message to be preserved');
    return jsonResponse({
      choices: [{ message: { content: 'local provider response' } }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }
    });
  });

  try {
    const result = await ProviderRegistry.generateNativeREST({
      provider: 'openai',
      apiKey: 'local-key',
      baseURL: 'http://local-openai-compatible.test/v1',
      modelName: 'local-model',
      useNativeREST: true
    }, 'system rules', [{ role: 'user', content: 'hello' }]);

    assert(mock.calls[0].url === 'http://local-openai-compatible.test/v1/chat/completions', `Unexpected URL ${mock.calls[0].url}`);
    assert((mock.calls[0].init.headers as Record<string, string>).Authorization === 'Bearer local-key', 'Expected bearer auth header');
    assert(result.text === 'local provider response', `Unexpected text ${result.text}`);
    assert(result.usage.totalTokens === 10, 'Expected usage to round-trip');
  } finally {
    mock.restore();
  }
}

async function testGeminiNativeRestContract() {
  const mock = installFetchMock((url, init) => {
    const payload = JSON.parse(String(init.body));
    assert(url.includes('/models/gemini-local:generateContent?key=gemini-key'), `Unexpected Gemini URL ${url}`);
    assert(payload.system_instruction.parts[0].text === 'system rules', 'Expected Gemini system instruction');
    assert(payload.contents[0].parts[0].text === 'hello', 'Expected Gemini user content');
    return jsonResponse({
      candidates: [{ content: { parts: [{ text: 'gemini provider response' }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 4, totalTokenCount: 9 }
    });
  });

  try {
    const result = await ProviderRegistry.generateNativeREST({
      provider: 'gemini',
      apiKey: 'gemini-key',
      modelName: 'gemini-local',
      useNativeREST: true
    }, 'system rules', [{ role: 'user', content: 'hello' }]);

    assert(result.text === 'gemini provider response', `Unexpected Gemini text ${result.text}`);
    assert(result.usage.totalTokens === 9, 'Expected Gemini usage metadata to normalize');
  } finally {
    mock.restore();
  }
}

async function testFallbackProviderAfterNativeRestFailure() {
  let calls = 0;
  const mock = installFetchMock((_url, _init) => {
    calls++;
    if (calls === 1) {
      return jsonResponse({ error: 'primary down' }, false, 503);
    }
    return jsonResponse({
      choices: [{ message: { content: 'fallback provider response' } }],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }
    });
  });

  try {
    const result = await ProviderRegistry.generate({
      provider: 'openai',
      apiKey: 'primary-key',
      baseURL: 'http://primary-compatible.test/v1',
      modelName: 'primary-model',
      useNativeREST: true,
      disableSummarization: true,
      fallbackConfig: {
        provider: 'openai',
        apiKey: 'fallback-key',
        baseURL: 'http://fallback-compatible.test/v1',
        modelName: 'fallback-model',
        useNativeREST: true,
        disableSummarization: true
      }
    }, 'system rules', [{ role: 'user', content: 'hello' }]);

    assert(calls === 2, `Expected primary plus fallback calls, got ${calls}`);
    assert(mock.calls[1].url === 'http://fallback-compatible.test/v1/chat/completions', `Expected fallback URL, got ${mock.calls[1].url}`);
    assert(result.text === 'fallback provider response', `Unexpected fallback text ${result.text}`);
  } finally {
    mock.restore();
  }
}

async function testStreamNativeRestFailureDoesNotReturnSimulation() {
  const mock = installFetchMock(() => {
    return jsonResponse({ error: 'quota exceeded' }, false, 429);
  });

  try {
    try {
      await ProviderRegistry.generateStream({
        provider: 'openai',
        apiKey: 'primary-key',
        baseURL: 'http://primary-compatible.test/v1',
        modelName: 'primary-model',
        useNativeREST: true,
        disableSummarization: true
      }, 'system rules', [{ role: 'user', content: 'hello' }]);
    } catch (err: any) {
      assert(!String(err.message).includes('HYBRID_SIMULATION'), `Provider failure returned simulation text: ${err.message}`);
      assert(String(err.message).includes('429'), `Expected clear provider failure, got ${err.message}`);
      return;
    }
    throw new Error('Expected streaming provider failure to throw without simulation fallback.');
  } finally {
    mock.restore();
  }
}

async function testStreamNativeRestUsesRealFallback() {
  let calls = 0;
  const mock = installFetchMock(() => {
    calls++;
    if (calls === 1) {
      return jsonResponse({ error: 'quota exceeded' }, false, 429);
    }
    return jsonResponse({
      choices: [{ message: { content: 'fallback stream response' } }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
    });
  });

  try {
    const stream = await ProviderRegistry.generateStream({
      provider: 'openai',
      apiKey: 'primary-key',
      baseURL: 'http://primary-compatible.test/v1',
      modelName: 'primary-model',
      useNativeREST: true,
      disableSummarization: true,
      fallbackConfig: {
        provider: 'openai',
        apiKey: 'fallback-key',
        baseURL: 'http://fallback-compatible.test/v1',
        modelName: 'fallback-model',
        useNativeREST: true,
        disableSummarization: true
      }
    }, 'system rules', [{ role: 'user', content: 'hello' }]);

    assert(calls === 2, `Expected primary plus fallback stream calls, got ${calls}`);
    assert(mock.calls[1].url === 'http://fallback-compatible.test/v1/chat/completions', `Expected fallback stream URL, got ${mock.calls[1].url}`);
    assert(await stream.text === 'fallback stream response', 'Expected real fallback stream text');
  } finally {
    mock.restore();
  }
}

const tests = [
  ['explicit provider bypasses key guessing', testExplicitProviderBypassesKeyGuessing],
  ['OpenAI-compatible native REST contract', testOpenAiCompatibleNativeRestContract],
  ['Gemini native REST contract', testGeminiNativeRestContract],
  ['fallback provider after native REST failure', testFallbackProviderAfterNativeRestFailure],
  ['stream native REST failure does not return simulation', testStreamNativeRestFailureDoesNotReturnSimulation],
  ['stream native REST uses real fallback', testStreamNativeRestUsesRealFallback]
] as const;

const results: Array<{ name: string; ok: boolean; ms: number; error?: string; stack?: string }> = [];
for (const [name, run] of tests) {
  const start = Date.now();
  try {
    await run();
    results.push({ name, ok: true, ms: Date.now() - start });
  } catch (err: any) {
    results.push({ name, ok: false, error: err.message, stack: err.stack, ms: Date.now() - start });
  }
}

console.log(JSON.stringify(results, null, 2));
process.exit(results.some(result => !result.ok) ? 1 : 0);
