/**
 * TypeScript Zod Validator Emitter.
 *
 * Emits Zod validation schemas for all types in the IR schema.
 */
import type { IRSchema, IRType, IRTypeRef } from '../../../ir/types';
import { TypeGraph } from '../../../ir/type-graph';
import { Emitter } from '../../emitter';

export class TsValidatorEmitter {
  constructor(private schema: IRSchema, private graph: TypeGraph) {}

  emitAll(): string {
    const emitter = new Emitter();
    const sortedIds = this.graph.topologicalSort();

    emitter.line(`import { z } from 'zod';`);
    emitter.line();

    for (const id of sortedIds) {
      const type = this.schema.types.get(id);
      if (type) {
        this.emitValidator(emitter, type);
        emitter.line();
      }
    }

    return emitter.toString();
  }

  private emitValidator(emitter: Emitter, type: IRType): void {
    switch (type.kind) {
      case 'object':
        emitter.block(`export const ${type.id}Schema = z.object({`, `});`, () => {
          for (const field of type.fields) {
            const zodChain = this.renderZodChain(field.type);
            const req = field.required ? '' : '.optional()';
            emitter.line(`${field.name}: ${zodChain}${req},`);
          }
        });
        break;

      case 'enum':
        const valList = type.values.map((v: any) => typeof v.value === 'string' ? `"${v.value}"` : v.value).join(', ');
        emitter.line(`export const ${type.id}Schema = z.union([${type.values.map((v: any) => typeof v.value === 'string' ? `z.literal("${v.value}")` : `z.literal(${v.value})`).join(', ')}]);`);
        break;

      case 'union':
        emitter.line(`export const ${type.id}Schema = z.union([${type.members.map((m: any) => this.renderZodChain(m)).join(', ')}]);`);
        break;

      case 'intersection':
        emitter.line(`export const ${type.id}Schema = z.intersection(${type.members.map((m: any) => this.renderZodChain(m)).join(', ')});`);
        break;

      case 'array':
        emitter.line(`export const ${type.id}Schema = z.array(${this.renderZodChain(type.items)});`);
        break;

      case 'scalar':
        emitter.line(`export const ${type.id}Schema = ${this.renderScalarZod(type.scalar)};`);
        break;

      default:
        emitter.line(`export const ${type.id}Schema = z.any();`);
        break;
    }
  }

  private renderZodChain(ref: IRTypeRef): string {
    let t = 'z.any()';
    if (ref.ref) t = `${ref.ref}Schema`;
    else if (ref.inline) {
      if (ref.inline.kind === 'scalar') t = this.renderScalarZod(ref.inline.scalar);
      else if (ref.inline.kind === 'array') t = `z.array(${this.renderZodChain(ref.inline.items)})`;
    }
    if (ref.isArray) t = `z.array(${t})`;
    if (ref.nullable) t = `${t}.nullable()`;
    return t;
  }

  private renderScalarZod(s: string): string {
    switch (s) {
      case 'integer':
      case 'bigint':
      case 'number': return 'z.number()';
      case 'boolean': return 'z.boolean()';
      case 'null': return 'z.null()';
      case 'email': return 'z.string().email()';
      case 'uuid': return 'z.string().uuid()';
      case 'uri': return 'z.string().url()';
      case 'string':
      default: return 'z.string()';
    }
  }
}
