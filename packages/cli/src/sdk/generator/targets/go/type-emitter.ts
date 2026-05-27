/**
 * Go Type Emitter.
 * Emits Go structs with JSON tags, and custom Marshal/Unmarshal for unions.
 */
import type { IRSchema, IRType, IRTypeRef } from '../../../ir/types';
import { TypeGraph } from '../../../ir/type-graph';
import { Emitter } from '../../emitter';

export class GoTypeEmitter {
  constructor(private schema: IRSchema, private graph: TypeGraph, private pkgName: string) {}

  emitAll(): string {
    const emitter = new Emitter('\t');
    const sortedIds = this.graph.topologicalSort();

    emitter.line(`package ${this.pkgName}`);
    emitter.line();
    emitter.line(`import (`);
    emitter.line(`\t"encoding/json"`);
    emitter.line(`\t"errors"`);
    emitter.line(`)`);
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

      case 'union':
        // Custom union struct in Go
        emitter.block(`type ${type.id} struct {`, `}`, () => {
          emitter.line(`Value interface{}`);
        });
        emitter.line();
        // Custom MarshalJSON
        emitter.block(`func (u ${type.id}) MarshalJSON() ([]byte, error) {`, `}`, () => {
          emitter.line(`return json.Marshal(u.Value)`);
        });
        emitter.line();
        // Custom UnmarshalJSON
        emitter.block(`func (u *${type.id}) UnmarshalJSON(data []byte) error {`, `}`, () => {
          for (let i = 0; i < type.members.length; i++) {
            const member = type.members[i];
            const memberType = this.renderTypeRef(member);
            emitter.line(`var val${i} ${memberType}`);
            emitter.block(`if err := json.Unmarshal(data, &val${i}); err == nil {`, `}`, () => {
              emitter.line(`u.Value = val${i}`);
              emitter.line(`return nil`);
            });
          }
          emitter.line(`return errors.New("cannot unmarshal into any union member of ${type.id}")`);
        });
        break;

      case 'intersection':
        emitter.line(`type ${type.id} map[string]interface{}`);
        break;

      case 'array':
        emitter.line(`type ${type.id} []${this.renderTypeRef(type.items)}`);
        break;

      case 'scalar':
        emitter.line(`type ${type.id} ${this.renderScalar(type.scalar)}`);
        break;
        
      default:
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
