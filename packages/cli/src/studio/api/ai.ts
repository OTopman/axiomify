import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StudioDiscoveryResult } from '../discovery/types';
import { readBody, sendJson } from '../server/http-server';
import { getContractResults } from './contracts';
import { getRouteLatenciesMap } from './perf';
import { getSessionData } from './recorder';
import { getSecurityFindings } from './security';

/**
 * Recursively redacts sensitive keys and values from objects before sending to AI.
 */
export function redactPII(val: any, depth = 0): any {
  if (depth > 10) return '[NESTED_MAX]';
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    // Check if it looks like a long token or auth string
    if (val.length > 50 && !val.includes(' ') && !val.includes('\n')) {
      return '[REDACTED_TOKEN]';
    }
    // Check for email format
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      return '[REDACTED_EMAIL]';
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => redactPII(item, depth + 1));
  }
  if (typeof val === 'object') {
    const redacted: Record<string, any> = {};
    const sensitiveKeys =
      /password|token|secret|key|auth|cookie|card|cvv|ssn|email|phone|jwt|credential/i;
    for (const [k, v] of Object.entries(val)) {
      if (sensitiveKeys.test(k)) {
        redacted[k] = '[REDACTED]';
      } else {
        redacted[k] = redactPII(v, depth + 1);
      }
    }
    return redacted;
  }
  return val;
}

/**
 * Redacts sensitive headers.
 */
export function redactHeaders(
  headers: Record<string, any>,
): Record<string, string> {
  const redacted: Record<string, string> = {};
  const sensitiveHeaders =
    /authorization|cookie|set-cookie|x-api-key|api-key|token|x-auth/i;
  for (const [k, v] of Object.entries(headers || {})) {
    if (sensitiveHeaders.test(k)) {
      redacted[k] = '[REDACTED]';
    } else {
      redacted[k] = String(v);
    }
  }
  return redacted;
}

/**
 * Builds the redacted telemetry context bundle for the AI.
 */
export function buildContext(
  discovery: StudioDiscoveryResult,
  sessionSnapshot: any,
  routeLatencies: any,
  securityFindings: any[],
  contractResults: any[],
): any {
  // Load active application package.json details
  let packageMetadata: any = {};
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      packageMetadata = {
        name: pkg.name,
        version: pkg.version,
        dependencies: pkg.dependencies ? Object.keys(pkg.dependencies) : [],
        devDependencies: pkg.devDependencies
          ? Object.keys(pkg.devDependencies)
          : [],
      };
    }
  } catch {
    // Ignore error if package.json does not exist or fails to parse
  }

  const routesSummary = (discovery.routes || []).map((r) => ({
    method: r.method,
    path: r.path,
    isWs: !!r.isWs,
    plugins: r.plugins || [],
    hasValidation: r.validation && r.validation.length > 0,
    hasResponseSchema: !!r.hasResponseSchema,
  }));

  const servicesSummary = (discovery.services || []).map((s) => ({
    token: s.token,
    type: s.type,
    methods: s.methods || [],
  }));

  const eventsSummary = (discovery.events || []).map((e) => ({
    emitterToken: e.emitterToken,
    event: e.event,
    listenerCount: e.listenerCount,
  }));

  const configSummary = discovery.config || {};

  const perfSummary = Array.from(routeLatencies.values() || []).map(
    (b: any) => ({
      method: b.method,
      route: b.route,
      count: b.count,
      p50: b.p50,
      p95: b.p95,
      p99: b.p99,
      avg: b.avg,
    }),
  );

  const securitySummary = (securityFindings || []).map((f) => ({
    id: f.id,
    severity: f.severity,
    category: f.category,
    route: f.route,
    method: f.method,
    title: f.title,
    description: f.description,
    remediation: f.remediation,
  }));

  const contractsSummary = (contractResults || []).map((c) => ({
    route: c.route,
    method: c.method,
    status: c.status,
    passed: c.passed,
    violations: c.violations || [],
  }));

  const recentEntries = (sessionSnapshot.entries || [])
    .slice(0, 15)
    .map((e: any) => {
      const req = e.request || {};
      const res = e.response || {};
      return {
        requestId: e.requestId,
        request: {
          method: req.method,
          path: req.path,
          headers: redactHeaders(req.headers || {}),
          query: redactPII(req.query || {}),
          body: redactPII(req.body),
          timestamp: req.timestamp,
        },
        response: res
          ? {
              status: res.status,
              headers: redactHeaders(res.headers || {}),
              body: redactPII(res.body),
              durationMs: res.durationMs,
            }
          : undefined,
        errors: (e.errors || []).map((err: any) => ({
          name: err.name,
          message: err.message,
          stack: err.stack ? err.stack.split('\n').slice(0, 3).join('\n') : '',
        })),
        queries: (e.queries || []).map((q: any) => ({
          query: q.query,
          durationMs: q.durationMs,
          failed: !!q.failed,
        })),
      };
    });

  return {
    package: packageMetadata,
    routes: routesSummary,
    services: servicesSummary,
    events: eventsSummary,
    config: configSummary,
    performance: perfSummary,
    security: securitySummary,
    contracts: contractsSummary,
    recentTraffic: recentEntries,
  };
}

