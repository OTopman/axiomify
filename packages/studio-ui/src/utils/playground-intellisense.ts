export interface PlaygroundSdkFile {
  path: string;
  content: string;
}

export interface PlaygroundOperationParameter {
  name: string;
  optional: boolean;
  type: string;
}

export interface PlaygroundOperation {
  name: string;
  signature: string;
  documentation: string;
  parameters: PlaygroundOperationParameter[];
}

export interface PlaygroundPropertyCompletionContext {
  operationName: string;
  query: string;
  usedPropertyNames: string[];
}

const BASE_URL_LITERAL =
  /baseUrl:\s*(?:"(?:\\[\s\S]|[^"\\\r\n])*"|'(?:\\[\s\S]|[^'\\\r\n])*')/;

/**
 * Replaces the Playground client base URL with a complete JavaScript string
 * encoding. JSON.stringify handles quotes, backslashes, control characters,
 * and line breaks without relying on a partial hand-written sanitizer.
 */
export function replacePlaygroundBaseUrl(
  code: string,
  nextUrl: string,
): string {
  return code.replace(BASE_URL_LITERAL, `baseUrl: ${JSON.stringify(nextUrl)}`);
}

/** Split a TypeScript comma-separated list without splitting nested types. */
function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if ('{[(<'.includes(character)) depth += 1;
    if ('}])>'.includes(character)) depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(source.slice(start));
  return parts;
}

function extractRequestProperties(
  parameterSource: string,
): PlaygroundOperationParameter[] {
  const requestMatch = /^\s*request\s*:\s*\{([\s\S]*)\}\s*$/.exec(
    parameterSource,
  );
  if (!requestMatch) return [];

  return splitTopLevel(requestMatch[1]).flatMap((part) => {
    const propertyMatch =
      /^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))(\?)?\s*:\s*([\s\S]+?)\s*$/.exec(
        part,
      );
    if (!propertyMatch) return [];

    return [
      {
        name: propertyMatch[1] || propertyMatch[2],
        optional: Boolean(propertyMatch[3]),
        type: propertyMatch[4],
      },
    ];
  });
}

/**
 * Extract the generated client surface so Monaco can offer route methods even
 * while its TypeScript worker is still indexing the virtual SDK files.
 */
export function extractPlaygroundOperations(
  files: PlaygroundSdkFile[],
): PlaygroundOperation[] {
  const client = files.find((file) => file.path === 'client.ts')?.content || '';
  const operations: PlaygroundOperation[] = [];
  const pattern =
    /(?:\/\*\*([\s\S]*?)\*\/\s*)?\s*async\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*:\s*Promise<([^>]+)>/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(client)) !== null) {
    const documentation = (match[1] || '')
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').trim())
      .filter(Boolean)
      .join('\n');
    operations.push({
      name: match[2],
      signature: `${match[2]}(${match[3]}): Promise<${match[4]}>`,
      documentation: documentation || `Generated SDK method: ${match[2]}`,
      parameters: extractRequestProperties(match[3]),
    });
  }

  return operations;
}

export const playgroundRuntimeDeclarations = `
declare module '@axiomify/sdk-runtime' {
  export interface ClientConfig { baseUrl: string; headers?: Record<string, string>; }
  export interface RequestOptions { method: string; path: string; query?: Record<string, unknown>; headers?: Record<string, string>; body?: unknown; }
  export interface WebSocketClientOptions { onMessage?: (data: string) => void; }
  export class BaseClient {
    protected config: ClientConfig;
    constructor(config: ClientConfig);
    protected request<T>(options: RequestOptions): Promise<T>;
  }
  export class WebSocketClient {
    constructor(url: string, options?: WebSocketClientOptions);
    connect(): void;
    disconnect(): void;
    send(data: string): void;
  }
  export class AxiomifyClient extends BaseClient {}
  export class AxiomifyError extends Error {}
}
`;

/** Returns the partially typed SDK method after `client.`, if present. */
export function getPlaygroundCompletionQuery(
  linePrefix: string,
): string | null {
  const match = /\bclient\.([A-Za-z_$][\w$]*)?$/.exec(linePrefix);
  return match ? match[1] || '' : null;
}

/**
 * Finds an object-literal request currently being written for a generated SDK
 * method, such as `client.createUser({ ema`. Nested body objects deliberately
 * do not match: their fields belong to the generated TypeScript type service.
 */
export function getPlaygroundPropertyCompletionContext(
  linePrefix: string,
): PlaygroundPropertyCompletionContext | null {
  const callMatch = /\bclient\.([A-Za-z_$][\w$]*)\(\s*\{([^{}]*)$/.exec(
    linePrefix,
  );
  if (!callMatch) return null;

  const objectContent = callMatch[2];
  const queryMatch = /(?:^|,)\s*([A-Za-z_$][\w$]*)?$/.exec(objectContent);
  if (!queryMatch) return null;

  const usedPropertyNames = Array.from(
    objectContent.matchAll(/(?:^|,)\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:/g),
    (match) => match[1] || match[2],
  );

  return {
    operationName: callMatch[1],
    query: queryMatch[1] || '',
    usedPropertyNames,
  };
}
