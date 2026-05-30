/**
 * Kotlin Client Emitter.
 * Emits suspending Retrofit interface and ApiClient wrapper.
 */
import type { IRSchema, IREndpoint, IRTypeRef } from '../../../ir/types';
import { Emitter } from '../../emitter';

export class KotlinClientEmitter {
  constructor(
    private schema: IRSchema,
    private pkgName: string,
    private className: string = 'ApiClient',
  ) {}

  emitAll(): string {
    const emitter = new Emitter('    ');

    emitter.line(`package ${this.pkgName}`);
    emitter.line();
    emitter.line(`import okhttp3.OkHttpClient`);
    emitter.line(`import retrofit2.Retrofit`);
    emitter.line(
      `import retrofit2.converter.kotlinx.serialization.asConverterFactory`,
    );
    emitter.line(`import retrofit2.http.*`);
    emitter.line(`import kotlinx.serialization.json.Json`);
    emitter.line(`import okhttp3.MediaType.Companion.toMediaType`);
    emitter.line();

    // Emitting the Retrofit API Interface
    emitter.block(`interface ApiService {`, `}`, () => {
      for (const ep of this.schema.endpoints) {
        if (ep.transport !== 'rest') continue;
        this.emitRetrofitMethod(emitter, ep);
        emitter.line();
      }
    });
    emitter.line();

    // Emitting the ApiClient wrapper
    emitter.block(
      `class ${this.className}(private val baseUrl: String, private val token: String? = null) {`,
      `}`,
      () => {
        emitter.block(
          `private val client = OkHttpClient.Builder().apply {`,
          `}.build()`,
          () => {
            emitter.block(`if (token != null) {`, `}`, () => {
              emitter.block(`addInterceptor { chain ->`, `}`, () => {
                emitter.line(`val request = chain.request().newBuilder()`);
                emitter.line(`    .header("Authorization", "Bearer \$token")`);
                emitter.line(`    .build()`);
                emitter.line(`chain.proceed(request)`);
              });
            });
          },
        );
        emitter.line();

        emitter.block(
          `private val retrofit = Retrofit.Builder()`,
          `.build()`,
          () => {
            emitter.line(`.baseUrl(baseUrl)`);
            emitter.line(`.client(client)`);
            emitter.line(
              `.addConverterFactory(Json.asConverterFactory("application/json".toMediaType()))`,
            );
          },
        );
        emitter.line();

        emitter.line(
          `val api: ApiService = retrofit.create(ApiService::class.java)`,
        );
      },
    );

    return emitter.toString();
  }

  private emitRetrofitMethod(emitter: Emitter, ep: IREndpoint): void {
    const method = ep.method?.toUpperCase() || 'GET';
    const pathTemplate = ep.path || '/';
    // Path parameter replacements for Retrofit: {id} -> {id}
    const pathExpr = pathTemplate.replace(/\{([^}]+)\}/g, '{$1}');

    emitter.line(`@${method}("${pathExpr}")`);

    const methodName = this.toCamelCase(ep.operationId);
    const args = [];
    for (const p of ep.pathParams) {
      args.push(
        `@Path("${p.name}") ${this.toCamelCase(p.name)}: ${this.renderTypeRef(p.type)}`,
      );
    }
    for (const p of ep.queryParams) {
      const defaultValue = p.required ? '' : '? = null';
      args.push(
        `@Query("${p.name}") ${this.toCamelCase(p.name)}: ${this.renderTypeRef(p.type)}${defaultValue}`,
      );
    }
    if (ep.requestBody) {
      args.push(`@Body body: ${this.renderTypeRef(ep.requestBody.type)}`);
    }

    const retType = this.buildResponseType(ep);

    emitter.line(`suspend fun ${methodName}(${args.join(', ')}): ${retType}`);
  }

  private buildResponseType(ep: IREndpoint): string {
    const success = ep.successResponse;
    if (success && ep.responses[success]) {
      const typeRef = ep.responses[success].type;
      if (typeRef) return this.renderTypeRef(typeRef);
    }
    return 'Unit';
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'Any';
    if (ref.ref) t = ref.ref;
    else if (ref.inline && ref.inline.kind === 'scalar') {
      if (ref.inline.scalar === 'integer') t = 'Int';
      else if (ref.inline.scalar === 'number') t = 'Double';
      else if (ref.inline.scalar === 'boolean') t = 'Boolean';
      else t = 'String';
    }
    if (ref.isArray) t = `List<${t}>`;
    return t;
  }

  private toCamelCase(str: string): string {
    return str
      .replace(/_([a-z])/g, (_, c) => c.toUpperCase())
      .replace(/^[A-Z]/, (c) => c.toLowerCase());
  }
}
