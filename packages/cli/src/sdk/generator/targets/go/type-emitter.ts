/**
 * Go Type Emitter.
 * Emits Go structs with JSON tags.
 */
import type { IRSchema, IRType, IRTypeRef } from '../../ir/types';
import { TypeGraph } from '../../ir/type-graph';
import { Emitter } from '../../emitter';

export class GoTypeEmitter {
  constructor(private schema: IRSchema, private graph: TypeGraph, private pkgName: string) {}

  emitAll(): string {
    const emitter = new Emitter('\t');
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
        emitter.block(`type ${type.id} struct {`, `}`, () => {
          for (const field of type.fields) {
            if (field.description) this.emitDoc(emitter, field.description);
            const goType = this.renderTypeRef(field.type);
            const tag = field.required ? `\`json:"${field.name}"\`` : `\`json:"${field.name},omitempty"\``;
            emitter.line(`${this.capitalize(field.name)} ${goType} ${tag}`);
          }
          if (type.additionalProperties) {
             emitter.line(`AdditionalProperties map[string]interface{} \`json:"-"\``);
          }
        });
        break;

      case 'enum':
        const baseType = type.valueType === 'number' ? 'float64' : 'string';
        emitter.line(`type ${type.id} ${baseType}`);
        emitter.block(`const (`, `)`, () => {
           for (const v of type.values) {
              const val = typeof v.value === 'string' ? `"${v.value}"` : v.value;
              emitter.line(`${type.id}_${this.capitalize(v.name)} ${type.id} = ${val}`);
           }
        });
        break;

      case 'array':
        emitter.line(`type ${type.id} []${this.renderTypeRef(type.items)}`);
        break;

      case 'scalar':
        emitter.line(`type ${type.id} ${this.renderScalar(type.scalar)}`);
        break;
        
      default:
        // Union, intersection, etc require custom unmarshalers in Go
        emitter.line(`// TODO: Complex type ${type.id} of kind ${type.kind}`);
        emitter.line(`type ${type.id} interface{}`);
        break;
    }
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'interface{}';
    if (ref.ref) t = ref.ref;
    else if (ref.inline) {
      if (ref.inline.kind === 'scalar') t = this.renderScalar(ref.inline.scalar);
      else if (ref.inline.kind === 'array') t = `[]${this.renderTypeRef(ref.inline.items)}`;
    }
    
    if (ref.isArray) t = `[]${t}`;
    if (ref.nullable) t = `*${t}`;
    return t;
  }

  private renderScalar(s: string): string {
    switch(s) {
      case 'integer': return 'int';
      case 'bigint': return 'int64';
      case 'number': return 'float64';
      case 'boolean': return 'bool';
      case 'string':
      case 'date':
      case 'datetime':
      case 'uuid':
      case 'uri':
      case 'email': return 'string';
      case 'binary': return '[]byte';
      default: return 'interface{}';
    }
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  private emitDoc(emitter: Emitter, text: string): void {
    for (const l of text.split('\n')) emitter.line(`// ${l}`);
  }
}
