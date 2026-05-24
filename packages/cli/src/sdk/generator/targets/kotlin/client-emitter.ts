/**
 * Kotlin Client Emitter.
 * Emits suspending OkHttp client methods.
 */
import type { IRSchema, IREndpoint, IRTypeRef } from '../../ir/types';
import { Emitter } from '../../emitter';

export class KotlinClientEmitter {
  constructor(private schema: IRSchema, private pkgName: string, private className: string = 'ApiClient') {}

  emitAll(): string {
    const emitter = new Emitter('    ');

    emitter.line(`package ${this.pkgName}`);
    emitter.line();
    // In a real generator we'd import OkHttp, Gson/Jackson, and kotlinx.coroutines.
    // Simplifying for this MVP.
    emitter.line(`import java.net.URL`);
    emitter.line();

    emitter.block(`class ${this.className}(private val baseUrl: String, private val token: String? = null) {`, `}`, () => {
      emitter.line(`// HTTP client implementation omitted for brevity`);
      
      for (const ep of this.schema.endpoints) {
        if (ep.transport !== 'rest') continue;
        emitter.line();
        this.emitMethod(emitter, ep);
      }
    });

    return emitter.toString();
  }

  private emitMethod(emitter: Emitter, ep: IREndpoint): void {
    const methodName = ep.operationId.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    
    let args = [];
    for (const p of ep.pathParams) args.push(`${p.name}: ${this.renderTypeRef(p.type)}`);
    for (const p of ep.queryParams) args.push(`${p.name}: ${this.renderTypeRef(p.type)}? = null`);
    if (ep.requestBody) args.push(`body: ${this.renderTypeRef(ep.requestBody.type)}`);

    const retType = this.buildResponseType(ep);
    
    emitter.block(`suspend fun ${methodName}(${args.join(', ')}): ${retType} {`, `}`, () => {
      const method = ep.method?.toUpperCase() || 'GET';
      const pathTemplate = ep.path || '/';
      const pathExpr = pathTemplate.replace(/\{([^}]+)\}/g, '$$$1');
      
      emitter.line(`val url = "$baseUrl${pathExpr}"`);
      emitter.line(`// TODO: build URL with query params`);
      emitter.line(`// TODO: execute request and parse JSON`);
      
      if (retType !== 'Unit') {
         emitter.line(`throw NotImplementedError("SDK Generator is in MVP phase")`);
      }
    });
  }

  private buildResponseType(ep: IREndpoint): string {
    const success = ep.successResponse;
    if (success && ep.responses[success]) {
      const typeRef = ep.responses[success].type;
      if (typeRef) return this.renderTypeRef(typeRef);
    }
    return 'Unit';
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'Any';
    if (ref.ref) t = ref.ref;
    else if (ref.inline && ref.inline.kind === 'scalar') {
       if (ref.inline.scalar === 'integer') t = 'Int';
       else if (ref.inline.scalar === 'number') t = 'Double';
       else if (ref.inline.scalar === 'boolean') t = 'Boolean';
       else t = 'String';
    }
    if (ref.isArray) t = `List<${t}>`;
    return t;
  }
}
