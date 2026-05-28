/**
 * TypeScript Client Emitter.
 *
 * Generates the main HTTP client class with typed methods for every endpoint.
 */
import type { IRSchema, IREndpoint, IRTypeRef } from '../../../ir/types';
import { Emitter } from '../../emitter';

export class TsClientEmitter {
  constructor(private schema: IRSchema, private className: string = 'ApiClient') {}

  emitAll(): string {
    const emitter = new Emitter();

    // Import runtime client
    emitter.line(`import { BaseClient, type ClientConfig } from '@axiomify/sdk-runtime';`);
    emitter.line(`import type * as Types from './types';`);
    emitter.line();

    emitter.block(`export class ${this.className} extends BaseClient {`, `}`, () => {
      emitter.block(`constructor(config: ClientConfig) {`, `}`, () => {
        emitter.line(`super(config);`);
      });

      for (const ep of this.schema.endpoints) {
        if (ep.transport !== 'rest') continue; // Skip WS/GraphQL for now
        emitter.line();
        this.emitMethod(emitter, ep);
      }
    });

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
      let pathExpr = `\`${pathTemplate.replace(/\{([^}]+)\}/g, '${request.$1}')}\``;
      
      let reqOpts = `method: '${method}', path: ${pathExpr}`;
      
      const isValidTSIdentifier = (name: string) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);

      if (ep.queryParams.length > 0) {
        reqOpts += `, query: {`;
        for (const q of ep.queryParams) {
           const propStr = isValidTSIdentifier(q.name) ? q.name : `'${q.name}'`;
           const accessStr = isValidTSIdentifier(q.name) ? `.${q.name}` : `['${q.name}']`;
           reqOpts += ` ${propStr}: request${accessStr},`;
        }
        reqOpts += ` }`;
      }
      
      if (ep.requestBody) {
        reqOpts += `, body: request.body`;
      }

      emitter.line(`return this.request<${resType}>({ ${reqOpts} });`);
    });
  }

  private buildRequestType(ep: IREndpoint): string | null {
    const props: string[] = [];
    const formatProp = (name: string) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : `'${name}'`;
    
    for (const p of ep.pathParams) props.push(`${formatProp(p.name)}${p.required ? '' : '?'}: ${this.renderTypeRef(p.type)}`);
    for (const p of ep.queryParams) props.push(`${formatProp(p.name)}${p.required ? '' : '?'}: ${this.renderTypeRef(p.type)}`);
    for (const p of ep.headerParams) props.push(`${formatProp(p.name)}${p.required ? '' : '?'}: ${this.renderTypeRef(p.type)}`);
    
    if (ep.requestBody) {
       props.push(`body${ep.requestBody.required ? '' : '?'}: ${this.renderTypeRef(ep.requestBody.type)}`);
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
         if (ref.inline.scalar === 'integer' || ref.inline.scalar === 'number') t = 'number';
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
