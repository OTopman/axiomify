/**
 * TypeScript Type Emitter.
 *
 * Emits TypeScript interfaces, type aliases, and enums from IR nodes.
 */
import type { IRSchema, IRType, IRTypeRef } from '../../ir/types';
import { TypeGraph } from '../../ir/type-graph';
import { Emitter } from '../../emitter';

export class TsTypeEmitter {
  constructor(private schema: IRSchema, private graph: TypeGraph) {}

  emitAll(): string {
    const emitter = new Emitter();
    const sortedIds = this.graph.topologicalSort();

    // Import runtime types if needed (e.g. for binary/date handling)
    // emitter.line(`import type { Binary, DateTime } from '@axiomify/sdk-runtime';`);
    // emitter.line();

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
    if (type.description) this.emitDoc(emitter, type.description, type.deprecated);

    switch (type.kind) {
      case 'object':
        emitter.block(`export interface ${type.id} {`, `}`, () => {
          for (const field of type.fields) {
            if (field.description) this.emitDoc(emitter, field.description, field.deprecated);
            const q = field.required ? '' : '?';
            const ro = field.readOnly ? 'readonly ' : '';
            emitter.line(`${ro}${field.name}${q}: ${this.renderTypeRef(field.type)};`);
          }
          if (type.additionalProperties) {
            const valType = typeof type.additionalProperties === 'boolean'
              ? 'any'
              : this.renderTypeRef(type.additionalProperties);
            emitter.line(`[key: string]: ${valType};`);
          }
        });
        break;

      case 'enum':
        if (type.valueType === 'number') {
           // TypeScript enums with numeric values
           emitter.block(`export enum ${type.id} {`, `}`, () => {
              for (const v of type.values) {
                 if (v.description) this.emitDoc(emitter, v.description, v.deprecated);
                 emitter.line(`${v.name} = ${v.value},`);
              }
           });
        } else {
           // For string enums, union of string literals is often preferred in TS
           // for better compatibility with JSON, but `enum` works too.
           emitter.block(`export enum ${type.id} {`, `}`, () => {
              for (const v of type.values) {
                 if (v.description) this.emitDoc(emitter, v.description, v.deprecated);
                 // If name isn't a valid identifier, we might need quotes, but let's assume it is for now
                 emitter.line(`${v.name} = "${v.value}",`);
              }
           });
        }
        break;

      case 'union':
        emitter.line(`export type ${type.id} = ${type.members.map(m => this.renderTypeRef(m)).join(' | ')};`);
        break;

      case 'intersection':
        emitter.line(`export type ${type.id} = ${type.members.map(m => this.renderTypeRef(m)).join(' & ')};`);
        break;
        
      case 'array':
        emitter.line(`export type ${type.id} = ${this.renderTypeRef(type.items)}[];`);
        break;

      case 'scalar':
        emitter.line(`export type ${type.id} = ${this.renderScalar(type.scalar)};`);
        break;
        
      case 'map':
        emitter.line(`export type ${type.id} = Record<string, ${this.renderTypeRef(type.valueType)}>;`);
        break;

      case 'tuple':
        emitter.line(`export type ${type.id} = [${type.elements.map(e => this.renderTypeRef(e)).join(', ')}];`);
        break;

      case 'literal':
        const val = typeof type.value === 'string' ? `"${type.value}"` : String(type.value);
        emitter.line(`export type ${type.id} = ${val};`);
        break;
    }
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'any';
    if (ref.ref) t = ref.ref;
    else if (ref.inline) {
      if (ref.inline.kind === 'scalar') t = this.renderScalar(ref.inline.scalar);
      else if (ref.inline.kind === 'array') t = `${this.renderTypeRef(ref.inline.items)}[]`;
      // Other inlines should have been named by the normalizer, or we render them inline here.
      // For simplicity, fallback to any if not handled.
    }
    
    if (ref.isArray) t = `${t}[]`;
    if (ref.nullable) t = `${t} | null`;
    return t;
  }

  private renderScalar(s: string): string {
    switch(s) {
      case 'integer':
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'null': return 'null';
      case 'date':
      case 'datetime':
      case 'uuid':
      case 'uri':
      case 'email':
      case 'string': return 'string';
      case 'binary': return 'Blob'; // Or Uint8Array depending on runtime choice
      case 'bigint': return 'bigint';
      case 'void': return 'void';
      default: return 'any';
    }
  }

  private emitDoc(emitter: Emitter, text: string, deprecated?: boolean): void {
    emitter.line('/**');
    for (const l of text.split('\n')) {
      emitter.line(` * ${l}`);
    }
    if (deprecated) emitter.line(' * @deprecated');
    emitter.line(' */');
  }
}
