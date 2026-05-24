/**
 * Go Client Emitter.
 * Emits a net/http client struct with methods.
 */
import type { IRSchema, IREndpoint, IRTypeRef } from '../../ir/types';
import { Emitter } from '../../emitter';

export class GoClientEmitter {
  constructor(private schema: IRSchema, private pkgName: string) {}

  emitAll(): string {
    const emitter = new Emitter('\t');

    emitter.line(`package ${this.pkgName}`);
    emitter.line();
    emitter.line(`import (`);
    emitter.line(`\t"bytes"`);
    emitter.line(`\t"context"`);
    emitter.line(`\t"encoding/json"`);
    emitter.line(`\t"fmt"`);
    emitter.line(`\t"net/http"`);
    emitter.line(`\t"net/url"`);
    emitter.line(`)`);
    emitter.line();

    emitter.block(`type Client struct {`, `}`, () => {
      emitter.line(`BaseURL string`);
      emitter.line(`HTTPClient *http.Client`);
      emitter.line(`Token string`);
    });
    emitter.line();
    
    emitter.block(`func NewClient(baseURL string) *Client {`, `}`, () => {
      emitter.line(`return &Client{BaseURL: baseURL, HTTPClient: &http.Client{}}`);
    });
    emitter.line();

    for (const ep of this.schema.endpoints) {
      if (ep.transport !== 'rest') continue;
      this.emitMethod(emitter, ep);
      emitter.line();
    }

    return emitter.toString();
  }

  private emitMethod(emitter: Emitter, ep: IREndpoint): void {
    const methodName = ep.operationId.charAt(0).toUpperCase() + ep.operationId.slice(1);
    
    // We'll bundle params into a Request struct if there are any
    const reqStructName = `${methodName}Request`;
    const hasParams = ep.pathParams.length > 0 || ep.queryParams.length > 0 || ep.requestBody;
    
    if (hasParams) {
       emitter.block(`type ${reqStructName} struct {`, `}`, () => {
          for (const p of ep.pathParams) {
             emitter.line(`${this.capitalize(p.name)} ${this.renderTypeRef(p.type)}`);
          }
          for (const p of ep.queryParams) {
             emitter.line(`${this.capitalize(p.name)} ${this.renderTypeRef(p.type)}`);
          }
          if (ep.requestBody) {
             emitter.line(`Body ${this.renderTypeRef(ep.requestBody.type)}`);
          }
       });
       emitter.line();
    }

    const retType = this.buildResponseType(ep);
    const args = hasParams ? `req *${reqStructName}` : ``;
    
    emitter.block(`func (c *Client) ${methodName}(ctx context.Context${hasParams ? ', ' + args : ''}) (*${retType}, error) {`, `}`, () => {
      const method = ep.method?.toUpperCase() || 'GET';
      const pathTemplate = ep.path || '/';
      // In Go, we'd use fmt.Sprintf for path params. Simplification here:
      emitter.line(`reqURL := c.BaseURL + "${pathTemplate}"`); // TODO: inject path params
      
      if (ep.requestBody) {
         emitter.line(`bodyBytes, err := json.Marshal(req.Body)`);
         emitter.line(`if err != nil { return nil, err }`);
         emitter.line(`httpReq, err := http.NewRequestWithContext(ctx, "${method}", reqURL, bytes.NewReader(bodyBytes))`);
      } else {
         emitter.line(`httpReq, err := http.NewRequestWithContext(ctx, "${method}", reqURL, nil)`);
      }
      
      emitter.line(`if err != nil { return nil, err }`);
      emitter.line();
      emitter.line(`if c.Token != "" {`);
      emitter.line(`\thttpReq.Header.Set("Authorization", "Bearer "+c.Token)`);
      emitter.line(`}`);
      if (ep.requestBody) {
         emitter.line(`httpReq.Header.Set("Content-Type", "application/json")`);
      }
      emitter.line();
      
      emitter.line(`resp, err := c.HTTPClient.Do(httpReq)`);
      emitter.line(`if err != nil { return nil, err }`);
      emitter.line(`defer resp.Body.Close()`);
      emitter.line();
      emitter.line(`if resp.StatusCode >= 400 {`);
      emitter.line(`\treturn nil, fmt.Errorf("API Error: %d", resp.StatusCode)`);
      emitter.line(`}`);
      emitter.line();
      
      if (retType !== 'interface{}') {
         emitter.line(`var res ${retType}`);
         emitter.line(`if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {`);
         emitter.line(`\treturn nil, err`);
         emitter.line(`}`);
         emitter.line(`return &res, nil`);
      } else {
         emitter.line(`return nil, nil`);
      }
    });
  }

  private buildResponseType(ep: IREndpoint): string {
    const success = ep.successResponse;
    if (success && ep.responses[success]) {
      const typeRef = ep.responses[success].type;
      if (typeRef) return this.renderTypeRef(typeRef).replace(/^\*/, '');
    }
    return 'interface{}';
  }

  private renderTypeRef(ref: IRTypeRef): string {
    let t = 'interface{}';
    if (ref.ref) t = ref.ref;
    else if (ref.inline && ref.inline.kind === 'scalar') t = ref.inline.scalar === 'number' ? 'float64' : 'string';
    if (ref.isArray) t = `[]${t}`;
    if (ref.nullable) t = `*${t}`;
    return t;
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
