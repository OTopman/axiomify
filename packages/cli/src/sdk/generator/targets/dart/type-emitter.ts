/**
 * Dart Type Emitter.
 * Emits Dart classes with Freezed and JsonSerializable support.
 */
import type { IRSchema, IRType, IRTypeRef } from '../../../ir/types';
import { TypeGraph } from '../../../ir/type-graph';
import { Emitter } from '../../emitter';

export class DartTypeEmitter {
  constructor(private schema: IRSchema, private graph: TypeGraph) {}

  emitAll(): string {
    const emitter = new Emitter('  ');
    const sortedIds = this.graph.topologicalSort();

    emitter.line(`// GENERATED CODE - DO NOT MODIFY BY HAND`);
    emitter.line();
    emitter.line(`import 'package:freezed_annotation/freezed_annotation.dart';`);
    emitter.line();
    emitter.line(`part 'types.freezed.dart';`);
    emitter.line(`part 'types.g.dart';`);
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
        emitter.line(`@freezed`);
        emitter.block(`class ${type.id} with _\$${type.id} {`, `}`, () => {
          emitter.block(`const factory ${type.id}({`, `}) = _${type.id};`, () => {
            for (const field of type.fields) {
              if (field.description) this.emitDoc(emitter, field.description);
              
              const dartType = this.renderTypeRef(field.type);
              const opt = field.required ? '' : '?';
              const req = field.required ? 'required ' : '';
              
              // Handle field name mapping
              if (field.name !== this.toCamelCase(field.name)) {
                emitter.line(`@JsonKey(name: '${field.name}')`);
              }
              emitter.line(`${req}${dartType}${opt} ${this.toCamelCase(field.name)},`);
            }
          });
          
          emitter.line();
          emitter.line(`factory ${type.id}.fromJson(Map<String, dynamic> json) => _\$${type.id}FromJson(json);`);
        });
        break;

      case 'enum':
        emitter.block(`enum ${type.id} {`, `}`, () => {
          for (const v of type.values) {
            emitter.line(`@JsonValue(${typeof v.value === 'string' ? `'${v.value}'` : v.value})`);
            emitter.line(`${this.toCamelCase(v.name)},`);
          }
        });
        break;

      case 'union':
        // Dart representation of a union: we can emit a freezed sealed union
        emitter.line(`@freezed`);
        emitter.block(`class ${type.id} with _\$${type.id} {`, `}`, () => {
          // If a discriminator exists, we can generate constructors for each member
          for (let i = 0; i < type.members.length; i++) {
            const member = type.members[i];
            const name = member.ref ? member.ref : `Value${i}`;
            const memberType = this.renderTypeRef(member);
            emitter.line(`const factory ${type.id}.${this.toCamelCase(name)}(${memberType} value) = _${type.id}${name};`);
          }
          emitter.line();
          emitter.line(`factory ${type.id}.fromJson(Map<String, dynamic> json) => _\$${type.id}FromJson(json);`);
        });
        break;

      case 'intersection':
        // Represent intersection as a general class or Map
        emitter.line(`typedef ${type.id} = Map<String, dynamic>;`);
        break;

      case 'array':
        emitter.line(`typedef ${type.id} = List<${this.renderTypeRef(type.items)}>;`);
        break;

      case 'scalar':
        emitter.line(`typedef ${type.id} = ${this.renderScalar(type.scalar)};`);
        break;

      case 'map':
        emitter.line(`typedef ${type.id} = Map<String, ${this.renderTypeRef(type.valueType)}>;`);
        break;

      case 'tuple':
        emitter.line(`typedef ${type.id} = List<dynamic>; // Tuple`);
        break;

      case 'literal':
        emitter.line(`typedef ${type.id} = dynamic; // Literal: ${type.value}`);
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

  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
              .replace(/^[A-Z]/, (c) => c.toLowerCase());
  }

  private emitDoc(emitter: Emitter, text: string): void {
    for (const l of text.split('\n')) emitter.line(`/// ${l}`);
  }
}
