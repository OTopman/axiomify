/**
 * JavaScript JSDoc-typed Client Emitter.
 *
 * Generates the main HTTP client class in vanilla JS with detailed JSDoc.
 */
import { Emitter } from '../../emitter';
import type { IREndpoint, IRSchema, IRTypeRef } from '../../../ir/types';

export class JsClientEmitter {
  constructor(
    private schema: IRSchema,
    private className: string = 'ApiClient',
  ) {}

  emitAll(): string {
    const emitter = new Emitter();

    // Import runtime client
    emitter.line(`const { BaseClient } = require('@axiomify/sdk-runtime');`);
    emitter.line();

    emitter.line('/**');
    emitter.line(` * ${this.className}`);
    emitter.line(' * @extends {BaseClient}');
    emitter.line(' */');
    emitter.block(`class ${this.className} extends BaseClient {`, `}`, () => {
      emitter.line('/**');
      emitter.line(
        ' * @param {import("@axiomify/sdk-runtime").ClientConfig} config',
      );
      emitter.line(' */');
      emitter.block(`constructor(config) {`, `}`, () => {
        emitter.line(`super(config);`);
      });

      for (const ep of this.schema.endpoints) {
        if (ep.transport !== 'rest') continue;
        emitter.line();
        this.emitMethod(emitter, ep);
      }
    });

    emitter.line();
    emitter.line(`module.exports = { ${this.className} };`);

    return emitter.toString();
  }

  private emitMethod(emitter: Emitter, ep: IREndpoint): void {
    const methodName = ep.operationId;
    const reqType = this.buildRequestType(ep);
    const resType = this.buildResponseType(ep);

    emitter.line('/**');
    if (ep.summary) emitter.line(` * ${ep.summary}`);
    if (ep.description) {
      for (const l of ep.description.split('\n')) emitter.line(` * ${l}`);
    }
    if (ep.deprecated) emitter.line(' * @deprecated');
    if (reqType) {
      emitter.line(` * @param {${reqType}} request`);
    }
    emitter.line(` * @returns {Promise<${resType}>}`);
    emitter.line(' */');

    const methodSignature = `async ${methodName}(${reqType ? 'request' : ''}) {`;

    emitter.block(methodSignature, `}`, () => {
      const method = ep.method?.toUpperCase() || 'GET';
      const pathTemplate = ep.path || '/';

      const pathExpr = `\`${pathTemplate.replace(/\{([^}]+)\}/g, '${request.$1}')}\``;
      let reqOpts = `method: '${method}', path: ${pathExpr}`;

      const isValidJSIdentifier = (name: string) =>
        /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);

      if (ep.queryParams.length > 0) {
        reqOpts += `, query: {`;
        for (const q of ep.queryParams) {
          const propStr = isValidJSIdentifier(q.name) ? q.name : `'${q.name}'`;
          const accessStr = isValidJSIdentifier(q.name)
            ? `.${q.name}`
            : `['${q.name}']`;
          reqOpts += ` ${propStr}: request${accessStr},`;
        }
        reqOpts += ` }`;
      }

      if (ep.requestBody) {
        reqOpts += `, body: request.body`;
      }

      emitter.line(`return this.request({ ${reqOpts} });`);
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
    if (ref.ref) t = `import("./types").${ref.ref}`;
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
