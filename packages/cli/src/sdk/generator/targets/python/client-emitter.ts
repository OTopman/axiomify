/**
 * Python Client Emitter.
 * Emits asynchronous HTTP client using httpx and Pydantic v2.
 */
import { Emitter } from '../../emitter';
import type { IREndpoint, IRSchema, IRTypeRef } from '../../../ir/types';

export class PythonClientEmitter {
  constructor(
    private schema: IRSchema,
    private className: string = 'ApiClient',
  ) {}

  emitAll(): string {
    const emitter = new Emitter('    ');

    emitter.line(`import httpx`);
    emitter.line(`from typing import Optional, Dict, Any, List, Union`);
    emitter.line(`from datetime import datetime`);
    emitter.line(`from . import types`);
    emitter.line();

    emitter.block(`class ${this.className}:`, ``, () => {
      emitter.block(
        `def __init__(self, base_url: str, token: Optional[str] = None):`,
        ``,
        () => {
          emitter.line(`self.base_url = base_url`);
          emitter.line(
            `self.headers = {"Authorization": f"Bearer {token}"} if token else {}`,
          );
          emitter.line(
            `self.client = httpx.AsyncClient(base_url=self.base_url, headers=self.headers)`,
          );
        },
      );

      emitter.block(`async def close(self):`, ``, () => {
        emitter.line(`await self.client.aclose()`);
      });

      for (const ep of this.schema.endpoints) {
        if (ep.transport !== 'rest') continue;
        emitter.line();
        this.emitMethod(emitter, ep);
      }
    });

    return emitter.toString();
  }

  private emitMethod(emitter: Emitter, ep: IREndpoint): void {
    const methodName = this.toSnakeCase(ep.operationId);

    let args = `self`;
    for (const p of ep.pathParams)
      args += `, ${this.toSnakeCase(p.name)}: ${this.renderTypeRef(p.type)}`;
    for (const p of ep.queryParams) {
      const defaultValue = p.required ? '' : ' = None';
      args += `, ${this.toSnakeCase(p.name)}: Optional[${this.renderTypeRef(p.type)}]${defaultValue}`;
    }
    if (ep.requestBody) {
      args += `, body: ${this.renderTypeRef(ep.requestBody.type)}`;
    }

    const returnType = this.buildResponseType(ep);

    emitter.block(
      `async def ${methodName}(${args}) -> ${returnType}:`,
      ``,
      () => {
        if (ep.summary || ep.description) {
          emitter.line(`"""`);
          if (ep.summary) emitter.line(ep.summary);
          if (ep.description) emitter.line(ep.description);
          emitter.line(`"""`);
        }

        const method = ep.method?.toLowerCase() || 'get';
        const pathTemplate = ep.path || '/';

        // Path parameter replacement: {id} -> {self.toSnakeCase(id)}
        let pathExpr = pathTemplate;
        for (const p of ep.pathParams) {
          pathExpr = pathExpr.replace(
            `{${p.name}}`,
            `{${this.toSnakeCase(p.name)}}`,
          );
        }

        emitter.line(`url = f"${pathExpr}"`);

        let reqOpts = `url`;

        if (ep.queryParams.length > 0) {
          emitter.line(`params = {`);
          for (const q of ep.queryParams) {
            const snakeName = this.toSnakeCase(q.name);
            emitter.line(`    "${q.name}": ${snakeName},`);
          }
          emitter.line(`}`);
          reqOpts += `, params={k: v for k, v in params.items() if v is not None}`;
        }

        if (ep.requestBody) {
          // Serialize Pydantic model if applicable
          emitter.line(
            `req_body = body.model_dump(by_alias=True) if hasattr(body, 'model_dump') else body`,
          );
          reqOpts += `, json=req_body`;
        }

        emitter.line(`response = await self.client.${method}(${reqOpts})`);
        emitter.line(`response.raise_for_status()`);

        if (returnType !== 'None') {
          const rawType =
            ep.successResponse && ep.responses[ep.successResponse]?.type?.ref;
          if (rawType) {
            emitter.line(
              `return types.${rawType}.model_validate(response.json())`,
            );
          } else {
            emitter.line(`return response.json()`);
          }
        } else {
          emitter.line(`return None`);
        }
      },
    );
  }

  private buildResponseType(ep: IREndpoint): string {
    const success = ep.successResponse;
    if (success && ep.responses[success]) {
      const typeRef = ep.responses[success].type;
      if (typeRef) return this.renderTypeRef(typeRef);
    }
    return 'None';
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'Any';
    if (ref.ref) t = `types.${ref.ref}`;
    else if (ref.inline) {
      if (ref.inline.kind === 'scalar') {
        if (ref.inline.scalar === 'integer' || ref.inline.scalar === 'number')
          t = 'float';
        else if (ref.inline.scalar === 'boolean') t = 'bool';
        else t = 'str';
      } else if (ref.inline.kind === 'array') {
        t = `List[${this.renderTypeRef(ref.inline.items)}]`;
      }
    }
    if (ref.isArray) t = `List[${t}]`;
    if (ref.nullable) t = `Optional[${t}]`;
    return t;
  }

  private toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  }
}
