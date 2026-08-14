/**
 * TypeScript Client Emitter.
 *
 * Generates the main HTTP client class with typed methods for every endpoint.
 */
import type {
  IRSchema,
  IREndpoint,
  IRTypeRef,
  IREventContract,
} from '../../../ir/types';
import { Emitter } from '../../emitter';

export class TsClientEmitter {
  constructor(
    private schema: IRSchema,
    private className: string = 'ApiClient',
  ) {}

  emitAll(): string {
    const emitter = new Emitter();

    // Import runtime client
    emitter.line(
      `import { BaseClient, WebSocketClient, type ClientConfig, type WebSocketClientOptions } from '@axiomify/sdk-runtime';`,
    );
    emitter.line(`import type * as Types from './types';`);
    emitter.line();

    emitter.block(
      `export class ${this.className} extends BaseClient {`,
      `}`,
      () => {
        emitter.block(`constructor(config: ClientConfig) {`, `}`, () => {
          emitter.line(`super(config);`);
        });

        for (const ep of this.schema.endpoints) {
          if (ep.transport !== 'rest') continue; // Skip WS/GraphQL for now
          emitter.line();
          this.emitMethod(emitter, ep);
        }

        // Group events by channel
        const channels = new Map<string, IREventContract[]>();
        if (this.schema.events) {
          for (const event of this.schema.events) {
            const list = channels.get(event.channel || '/') || [];
            list.push(event);
            channels.set(event.channel || '/', list);
          }
        }

        for (const [channelName, events] of channels.entries()) {
          const className = toClassName(channelName);
          const clientClassName = `${className}ChannelClient`;
          const params = extractParams(channelName);

          emitter.line();
          if (params.length > 0) {
            const paramSignature = `params: { ${params.map((p) => `${p}: string`).join(', ')} }, options?: WebSocketClientOptions`;
            emitter.block(
              `public ${toMethodName(className)}(${paramSignature}): ${clientClassName} {`,
              `}`,
              () => {
                emitter.line(
                  `const wsBase = this.config.baseUrl.replace(/^http/, 'ws');`,
                );
                let pathExpr = channelName;
                for (const p of params) {
                  pathExpr = pathExpr
                    .replace(`{${p}}`, `\${params.${p}}`)
                    .replace(`:${p}`, `\${params.${p}}`);
                }
                emitter.line(
                  `return new ${clientClassName}(\`\${wsBase}${pathExpr}\`, options);`,
                );
              },
            );
          } else {
            emitter.block(
              `public ${toMethodName(className)}(options?: WebSocketClientOptions): ${clientClassName} {`,
              `}`,
              () => {
                emitter.line(
                  `const wsBase = this.config.baseUrl.replace(/^http/, 'ws');`,
                );
                emitter.line(
                  `return new ${clientClassName}(\`\${wsBase}${channelName}\`, options);`,
                );
              },
            );
          }
        }
      },
    );

    // Group events by channel again to generate classes at file scope
    const channels = new Map<string, IREventContract[]>();
    if (this.schema.events) {
      for (const event of this.schema.events) {
        const list = channels.get(event.channel || '/') || [];
        list.push(event);
        channels.set(event.channel || '/', list);
      }
    }

    for (const [channelName, events] of channels.entries()) {
      const className = toClassName(channelName);
      const clientClassName = `${className}ChannelClient`;

      emitter.line();
      emitter.block(`export class ${clientClassName} {`, `}`, () => {
        emitter.line(`private ws: WebSocketClient;`);
        emitter.line(
          `private listeners = new Map<string, Set<(data: any) => void>>();`,
        );
        emitter.line();
        emitter.block(
          `constructor(url: string, options?: WebSocketClientOptions) {`,
          `}`,
          () => {
            emitter.block(`this.ws = new WebSocketClient(url, {`, `});`, () => {
              emitter.line(`...options,`);
              emitter.block(`onMessage: (data: string) => {`, `},`, () => {
                emitter.line(`options?.onMessage?.(data);`);
                emitter.block(`try {`, `} catch (e) {`, () => {
                  emitter.line(`const parsed = JSON.parse(data);`);
                  emitter.line(
                    `const eventName = String(parsed.event || parsed.type || parsed.action || '').toLowerCase();`,
                  );
                  emitter.line(`let matched = false;`);
                  emitter.block(
                    `for (const [registeredName, list] of this.listeners.entries()) {`,
                    `}`,
                    () => {
                      emitter.block(
                        `if (registeredName.toLowerCase() === eventName) {`,
                        `}`,
                        () => {
                          emitter.line(
                            `const payload = parsed.data !== undefined ? parsed.data : (parsed.payload !== undefined ? parsed.payload : parsed);`,
                          );
                          emitter.block(`for (const cb of list) {`, `}`, () => {
                            emitter.line(`cb(payload);`);
                          });
                          emitter.line(`matched = true;`);
                        },
                      );
                    },
                  );
                  emitter.block(`if (!matched) {`, `}`, () => {
                    emitter.block(
                      `for (const list of this.listeners.values()) {`,
                      `}`,
                      () => {
                        emitter.block(`for (const cb of list) {`, `}`, () => {
                          emitter.line(`cb(parsed);`);
                        });
                      },
                    );
                  });
                });
                emitter.block(``, `}`, () => {
                  emitter.block(
                    `for (const list of this.listeners.values()) {`,
                    `}`,
                    () => {
                      emitter.block(`for (const cb of list) {`, `}`, () => {
                        emitter.line(`cb(data);`);
                      });
                    },
                  );
                });
              });
            });
          },
        );

        emitter.line();
        emitter.block(`public connect(): void {`, `}`, () => {
          emitter.line(`this.ws.connect();`);
        });

        emitter.line();
        emitter.block(`public disconnect(): void {`, `}`, () => {
          emitter.line(`this.ws.disconnect();`);
        });

        for (const event of events) {
          const eventName = event.name;
          const payloadType = event.payload
            ? this.renderTypeRef(event.payload)
            : 'any';
          const capEventName =
            eventName.charAt(0).toUpperCase() + eventName.slice(1);
          const direction = event.direction;

          // Inbound or Bidirectional subscription
          if (direction === 'inbound' || direction === 'bidirectional') {
            emitter.line();
            emitter.block(
              `public on${capEventName}(callback: (payload: ${payloadType}) => void): () => void {`,
              `}`,
              () => {
                emitter.line(`let list = this.listeners.get('${eventName}');`);
                emitter.block(`if (!list) {`, `}`, () => {
                  emitter.line(`list = new Set();`);
                  emitter.line(`this.listeners.set('${eventName}', list);`);
                });
                emitter.line(`list.add(callback);`);
                emitter.block(`return () => {`, `};`, () => {
                  emitter.line(`list.delete(callback);`);
                });
              },
            );
          }

          // Outbound or Bidirectional publication
          if (direction === 'outbound' || direction === 'bidirectional') {
            emitter.line();
            const paramSig = event.payload
              ? `payload: ${payloadType}`
              : `payload?: any`;
            emitter.block(
              `public send${capEventName}(${paramSig}): void {`,
              `}`,
              () => {
                emitter.block(`this.ws.send(JSON.stringify({`, `}));`, () => {
                  emitter.line(`event: '${eventName}',`);
                  emitter.line(
                    `data: ${event.payload ? 'payload' : 'undefined'}`,
                  );
                });
              },
            );
          }
        }
      });
    }

    return emitter.toString();
  }

