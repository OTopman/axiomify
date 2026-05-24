/**
 * Swift Type Emitter.
 * Emits Swift Codable structs.
 */
import type { IRSchema, IRType, IRTypeRef } from '../../ir/types';
import { TypeGraph } from '../../ir/type-graph';
import { Emitter } from '../../emitter';

export class SwiftTypeEmitter {
  constructor(private schema: IRSchema, private graph: TypeGraph) {}

  emitAll(): string {
    const emitter = new Emitter('    ');
    const sortedIds = this.graph.topologicalSort();

    emitter.line(`import Foundation`);
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
    if (type.description) this.emitDoc(emitter, type.description);

    switch (type.kind) {
      case 'object':
        emitter.block(`public struct ${type.id}: Codable {`, `}`, () => {
          for (const field of type.fields) {
            if (field.description) this.emitDoc(emitter, field.description);
            const swiftType = this.renderTypeRef(field.type);
            const opt = field.required ? '' : '?';
            emitter.line(`public var ${field.name}: ${swiftType}${opt}`);
          }
        });
        break;

      case 'enum':
        const rawType = type.valueType === 'number' ? 'Double' : 'String';
        emitter.block(`public enum ${type.id}: ${rawType}, Codable {`, `}`, () => {
          for (const v of type.values) {
             const val = typeof v.value === 'string' ? `"${v.value}"` : v.value;
             emitter.line(`case ${v.name} = ${val}`);
          }
        });
        break;

      case 'array':
        emitter.line(`public typealias ${type.id} = [${this.renderTypeRef(type.items)}]`);
        break;

      case 'scalar':
        emitter.line(`public typealias ${type.id} = ${this.renderScalar(type.scalar)}`);
        break;
        
      default:
        emitter.line(`// TODO: Complex type ${type.id} of kind ${type.kind}`);
        emitter.line(`public typealias ${type.id} = AnyCodable`);
        break;
    }
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'AnyCodable';
    if (ref.ref) t = ref.ref;
    else if (ref.inline) {
      if (ref.inline.kind === 'scalar') t = this.renderScalar(ref.inline.scalar);
      else if (ref.inline.kind === 'array') t = `[${this.renderTypeRef(ref.inline.items)}]`;
    }
    
    if (ref.isArray) t = `[${t}]`;
    return t; // Swift handles optionals on the field definition mostly, or with `?` directly
  }

  private renderScalar(s: string): string {
    switch(s) {
      case 'integer':
      case 'bigint': return 'Int';
      case 'number': return 'Double';
      case 'boolean': return 'Bool';
      case 'string':
      case 'date':
      case 'datetime':
      case 'uuid':
      case 'uri':
      case 'email': return 'String';
      case 'binary': return 'Data';
      default: return 'AnyCodable';
    }
  }

  private emitDoc(emitter: Emitter, text: string): void {
    for (const l of text.split('\n')) emitter.line(`/// ${l}`);
  }
}
