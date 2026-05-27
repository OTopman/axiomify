/**
 * TypeScript React Query Hooks Emitter.
 *
 * Emits type-safe React Query hooks for query and mutation endpoints.
 */
import type { IRSchema, IREndpoint, IRTypeRef } from '../../../ir/types';
import { Emitter } from '../../emitter';

export class TsReactQueryEmitter {
  constructor(private schema: IRSchema) {}

  emitAll(clientClassName: string = 'ApiClient'): string {
    const emitter = new Emitter();

    emitter.line(`import { useQuery, useMutation, UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';`);
    emitter.line(`import { ${clientClassName} } from './client';`);
    emitter.line(`import type * as Types from './types';`);
    emitter.line();

    emitter.block(`export class ApiHooks {`, `}`, () => {
      emitter.line(`constructor(private client: ${clientClassName}) {}`);

      for (const ep of this.schema.endpoints) {
        if (ep.transport !== 'rest') continue;
        emitter.line();
        this.emitHook(emitter, ep);
      }
    });

    return emitter.toString();
  }

  private emitHook(emitter: Emitter, ep: IREndpoint): void {
    const operationName = ep.operationId;
    const hookName = `use${operationName.charAt(0).toUpperCase()}${operationName.slice(1)}`;
    
    const reqType = this.buildRequestType(ep);
    const resType = this.buildResponseType(ep);
    
    const isMutation = ep.method !== 'GET';

    if (isMutation) {
      // Mutation Hook
      const mutationFnArg = reqType ? `req` : ``;
      const clientCallArg = reqType ? `req` : ``;
      
      emitter.block(`use${operationName.charAt(0).toUpperCase()}${operationName.slice(1)}(options?: UseMutationOptions<${resType}, Error, ${reqType || 'void'}>) {`, `}`, () => {
        emitter.block(`return useMutation({`, `});`, () => {
          emitter.line(`mutationFn: (${mutationFnArg}) => this.client.${operationName}(${clientCallArg}),`);
          emitter.line(`...options,`);
        });
      });
    } else {
      // Query Hook
      const queryKeyParts = [`"${operationName}"`];
      if (reqType) {
        queryKeyParts.push(`request`);
      }
      
      const argsSignature = reqType ? `request: ${reqType}, options?: Omit<UseQueryOptions<${resType}, Error>, 'queryKey' | 'queryFn'>` : `options?: Omit<UseQueryOptions<${resType}, Error>, 'queryKey' | 'queryFn'>`;
      const clientCallArg = reqType ? `request` : ``;

      emitter.block(`${hookName}(${argsSignature}) {`, `}`, () => {
        emitter.block(`return useQuery({`, `});`, () => {
          emitter.line(`queryKey: [${queryKeyParts.join(', ')}],`);
          emitter.line(`queryFn: () => this.client.${operationName}(${clientCallArg}),`);
          emitter.line(`...options,`);
        });
      });
    }
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
