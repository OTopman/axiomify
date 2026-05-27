/**
 * Swift Type Emitter.
 * Emits Swift Codable structs with custom CodingKeys mapping.
 */
import type { IRSchema, IRType, IRTypeRef } from '../../../ir/types';
import { TypeGraph } from '../../../ir/type-graph';
import { Emitter } from '../../emitter';

export class SwiftTypeEmitter {
  constructor(private schema: IRSchema, private graph: TypeGraph) {}

  emitAll(): string {
    const emitter = new Emitter('    ');
    const sortedIds = this.graph.topologicalSort();

    emitter.line(`import Foundation`);
    emitter.line();

    // Emit AnyCodable implementation for custom scalar/fallback schemas
    this.emitAnyCodable(emitter);
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
          // 1. Declare fields
          for (const field of type.fields) {
            if (field.description) this.emitDoc(emitter, field.description);
            const swiftType = this.renderTypeRef(field.type);
            const opt = field.required ? '' : '?';
            emitter.line(`public var ${this.toCamelCase(field.name)}: ${swiftType}${opt}`);
          }

          // 2. Declare CodingKeys
          const needsCustomCodingKeys = type.fields.some(f => f.name !== this.toCamelCase(f.name));
          if (needsCustomCodingKeys && type.fields.length > 0) {
            emitter.line();
            emitter.block(`enum CodingKeys: String, CodingKey {`, `}`, () => {
              for (const field of type.fields) {
                emitter.line(`case ${this.toCamelCase(field.name)} = "${field.name}"`);
              }
            });
          }
        });
        break;

      case 'enum':
        const rawType = type.valueType === 'number' ? 'Int' : 'String';
        emitter.block(`public enum ${type.id}: ${rawType}, Codable {`, `}`, () => {
          for (const v of type.values) {
            const val = typeof v.value === 'string' ? `"${v.value}"` : v.value;
            emitter.line(`case ${this.toCamelCase(v.name)} = ${val}`);
          }
        });
        break;

      case 'union':
        // Represents union: Swift enum with associated values
        emitter.block(`public enum ${type.id}: Codable {`, `}`, () => {
          for (let i = 0; i < type.members.length; i++) {
            const member = type.members[i];
            const name = member.ref ? member.ref : `value${i}`;
            const memberType = this.renderTypeRef(member);
            emitter.line(`case ${this.toCamelCase(name)}(${memberType})`);
          }
          
          emitter.line();
          // Custom Codable implementation for associated value enum
          emitter.block(`public init(from decoder: Decoder) throws {`, `}`, () => {
            emitter.line(`let container = try decoder.singleValueContainer()`);
            for (let i = 0; i < type.members.length; i++) {
              const member = type.members[i];
              const name = member.ref ? member.ref : `value${i}`;
              const memberType = this.renderTypeRef(member);
              emitter.block(`if let value = try? container.decode(${memberType}.self) {`, `}`, () => {
                emitter.line(`self = .${this.toCamelCase(name)}(value)`);
                emitter.line(`return`);
              });
            }
            emitter.line(`throw DecodingError.typeMismatch(${type.id}.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "No matching union type"))`);
          });

          emitter.line();
          emitter.block(`public func encode(to encoder: Encoder) throws {`, `}`, () => {
            emitter.line(`var container = encoder.singleValueContainer()`);
            emitter.block(`switch self {`, `}`, () => {
              for (let i = 0; i < type.members.length; i++) {
                const member = type.members[i];
                const name = member.ref ? member.ref : `value${i}`;
                emitter.block(`case .${this.toCamelCase(name)}(let value):`, ``, () => {
                  emitter.line(`try container.encode(value)`);
                });
              }
            });
          });
        });
        break;

      case 'intersection':
        emitter.line(`public typealias ${type.id} = [String: AnyCodable]`);
        break;

      case 'array':
        emitter.line(`public typealias ${type.id} = [${this.renderTypeRef(type.items)}]`);
        break;

      case 'scalar':
        emitter.line(`public typealias ${type.id} = ${this.renderScalar(type.scalar)}`);
        break;

      case 'map':
        emitter.line(`public typealias ${type.id} = [String: ${this.renderTypeRef(type.valueType)}]`);
        break;

      case 'tuple':
        emitter.line(`public typealias ${type.id} = [AnyCodable]`);
        break;

      case 'literal':
        emitter.line(`public typealias ${type.id} = AnyCodable // Literal: ${type.value}`);
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
    return t;
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

  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
              .replace(/^[A-Z]/, (c) => c.toLowerCase());
  }

  private emitDoc(emitter: Emitter, text: string): void {
    for (const l of text.split('\n')) emitter.line(`/// ${l}`);
  }

  private emitAnyCodable(emitter: Emitter): void {
    emitter.line(`public struct AnyCodable: Codable {`);
    emitter.line(`    public let value: Any`);
    emitter.line(`    public init(_ value: Any) { self.value = value }`);
    emitter.line(`    public init(from decoder: Decoder) throws {`);
    emitter.line(`        let container = try decoder.singleValueContainer()`);
    emitter.line(`        if let x = try? container.decode(Bool.self) { self.value = x }`);
    emitter.line(`        else if let x = try? container.decode(Int.self) { self.value = x }`);
    emitter.line(`        else if let x = try? container.decode(Double.self) { self.value = x }`);
    emitter.line(`        else if let x = try? container.decode(String.self) { self.value = x }`);
    emitter.line(`        else if let x = try? container.decode([String: AnyCodable].self) { self.value = x.mapValues { \$0.value } }`);
    emitter.line(`        else if let x = try? container.decode([AnyCodable].self) { self.value = x.map { \$0.value } }`);
    emitter.line(`        else { throw DecodingError.typeMismatch(AnyCodable.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type")) }`);
    emitter.line(`    }`);
    emitter.line(`    public func encode(to encoder: Encoder) throws {`);
    emitter.line(`        var container = encoder.singleValueContainer()`);
    emitter.line(`        if let x = value as? Bool { try container.encode(x) }`);
    emitter.line(`        else if let x = value as? Int { try container.encode(x) }`);
    emitter.line(`        else if let x = value as? Double { try container.encode(x) }`);
    emitter.line(`        else if let x = value as? String { try container.encode(x) }`);
    emitter.line(`        else if let x = value as? [String: Any] { try container.encode(x.mapValues { AnyCodable(\$0) }) }`);
    emitter.line(`        else if let x = value as? [Any] { try container.encode(x.map { AnyCodable(\$0) }) }`);
    emitter.line(`    }`);
    emitter.line(`}`);
  }
}
