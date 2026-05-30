/**
 * Kotlin Type Emitter.
 * Emits Kotlin data classes with kotlinx.serialization support.
 */
import type { IRSchema, IRType, IRTypeRef } from '../../../ir/types';
import { TypeGraph } from '../../../ir/type-graph';
import { Emitter } from '../../emitter';

export class KotlinTypeEmitter {
  constructor(
    private schema: IRSchema,
    private graph: TypeGraph,
    private pkgName: string,
  ) {}

  emitAll(): string {
    const emitter = new Emitter('    ');
    const sortedIds = this.graph.topologicalSort();

    emitter.line(`package ${this.pkgName}`);
    emitter.line();
    emitter.line(`import kotlinx.serialization.Serializable`);
    emitter.line(`import kotlinx.serialization.SerialName`);
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
        emitter.line(`@Serializable`);
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

            // Map serial name if not simple matching identifier
            emitter.line(
              `@SerialName("${field.name}") val ${this.toCamelCase(field.name)}: ${ktType}${opt}${comma}`,
            );
          }
        });
        break;

      case 'enum':
        emitter.line(`@Serializable`);
        emitter.block(`enum class ${type.id} {`, `}`, () => {
          for (const v of type.values) {
            emitter.line(
              `@SerialName("${v.value}") ${this.toUpperSnakeCase(v.name)},`,
            );
          }
        });
        break;

      case 'union':
        // Kotlin representing union: typically a sealed class/interface
        emitter.line(`@Serializable`);
        emitter.block(`sealed interface ${type.id} {`, `}`, () => {
          for (let i = 0; i < type.members.length; i++) {
            const member = type.members[i];
            const name = member.ref ? member.ref : `Value${i}`;
            const memberType = this.renderTypeRef(member);
            emitter.line(`@Serializable`);
            emitter.line(
              `data class ${name}(val value: ${memberType}): ${type.id}`,
            );
          }
        });
        break;

      case 'intersection':
        emitter.line(
          `typealias ${type.id} = Map<String, kotlinx.serialization.json.JsonElement>`,
        );
        break;

      case 'array':
        emitter.line(
          `typealias ${type.id} = List<${this.renderTypeRef(type.items)}>`,
        );
        break;

      case 'scalar':
        emitter.line(
          `typealias ${type.id} = ${this.renderScalar(type.scalar)}`,
        );
        break;

      case 'map':
        emitter.line(
          `typealias ${type.id} = Map<String, ${this.renderTypeRef(type.valueType)}>`,
        );
        break;

      case 'tuple':
        emitter.line(
          `typealias ${type.id} = List<kotlinx.serialization.json.JsonElement>`,
        );
        break;

      case 'literal':
        emitter.line(
          `typealias ${type.id} = kotlinx.serialization.json.JsonPrimitive`,
        );
        break;
    }
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'Any';
    if (ref.ref) t = ref.ref;
    else if (ref.inline) {
      if (ref.inline.kind === 'scalar')
        t = this.renderScalar(ref.inline.scalar);
      else if (ref.inline.kind === 'array')
        t = `List<${this.renderTypeRef(ref.inline.items)}>`;
    }

    if (ref.isArray) t = `List<${t}>`;
    return t;
  }

  private renderScalar(s: string): string {
    switch (s) {
      case 'integer':
        return 'Int';
      case 'bigint':
        return 'Long';
      case 'number':
        return 'Double';
      case 'boolean':
        return 'Boolean';
      case 'string':
      case 'date':
      case 'datetime':
      case 'uuid':
      case 'uri':
      case 'email':
        return 'String';
      case 'binary':
        return 'ByteArray';
      default:
        return 'kotlinx.serialization.json.JsonElement';
    }
  }

  private toCamelCase(str: string): string {
    return str
      .replace(/_([a-z])/g, (_, c) => c.toUpperCase())
      .replace(/^[A-Z]/, (c) => c.toLowerCase());
  }

  private toUpperSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toUpperCase()
      .replace(/^_/, '');
  }

  private emitDoc(emitter: Emitter, text: string): void {
    emitter.line('/**');
    for (const l of text.split('\n')) emitter.line(` * ${l}`);
    emitter.line(' */');
  }
}