/**
 * Returns configuration status of the AI module.
 */
export function handleGetAiStatus(
  req: IncomingMessage,
  res: ServerResponse,
  discovery: StudioDiscoveryResult,
): void {
  const provider =
    (process.env.AXIOMIFY_AI_PROVIDER || '').toLowerCase() || 'gemini';

  const hasEnvKey = !!(
    process.env.AXIOMIFY_AI_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.DASHSCOPE_API_KEY
  );

  const providerConfigured = {
    gemini: !!(process.env.AXIOMIFY_AI_KEY || process.env.GEMINI_API_KEY),
    openai: !!(process.env.AXIOMIFY_AI_KEY || process.env.OPENAI_API_KEY),
    claude: !!(process.env.AXIOMIFY_AI_KEY || process.env.ANTHROPIC_API_KEY),
    qwen: !!(process.env.AXIOMIFY_AI_KEY || process.env.DASHSCOPE_API_KEY),
  };

  sendJson(res, {
    provider,
    hasEnvKey,
    providerConfigured,
  });
}

/**
 * Handless streaming AI analysis.
 */
export async function handlePostAiAnalyze(
  req: IncomingMessage,
  res: ServerResponse,
  discovery: StudioDiscoveryResult,
): Promise<void> {
  const rawBody = await readBody(req);
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    sendJson(res, { error: 'Invalid JSON payload' }, 400);
    return;
  }

  const { prompt } = payload;
  if (!prompt) {
    sendJson(res, { error: 'Missing prompt in request body' }, 400);
    return;
  }

  // Security (M1): these per-request overrides let the developer use a key
  // configured in the Studio panel instead of a server env var. This endpoint
  // is gated by the Studio bearer token AND the loopback Host-header check
  // (see http-server.ts), so a cross-origin page cannot invoke it to redirect
  // this app's telemetry to an attacker-controlled provider account. The
  // destination URL is always a fixed per-provider constant below.
  const customKey = req.headers['x-axiomify-ai-key'] as string;
  const customProvider = req.headers['x-axiomify-ai-provider'] as string;

  const provider =
    (customProvider || process.env.AXIOMIFY_AI_PROVIDER || '').toLowerCase() ||
    'gemini';
  let apiKey = '';

  if (customKey) {
    apiKey = customKey;
  } else {
    if (provider === 'gemini') {
      apiKey = process.env.AXIOMIFY_AI_KEY || process.env.GEMINI_API_KEY || '';
    } else if (provider === 'openai') {
      apiKey = process.env.AXIOMIFY_AI_KEY || process.env.OPENAI_API_KEY || '';
    } else if (provider === 'claude') {
      apiKey =
        process.env.AXIOMIFY_AI_KEY || process.env.ANTHROPIC_API_KEY || '';
    } else if (provider === 'qwen') {
      apiKey =
        process.env.AXIOMIFY_AI_KEY || process.env.DASHSCOPE_API_KEY || '';
    }
  }

  if (!apiKey) {
    sendJson(
      res,
      {
        error: `API key for provider "${provider}" is missing. Please configure it via environment variables or supply it in the panel settings.`,
      },
      400,
    );
    return;
  }

  const telemetryContext = buildContext(
    discovery,
    getSessionData(),
    getRouteLatenciesMap(),
    getSecurityFindings(),
    getContractResults(),
  );

  const systemInstruction = `You are the Axiomify AI Assistant, integrated directly into the developer console for Axiomify.
Axiomify is a high-performance web framework for Node.js featuring Radix routing, Zod-native validation, and middleware plugins.

Below is the structured real-time telemetry and configuration of the active application.

### Telemetry Context:
${JSON.stringify(telemetryContext, null, 2)}

Instructions:
1. Answer the developer's question/request directly based on the provided Telemetry Context.
2. Be highly technical, concise, and actionable. Avoid generic marketing fluff.
3. Recommend specific changes to schemas, route handlers, plugins, or configurations when diagnosing issues.
4. Format your response clearly in clean Markdown. Use code blocks, lists, and bold text for readability.
5. All PII and credentials have been redacted on the server before transmitting. Do not mention the redactions unless directly asked about security masking.`;

  let fetchUrl = '';
  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  let fetchBody: any = {};

  if (provider === 'gemini') {
    fetchUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`;
    fetchBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: systemInstruction }, { text: prompt }],
        },
      ],
    };
  } else if (provider === 'openai') {
    fetchUrl = 'https://api.openai.com/v1/chat/completions';
    fetchHeaders['Authorization'] = `Bearer ${apiKey}`;
    fetchBody = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
      stream: true,
    };
  } else if (provider === 'claude') {
    fetchUrl = 'https://api.anthropic.com/v1/messages';
    fetchHeaders['x-api-key'] = apiKey;
    fetchHeaders['anthropic-version'] = '2023-06-01';
    fetchBody = {
      model: 'claude-3-5-sonnet-20241022',
      system: systemInstruction,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      max_tokens: 4000,
    };
  } else if (provider === 'qwen') {
    fetchUrl =
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    fetchHeaders['Authorization'] = `Bearer ${apiKey}`;
    fetchBody = {
      model: 'qwen-turbo',
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
      stream: true,
    };
  } else {
    sendJson(res, { error: `Unsupported AI provider: ${provider}` }, 400);
    return;
  }

  try {
    const aiResponse = await fetch(fetchUrl, {
      method: 'POST',
      headers: fetchHeaders,
      body: JSON.stringify(fetchBody),
    });

    if (!aiResponse.ok) {
      const errMsg = await aiResponse.text();
      sendJson(
        res,
        {
          error: `AI Provider returned status ${aiResponse.status}`,
          details: errMsg,
        },
        aiResponse.status,
      );
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const reader = aiResponse.body;
    if (!reader) {
      res.write(
        `data: ${JSON.stringify({ error: 'Response body is empty' })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    for await (const chunk of reader as any) {
      buffer += decoder.decode(chunk, { stream: true });
      let lineEndIdx;
      while ((lineEndIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.substring(0, lineEndIdx).trim();
        buffer = buffer.substring(lineEndIdx + 1);

        if (line.startsWith('data: ')) {
          const dataStr = line.substring(6);
          if (dataStr === '[DONE]') {
            continue;
          }
          try {
            const parsed = JSON.parse(dataStr);
            let text = '';
            if (provider === 'gemini') {
              text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
            } else if (provider === 'openai' || provider === 'qwen') {
              text = parsed.choices?.[0]?.delta?.content || '';
            } else if (provider === 'claude') {
              text = parsed.delta?.text || '';
            }
            if (text) {
              res.write(`data: ${JSON.stringify({ text })}\n\n`);
            }
          } catch {
            // Ignore partial/control lines JSON parsing issues
          }
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: any) {
    if (!res.headersSent) {
      sendJson(
        res,
        { error: 'Failed to request AI analysis', details: String(err) },
        500,
      );
    } else {
      res.write(
        `data: ${JSON.stringify({ error: 'Stream error during AI generation', details: String(err) })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}

export async function handlePostAiConfig(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { promises: fsPromises, existsSync } = await import('node:fs');
  const path = await import('node:path');

  const rawBody = await readBody(req);
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    sendJson(res, { error: 'Invalid JSON payload' }, 400);
    return;
  }

  const { provider, apiKey } = payload;
  if (!provider || !apiKey) {
    sendJson(res, { error: 'Missing provider or apiKey' }, 400);
    return;
  }

  // Security (M2, CWE-74/CWE-73): these values are written verbatim into the
  // project `.env`. Reject anything that could break out of a single
  // `KEY=value` line (newlines/carriage returns) or otherwise inject config.
  // The provider must be one of the known identifiers; the API key must be a
  // single-line token with no `=`, quotes, whitespace, or control characters.
  const ALLOWED_PROVIDERS = ['gemini', 'openai', 'claude', 'qwen'];
  if (
    typeof provider !== 'string' ||
    !ALLOWED_PROVIDERS.includes(provider.toLowerCase())
  ) {
    sendJson(res, { error: 'Invalid provider' }, 400);
    return;
  }
  if (typeof apiKey !== 'string' || !/^[A-Za-z0-9._\-]{1,512}$/.test(apiKey)) {
    sendJson(
      res,
      {
        error:
          'Invalid apiKey: must be a single-line token of letters, digits, dot, underscore or hyphen (max 512 chars).',
      },
      400,
    );
    return;
  }

  try {
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = '';
    if (existsSync(envPath)) {
      envContent = await fsPromises.readFile(envPath, 'utf8');
    }

    const lines = envContent.split('\n');
    let hasProvider = false;
    let hasKey = false;

    const keyVar = 'AXIOMIFY_AI_KEY';
    const providerVar = 'AXIOMIFY_AI_PROVIDER';

    const updatedLines = lines.map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith(`${providerVar}=`)) {
        hasProvider = true;
        return `${providerVar}=${provider}`;
      }
      if (trimmed.startsWith(`${keyVar}=`)) {
        hasKey = true;
        return `${keyVar}=${apiKey}`;
      }
      return line;
    });

    if (!hasProvider) {
      updatedLines.push(`${providerVar}=${provider}`);
    }
    if (!hasKey) {
      updatedLines.push(`${keyVar}=${apiKey}`);
    }

    await fsPromises.writeFile(envPath, updatedLines.join('\n'), 'utf8');

    // Dynamically update process.env for current server instance
    process.env[providerVar] = provider;
    process.env[keyVar] = apiKey;

    sendJson(res, { success: true });
  } catch (err: any) {
    sendJson(
      res,
      { error: 'Failed to write to .env', details: String(err) },
      500,
    );
  }
}
