/**
 * Dart Client Emitter.
 * Emits HTTP client methods using the `dio` package and exposes Riverpod providers.
 */
import type { IRSchema, IREndpoint, IRTypeRef } from '../../../ir/types';
import { Emitter } from '../../emitter';

export class DartClientEmitter {
  constructor(private schema: IRSchema, private className: string = 'ApiClient') {}

  emitAll(): string {
    const emitter = new Emitter('  ');

    emitter.line(`import 'package:dio/dio.dart';`);
    emitter.line(`import 'package:riverpod/riverpod.dart';`);
    emitter.line(`import 'types.dart';`);
    emitter.line();

    // Provider definition
    emitter.line(`final apiClientProvider = Provider<${this.className}>((ref) {`);
    emitter.line(`  throw UnimplementedError('Configure and override apiClientProvider in your provider container');`);
    emitter.line(`});`);
    emitter.line();

    emitter.block(`class ${this.className} {`, `}`, () => {
      emitter.line(`final Dio _dio;`);
      emitter.line();
      
      emitter.block(`${this.className}({required String baseUrl, String? token, Dio? dio}) : _dio = dio ?? Dio(BaseOptions(baseUrl: baseUrl)) {`, `}`, () => {
        emitter.block(`if (token != null) {`, `}`, () => {
          emitter.line(`_dio.options.headers['Authorization'] = 'Bearer \$token';`);
        });
      });
      emitter.line();

      for (const ep of this.schema.endpoints) {
        if (ep.transport !== 'rest') continue;
        this.emitMethod(emitter, ep);
        emitter.line();
      }
    });

    return emitter.toString();
  }

  private emitMethod(emitter: Emitter, ep: IREndpoint): void {
    const methodName = this.toCamelCase(ep.operationId);
    
    let reqArgs = ep.pathParams.map((p: any) => `required ${this.renderTypeRef(p.type)} ${this.toCamelCase(p.name)}`);
    let optArgs = ep.queryParams.map((p: any) => `${this.renderTypeRef(p.type)}? ${this.toCamelCase(p.name)}`);
    if (ep.requestBody) reqArgs.push(`required ${this.renderTypeRef(ep.requestBody.type)} body`);

    const allArgs = [...reqArgs, ...optArgs].join(', ');
    const retType = this.buildResponseType(ep);
    
    emitter.block(`Future<${retType}> ${methodName}(${allArgs.length > 0 ? '{' + allArgs + '}' : ''}) async {`, `}`, () => {
      const method = ep.method?.toUpperCase() || 'GET';
      const pathTemplate = ep.path || '/';
      
      let pathExpr = pathTemplate;
      for (const p of ep.pathParams) {
        pathExpr = pathExpr.replace(`{${p.name}}`, `\$${this.toCamelCase(p.name)}`);
      }
      
      if (ep.queryParams.length > 0) {
        emitter.line(`final queryParameters = <String, dynamic>{`);
        for (const q of ep.queryParams) {
          emitter.line(`  '${q.name}': ${this.toCamelCase(q.name)},`);
        }
        emitter.line(`};`);
      }

      emitter.block(`try {`, `}`, () => {
        const queryArg = ep.queryParams.length > 0 ? ', queryParameters: queryParameters' : '';
        const bodyArg = ep.requestBody ? ', data: body.toJson()' : '';

        emitter.line(`final response = await _dio.request(`);
        emitter.line(`  '${pathExpr}',`);
        emitter.line(`  options: Options(method: '${method}'),`);
        emitter.line(`  ${queryArg}${bodyArg}`);
        emitter.line(`);`);

        if (retType !== 'void') {
          const success = ep.successResponse;
          const ref = success && ep.responses[success]?.type?.ref;
          if (ref) {
            if (ep.responses[success].type?.isArray) {
              emitter.line(`return (response.data as List).map((e) => ${ref}.fromJson(e as Map<String, dynamic>)).toList();`);
            } else {
              emitter.line(`return ${ref}.fromJson(response.data as Map<String, dynamic>);`);
            }
          } else {
            emitter.line(`return response.data;`);
          }
        }
      });
      emitter.block(`on DioException catch (e) {`, `}`, () => {
        emitter.line(`throw Exception('Request ${methodName} failed: \${e.message}');`);
      });
    });
  }

  private buildResponseType(ep: IREndpoint): string {
    const success = ep.successResponse;
    if (success && ep.responses[success]) {
      const typeRef = ep.responses[success].type;
      if (typeRef) return this.renderTypeRef(typeRef);
    }
    return 'void';
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'dynamic';
    if (ref.ref) t = ref.ref;
    else if (ref.inline && ref.inline.kind === 'scalar') {
       if (ref.inline.scalar === 'integer') t = 'int';
       else if (ref.inline.scalar === 'number') t = 'double';
       else if (ref.inline.scalar === 'boolean') t = 'bool';
       else t = 'String';
    }
    if (ref.isArray) t = `List<${t}>`;
    return t;
  }

  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
              .replace(/^[A-Z]/, (c) => c.toLowerCase());
  }
}
