/**
 * Python Type Emitter.
 * Emits TypedDicts, Enums, and Pydantic-like dataclasses.
 */
import type { IRSchema, IRType, IRTypeRef } from '../../ir/types';
import { TypeGraph } from '../../ir/type-graph';
import { Emitter } from '../../emitter';

export class PythonTypeEmitter {
  constructor(private schema: IRSchema, private graph: TypeGraph) {}

  emitAll(): string {
    const emitter = new Emitter('    ');
    const sortedIds = this.graph.topologicalSort();

    emitter.line(`from typing import List, Dict, Optional, Any, Union`);
    emitter.line(`from enum import Enum`);
    emitter.line(`from datetime import datetime`);
    emitter.line();

    for (const id of sortedIds) {
      const type = this.schema.types.get(id);
      if (type) {
        this.emitType(emitter, type);
        emitter.line();
      }
    }

    return emitter.toString();
  }

  private emitType(emitter: Emitter, type: IRType): void {
    switch (type.kind) {
      case 'object':
        emitter.block(`class ${type.id}:`, ``, () => {
          if (type.description) this.emitDoc(emitter, type.description);
          if (type.fields.length === 0) {
             emitter.line('pass');
             return;
          }
          emitter.block(`def __init__(self, **kwargs):`, ``, () => {
             for (const field of type.fields) {
                const pyType = this.renderTypeRef(field.type);
                const defaultVal = field.required ? '' : ' = None';
                emitter.line(`self.${field.name}: ${pyType} = kwargs.get('${field.name}'${defaultVal.length ? '' : ''})`);
             }
             if (type.additionalProperties) {
                emitter.line(`self.additional_properties = kwargs`);
             }
          });
        });
        break;

      case 'enum':
        emitter.block(`class ${type.id}(Enum):`, ``, () => {
          if (type.description) this.emitDoc(emitter, type.description);
          for (const v of type.values) {
             const val = typeof v.value === 'string' ? `"${v.value}"` : v.value;
             emitter.line(`${v.name} = ${val}`);
          }
        });
        break;

      case 'union':
        emitter.line(`${type.id} = Union[${type.members.map(m => this.renderTypeRef(m)).join(', ')}]`);
        break;
        
      case 'array':
        emitter.line(`${type.id} = List[${this.renderTypeRef(type.items)}]`);
        break;

      case 'scalar':
        emitter.line(`${type.id} = ${this.renderScalar(type.scalar)}`);
        break;
    }
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'Any';
    if (ref.ref) t = `"${ref.ref}"`;
    else if (ref.inline) {
      if (ref.inline.kind === 'scalar') t = this.renderScalar(ref.inline.scalar);
      else if (ref.inline.kind === 'array') t = `List[${this.renderTypeRef(ref.inline.items)}]`;
    }
    
    if (ref.isArray) t = `List[${t}]`;
    if (ref.nullable) t = `Optional[${t}]`;
    return t;
  }

  private renderScalar(s: string): string {
    switch(s) {
      case 'integer':
      case 'bigint': return 'int';
      case 'number': return 'float';
      case 'boolean': return 'bool';
      case 'datetime': return 'datetime';
      case 'string':
      default: return 'str';
    }
  }

  private emitDoc(emitter: Emitter, text: string): void {
    emitter.line('"""');
    for (const l of text.split('\n')) emitter.line(l);
    emitter.line('"""');
  }
}
