/**
 * Python Type Emitter.
 * Emits Pydantic v2 models and standard python enums.
 */
import { Emitter } from '../../emitter';
import { TypeGraph } from '../../../ir/type-graph';
import type { IRSchema, IRType, IRTypeRef } from '../../../ir/types';

export class PythonTypeEmitter {
  constructor(
    private schema: IRSchema,
    private graph: TypeGraph,
  ) {}

  emitAll(): string {
    const emitter = new Emitter('    ');
    const sortedIds = this.graph.topologicalSort();

    emitter.line(`from typing import List, Dict, Optional, Any, Union`);
    emitter.line(`from enum import Enum`);
    emitter.line(`from datetime import datetime`);
    emitter.line(`from pydantic import BaseModel, Field, ConfigDict`);
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
        emitter.block(`class ${type.id}(BaseModel):`, ``, () => {
          if (type.description) this.emitDoc(emitter, type.description);

          emitter.line(
            `model_config = ConfigDict(populate_by_name=True, protected_namespaces=())`,
          );
          emitter.line();

          if (type.fields.length === 0) {
            emitter.line('pass');
            return;
          }

          for (const field of type.fields) {
            const pyType = this.renderTypeRef(field.type);
            const alias =
              field.name !== this.toSnakeCase(field.name)
                ? `, alias="${field.name}"`
                : '';
            const desc = field.description
              ? `, description="${field.description.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
              : '';

            if (field.required) {
              emitter.line(
                `${this.toSnakeCase(field.name)}: ${pyType} = Field(...${alias}${desc})`,
              );
            } else {
              emitter.line(
                `${this.toSnakeCase(field.name)}: Optional[${pyType}] = Field(default=None${alias}${desc})`,
              );
            }
          }
        });
        break;

      case 'enum':
        const base = type.valueType === 'number' ? 'int' : 'str';
        emitter.block(`class ${type.id}(${base}, Enum):`, ``, () => {
          if (type.description) this.emitDoc(emitter, type.description);
          for (const v of type.values) {
            const pyVal =
              typeof v.value === 'string' ? `"${v.value}"` : v.value;
            emitter.line(`${this.toEnumKey(v.name)} = ${pyVal}`);
          }
        });
        break;

      case 'union':
        emitter.line(
          `${type.id} = Union[${type.members.map((m: any) => this.renderTypeRef(m)).join(', ')}]`,
        );
        break;

      case 'intersection':
        // Python doesn't have native intersection; we represent as Union or merge in preprocessing.
        // For type safety, we define it as a Union of its members or Any.
        emitter.line(`${type.id} = Any`);
        break;

      case 'array':
        emitter.line(`${type.id} = List[${this.renderTypeRef(type.items)}]`);
        break;

      case 'scalar':
        emitter.line(`${type.id} = ${this.renderScalar(type.scalar)}`);
        break;

      case 'map':
        emitter.line(
          `${type.id} = Dict[str, ${this.renderTypeRef(type.valueType)}]`,
        );
        break;

      case 'tuple':
        emitter.line(
          `${type.id} = tuple[${type.elements.map((e: any) => this.renderTypeRef(e)).join(', ')}]`,
        );
        break;

      case 'literal':
        const literalVal =
          typeof type.value === 'string' ? `"${type.value}"` : type.value;
        emitter.line(`${type.id} = Any # Literal: ${literalVal}`);
        break;
    }
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'Any';
    if (ref.ref) t = `"${ref.ref}"`;
    else if (ref.inline) {
      if (ref.inline.kind === 'scalar')
        t = this.renderScalar(ref.inline.scalar);
      else if (ref.inline.kind === 'array')
        t = `List[${this.renderTypeRef(ref.inline.items)}]`;
    }

    if (ref.isArray) t = `List[${t}]`;
    if (ref.nullable) t = `Optional[${t}]`;
    return t;
  }

  private renderScalar(s: string): string {
    switch (s) {
      case 'integer':
      case 'bigint':
        return 'int';
      case 'number':
        return 'float';
      case 'boolean':
        return 'bool';
      case 'datetime':
        return 'datetime';
      case 'string':
      default:
        return 'str';
    }
  }

  private toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  }

  private toEnumKey(str: string): string {
    return this.toSnakeCase(str)
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_');
  }

  private emitDoc(emitter: Emitter, text: string): void {
    emitter.line('"""');
    for (const l of text.split('\n')) emitter.line(l);
    emitter.line('"""');
  }
}
