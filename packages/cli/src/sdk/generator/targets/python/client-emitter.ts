/**
 * Python Client Emitter.
 * Emits synchronous or asynchronous HTTP client using httpx.
 */
import type { IRSchema, IREndpoint, IRTypeRef } from '../../ir/types';
import { Emitter } from '../../emitter';

export class PythonClientEmitter {
  constructor(private schema: IRSchema, private className: string = 'ApiClient') {}

  emitAll(): string {
    const emitter = new Emitter('    ');

    emitter.line(`import httpx`);
    emitter.line(`from typing import Optional, Dict, Any, List`);
    emitter.line(`from . import types`);
    emitter.line();

    emitter.block(`class ${this.className}:`, ``, () => {
      emitter.block(`def __init__(self, base_url: str, token: Optional[str] = None):`, ``, () => {
        emitter.line(`self.base_url = base_url`);
        emitter.line(`self.headers = {"Authorization": f"Bearer {token}"} if token else {}`);
        emitter.line(`self.client = httpx.AsyncClient(base_url=self.base_url, headers=self.headers)`);
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
    const methodName = ep.operationId.replace(/([A-Z])/g, '_$1').toLowerCase();
    
    let args = `self`;
    for (const p of ep.pathParams) args += `, ${p.name}`;
    for (const p of ep.queryParams) args += `, ${p.name}: Optional[Any] = None`;
    if (ep.requestBody) args += `, body: Optional[Any] = None`;

    emitter.block(`async def ${methodName}(${args}) -> Any:`, ``, () => {
      if (ep.summary || ep.description) {
         emitter.line(`"""`);
         if (ep.summary) emitter.line(ep.summary);
         emitter.line(`"""`);
      }
      
      const method = ep.method?.toLowerCase() || 'get';
      const pathTemplate = ep.path || '/';
      const pathExpr = pathTemplate.replace(/\{([^}]+)\}/g, '{$1}');
      
      emitter.line(`url = f"${pathExpr}"`);
      
      let reqOpts = `url`;
      if (ep.queryParams.length > 0) {
        emitter.line(`params = {`);
        for (const q of ep.queryParams) {
           emitter.line(`    "${q.name}": ${q.name},`);
        }
        emitter.line(`}`);
        reqOpts += `, params={k: v for k, v in params.items() if v is not None}`;
      }
      
      if (ep.requestBody) {
        reqOpts += `, json=body`;
      }

      emitter.line(`response = await self.client.${method}(${reqOpts})`);
      emitter.line(`response.raise_for_status()`);
      emitter.line(`return response.json() if response.content else None`);
    });
  }
}
