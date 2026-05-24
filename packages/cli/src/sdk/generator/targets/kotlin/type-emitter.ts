/**
 * Kotlin Type Emitter.
 * Emits Kotlin data classes.
 */
import type { IRSchema, IRType, IRTypeRef } from '../../ir/types';
import { TypeGraph } from '../../ir/type-graph';
import { Emitter } from '../../emitter';

export class KotlinTypeEmitter {
  constructor(private schema: IRSchema, private graph: TypeGraph, private pkgName: string) {}

  emitAll(): string {
    const emitter = new Emitter('    ');
    const sortedIds = this.graph.topologicalSort();

    emitter.line(`package ${this.pkgName}`);
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
        if (type.fields.length === 0) {
           emitter.line(`class ${type.id}`);
           break;
        }
        emitter.block(`data class ${type.id}(`, `)`, () => {
          for (let i = 0; i < type.fields.length; i++) {
            const field = type.fields[i];
            if (field.description) this.emitDoc(emitter, field.description);
            const ktType = this.renderTypeRef(field.type);
            const opt = field.required ? '' : '? = null';
            const comma = i < type.fields.length - 1 ? ',' : '';
            emitter.line(`val ${field.name}: ${ktType}${opt}${comma}`);
          }
        });
        break;

      case 'enum':
        emitter.block(`enum class ${type.id} {`, `}`, () => {
          for (const v of type.values) {
             emitter.line(`${v.name.toUpperCase()},`);
          }
        });
        break;

      case 'array':
        emitter.line(`typealias ${type.id} = List<${this.renderTypeRef(type.items)}>`);
        break;

      case 'scalar':
        emitter.line(`typealias ${type.id} = ${this.renderScalar(type.scalar)}`);
        break;
        
      default:
        emitter.line(`// TODO: Complex type ${type.id} of kind ${type.kind}`);
        emitter.line(`typealias ${type.id} = Any`);
        break;
    }
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'Any';
    if (ref.ref) t = ref.ref;
    else if (ref.inline) {
      if (ref.inline.kind === 'scalar') t = this.renderScalar(ref.inline.scalar);
      else if (ref.inline.kind === 'array') t = `List<${this.renderTypeRef(ref.inline.items)}>`;
    }
    
    if (ref.isArray) t = `List<${t}>`;
    return t; // optionals handled at field declaration
  }

  private renderScalar(s: string): string {
    switch(s) {
      case 'integer': return 'Int';
      case 'bigint': return 'Long';
      case 'number': return 'Double';
      case 'boolean': return 'Boolean';
      case 'string':
      case 'date':
      case 'datetime':
      case 'uuid':
      case 'uri':
      case 'email': return 'String';
      case 'binary': return 'ByteArray';
      default: return 'Any';
    }
  }

  private emitDoc(emitter: Emitter, text: string): void {
    emitter.line('/**');
    for (const l of text.split('\n')) emitter.line(` * ${l}`);
    emitter.line(' */');
  }
}