  private emitMethod(emitter: Emitter, ep: IREndpoint): void {
    if (ep.description || ep.summary) {
      emitter.line('/**');
      if (ep.summary) emitter.line(` * ${ep.summary}`);
      if (ep.description) {
        for (const l of ep.description.split('\n')) emitter.line(` * ${l}`);
      }
      if (ep.deprecated) emitter.line(' * @deprecated');
      emitter.line(' */');
    }

    const methodName = ep.operationId;
    const reqType = this.buildRequestType(ep);
    const resType = this.buildResponseType(ep);

    let methodSignature = `async ${methodName}(`;
    if (reqType) {
      methodSignature += `request: ${reqType}`;
    }
    methodSignature += `): Promise<${resType}> {`;

    emitter.block(methodSignature, `}`, () => {
      const method = ep.method?.toUpperCase() || 'GET';
      const pathTemplate = ep.path || '/';

      // Build path with replacements
      const pathExpr = `\`${pathTemplate.replace(/\{([^}]+)\}/g, '${request.$1}')}\``;

      let reqOpts = `method: '${method}', path: ${pathExpr}`;

      const isValidTSIdentifier = (name: string) =>
        /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);

      if (ep.queryParams.length > 0) {
        reqOpts += `, query: {`;
        for (const q of ep.queryParams) {
          const propStr = isValidTSIdentifier(q.name) ? q.name : `'${q.name}'`;
          const accessStr = isValidTSIdentifier(q.name)
            ? `.${q.name}`
            : `['${q.name}']`;
          reqOpts += ` ${propStr}: request${accessStr},`;
        }
        reqOpts += ` }`;
      }

      if (ep.requestBody) {
        reqOpts += `, body: request.body`;
      }

      if (ep.headerParams.length > 0) {
        reqOpts += `, headers: {`;
        for (const header of ep.headerParams) {
          const accessStr = isValidTSIdentifier(header.name)
            ? `.${header.name}`
            : `['${header.name}']`;
          reqOpts += ` ...(request${accessStr} !== undefined ? { '${header.name}': String(request${accessStr}) } : {}),`;
        }
        reqOpts += ` }`;
      }

      emitter.line(`return this.request<${resType}>({ ${reqOpts} });`);
    });
  }

  private buildRequestType(ep: IREndpoint): string | null {
    const props: string[] = [];
    const formatProp = (name: string) =>
      /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : `'${name}'`;

    for (const p of ep.pathParams)
      props.push(
        `${formatProp(p.name)}${p.required ? '' : '?'}: ${this.renderTypeRef(p.type)}`,
      );
    for (const p of ep.queryParams)
      props.push(
        `${formatProp(p.name)}${p.required ? '' : '?'}: ${this.renderTypeRef(p.type)}`,
      );
    for (const p of ep.headerParams)
      props.push(
        `${formatProp(p.name)}${p.required ? '' : '?'}: ${this.renderTypeRef(p.type)}`,
      );

    if (ep.requestBody) {
      props.push(
        `body${ep.requestBody.required ? '' : '?'}: ${this.renderTypeRef(ep.requestBody.type)}`,
      );
    }

    if (props.length === 0) return null;
    return `{ ${props.join(', ')} }`;
  }

  private buildResponseType(ep: IREndpoint): string {
    const success = ep.successResponse;
    if (success && ep.responses[success]) {
      const typeRef = ep.responses[success].type;
      if (typeRef) return this.renderTypeRef(typeRef);
    }
    return 'void';
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'any';
    if (ref.ref) t = `Types.${ref.ref}`;
    else if (ref.inline) {
      if (ref.inline.kind === 'scalar') {
        if (ref.inline.scalar === 'integer' || ref.inline.scalar === 'number')
          t = 'number';
        else if (ref.inline.scalar === 'boolean') t = 'boolean';
        else t = 'string';
      } else if (ref.inline.kind === 'array') {
        t = `${this.renderTypeRef(ref.inline.items)}[]`;
      }
    }
    if (ref.isArray) t = `${t}[]`;
    if (ref.nullable) t = `${t} | null`;
    return t;
  }
}

function toClassName(channel: string): string {
  const parts = channel
    .split('/')
    .filter(Boolean)
    .map((p) => p.replace(/[{}]/g, ''))
    .map((p) => p.replace(/[^a-zA-Z0-9]/g, ''))
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return parts.join('') || 'Root';
}

function toMethodName(className: string): string {
  return className.charAt(0).toLowerCase() + className.slice(1);
}

function extractParams(channel: string): string[] {
  const params: string[] = [];
  const braceMatches = channel.matchAll(/\{([^}]+)\}/g);
  for (const m of braceMatches) {
    params.push(m[1]);
  }
  const colonMatches = channel.matchAll(/:([a-zA-Z0-9_]+)/g);
  for (const m of colonMatches) {
    params.push(m[1]);
  }
  return params;
}
