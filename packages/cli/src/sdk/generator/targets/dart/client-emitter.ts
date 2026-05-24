/**
 * Dart Client Emitter.
 * Emits HTTP client methods using the `http` package.
 */
import type { IRSchema, IREndpoint, IRTypeRef } from '../../ir/types';
import { Emitter } from '../../emitter';

export class DartClientEmitter {
  constructor(private schema: IRSchema, private className: string = 'ApiClient') {}

  emitAll(): string {
    const emitter = new Emitter('  ');

    emitter.line(`import 'dart:convert';`);
    emitter.line(`import 'package:http/http.dart' as http;`);
    emitter.line(`import 'types.dart';`);
    emitter.line();

    emitter.block(`class ${this.className} {`, `}`, () => {
      emitter.line(`final String baseUrl;`);
      emitter.line(`final String? token;`);
      emitter.line();
      
      emitter.block(`${this.className}({required this.baseUrl, this.token});`, ``, () => {});
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
    const methodName = ep.operationId.replace(/([A-Z])/g, '_$1').replace(/^_/, '').toLowerCase().replace(/_([a-z])/g, g => g[1].toUpperCase());
    
    let reqArgs = ep.pathParams.map(p => `required ${this.renderTypeRef(p.type)} ${p.name}`);
    let optArgs = ep.queryParams.map(p => `${this.renderTypeRef(p.type)}? ${p.name}`);
    if (ep.requestBody) reqArgs.push(`required ${this.renderTypeRef(ep.requestBody.type)} body`);

    const allArgs = [...reqArgs, ...optArgs].join(', ');
    const retType = this.buildResponseType(ep);
    
    emitter.block(`Future<${retType}> ${methodName}(${allArgs.length > 0 ? '{' + allArgs + '}' : ''}) async {`, `}`, () => {
      const method = ep.method?.toUpperCase() || 'GET';
      const pathTemplate = ep.path || '/';
      const pathExpr = pathTemplate.replace(/\{([^}]+)\}/g, '$$$1');
      
      emitter.line(`var uri = Uri.parse('$baseUrl${pathExpr}');`);
      
      emitter.line(`var headers = <String, String>{};`);
      emitter.block(`if (token != null) {`, `}`, () => {
        emitter.line(`headers['Authorization'] = 'Bearer $token';`);
      });
      
      if (ep.requestBody) {
         emitter.line(`headers['Content-Type'] = 'application/json';`);
      }
      
      emitter.line(`var response = await http.${method.toLowerCase()}(uri, headers: headers${ep.requestBody ? ', body: jsonEncode(body)' : ''});`);
      
      emitter.block(`if (response.statusCode >= 200 && response.statusCode < 300) {`, `}`, () => {
         if (retType !== 'void') {
            emitter.line(`// TODO: Parse JSON based on generated json_serializable factories`);
            emitter.line(`throw UnimplementedError('Parsing not fully implemented in MVP');`);
         }
      });
      emitter.block(`} else {`, `}`, () => {
         emitter.line(`throw Exception('Failed to load: \${response.statusCode}');`);
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
}
