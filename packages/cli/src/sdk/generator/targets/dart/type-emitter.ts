/**
 * Dart Type Emitter.
 * Emits Dart classes with json_serializable support.
 */
import type { IRSchema, IRType, IRTypeRef } from '../../ir/types';
import { TypeGraph } from '../../ir/type-graph';
import { Emitter } from '../../emitter';

export class DartTypeEmitter {
  constructor(private schema: IRSchema, private graph: TypeGraph) {}

  emitAll(): string {
    const emitter = new Emitter('  ');
    const sortedIds = this.graph.topologicalSort();

    emitter.line(`// GENERATED CODE - DO NOT MODIFY BY HAND`);
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
        emitter.block(`class ${type.id} {`, `}`, () => {
          for (const field of type.fields) {
            if (field.description) this.emitDoc(emitter, field.description);
            const dartType = this.renderTypeRef(field.type);
            const opt = field.required ? '' : '?';
            emitter.line(`${dartType}${opt} ${field.name};`);
          }
          
          emitter.line();
          
          // Constructor
          const reqArgs = type.fields.filter(f => f.required).map(f => `required this.${f.name}`);
          const optArgs = type.fields.filter(f => !f.required).map(f => `this.${f.name}`);
          const allArgs = [...reqArgs, ...optArgs].join(', ');
          
          emitter.line(`${type.id}(${allArgs.length > 0 ? '{' + allArgs + '}' : ''});`);
          
          emitter.line();
          emitter.line(`// factory ${type.id}.fromJson(Map<String, dynamic> json) => _$${type.id}FromJson(json);`);
          emitter.line(`// Map<String, dynamic> toJson() => _$${type.id}ToJson(this);`);
        });
        break;

      case 'enum':
        emitter.block(`enum ${type.id} {`, `}`, () => {
          for (const v of type.values) {
             emitter.line(`${v.name},`);
          }
        });
        break;

      case 'array':
        emitter.line(`typedef ${type.id} = List<${this.renderTypeRef(type.items)}>;`);
        break;

      case 'scalar':
        emitter.line(`typedef ${type.id} = ${this.renderScalar(type.scalar)};`);
        break;
        
      default:
        emitter.line(`// TODO: Complex type ${type.id} of kind ${type.kind}`);
        emitter.line(`typedef ${type.id} = dynamic;`);
        break;
    }
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'dynamic';
    if (ref.ref) t = ref.ref;
    else if (ref.inline) {
      if (ref.inline.kind === 'scalar') t = this.renderScalar(ref.inline.scalar);
      else if (ref.inline.kind === 'array') t = `List<${this.renderTypeRef(ref.inline.items)}>`;
    }
    
    if (ref.isArray) t = `List<${t}>`;
    return t; 
  }

  private renderScalar(s: string): string {
    switch(s) {
      case 'integer':
      case 'bigint': return 'int';
      case 'number': return 'double';
      case 'boolean': return 'bool';
      case 'string':
      case 'date':
      case 'datetime':
      case 'uuid':
      case 'uri':
      case 'email': return 'String';
      case 'binary': return 'List<int>';
      default: return 'dynamic';
    }
  }

  private emitDoc(emitter: Emitter, text: string): void {
    for (const l of text.split('\n')) emitter.line(`/// ${l}`);
  }
}
