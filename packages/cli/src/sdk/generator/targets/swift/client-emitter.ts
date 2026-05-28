/**
 * Swift Client Emitter.
 * Emits URLSession async/await methods in idiomatic camelCase.
 */
import type { IRSchema, IREndpoint, IRTypeRef } from '../../../ir/types';
import { Emitter } from '../../emitter';

export class SwiftClientEmitter {
  constructor(private schema: IRSchema, private className: string = 'ApiClient') {}

  emitAll(): string {
    const emitter = new Emitter('    ');

    emitter.line(`import Foundation`);
    emitter.line();

    emitter.block(`public class ${this.className} {`, `}`, () => {
      emitter.line(`public let baseURL: URL`);
      emitter.line(`public var token: String?`);
      emitter.line(`private let session: URLSession`);
      emitter.line();
      
      emitter.block(`public init(baseURL: URL, token: String? = nil, session: URLSession = .shared) {`, `}`, () => {
        emitter.line(`self.baseURL = baseURL`);
        emitter.line(`self.token = token`);
        emitter.line(`self.session = session`);
      });

      for (const ep of this.schema.endpoints) {
        if (ep.transport !== 'rest') continue;
        emitter.line();
        this.emitMethod(emitter, ep);
      }
    });

    return emitter.toString();
  }

  private emitMethod(emitter: Emitter, ep: IREndpoint): void {
    const methodName = this.toCamelCase(ep.operationId);
    
    let args = [];
    for (const p of ep.pathParams) {
      args.push(`${this.toCamelCase(p.name)}: ${this.renderTypeRef(p.type)}`);
    }
    for (const p of ep.queryParams) {
      args.push(`${this.toCamelCase(p.name)}: ${this.renderTypeRef(p.type)}? = nil`);
    }
    if (ep.requestBody) {
      args.push(`body: ${this.renderTypeRef(ep.requestBody.type)}`);
    }

    const retType = this.buildResponseType(ep);
    
    emitter.block(`public func ${methodName}(${args.join(', ')}) async throws -> ${retType} {`, `}`, () => {
      const method = ep.method?.toUpperCase() || 'GET';
      const pathTemplate = ep.path || '/';
      
      // Path parameter replacement: e.g. {userId} -> \(userId)
      let pathExpr = pathTemplate;
      for (const p of ep.pathParams) {
        pathExpr = pathExpr.replace(`{${p.name}}`, `\\(${this.toCamelCase(p.name)})`);
      }
      
      emitter.line(`var components = URLComponents(url: baseURL.appendingPathComponent("${pathExpr}"), resolvingAgainstBaseURL: true)!`);
      
      if (ep.queryParams.length > 0) {
        emitter.line(`var queryItems: [URLQueryItem] = []`);
        for (const q of ep.queryParams) {
          const camelName = this.toCamelCase(q.name);
          emitter.block(`if let val = ${camelName} {`, `}`, () => {
            emitter.line(`queryItems.append(URLQueryItem(name: "${q.name}", value: String(describing: val)))`);
          });
        }
        emitter.line(`components.queryItems = queryItems.isEmpty ? nil : queryItems`);
      }
      
      emitter.line(`var request = URLRequest(url: components.url!)`);
      emitter.line(`request.httpMethod = "${method}"`);
      
      emitter.block(`if let token = self.token {`, `}`, () => {
        emitter.line(`request.addValue("Bearer \\(token)", forHTTPHeaderField: "Authorization")`);
      });
      
      if (ep.requestBody) {
        emitter.line(`request.addValue("application/json", forHTTPHeaderField: "Content-Type")`);
        emitter.line(`request.httpBody = try JSONEncoder().encode(body)`);
      }

      emitter.line(`let (data, response) = try await session.data(for: request)`);
      emitter.block('guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {', '}', () => {
        emitter.line('throw URLError(.badServerResponse)');
      });
      
      if (retType !== 'Void') {
        emitter.line(`return try JSONDecoder().decode(${retType}.self, from: data)`);
      }
    });
  }

  private buildResponseType(ep: IREndpoint): string {
    const success = ep.successResponse;
    if (success && ep.responses[success]) {
      const typeRef = ep.responses[success].type;
      if (typeRef) return this.renderTypeRef(typeRef);
    }
    return 'Void';
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'AnyCodable';
    if (ref.ref) t = ref.ref;
    else if (ref.inline && ref.inline.kind === 'scalar') {
       if (ref.inline.scalar === 'integer' || ref.inline.scalar === 'number') t = 'Double';
       else if (ref.inline.scalar === 'boolean') t = 'Bool';
       else t = 'String';
    }
    if (ref.isArray) t = `[${t}]`;
    return t;
  }

  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
              .replace(/^[A-Z]/, (c) => c.toLowerCase());
  }
}
