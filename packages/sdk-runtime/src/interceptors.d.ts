import { type ClientRequest, type ClientResponse } from './types';
export type RequestInterceptor = (
  req: ClientRequest,
) => Promise<ClientRequest> | ClientRequest;
export type ResponseInterceptor = (
  res: ClientResponse,
) => Promise<ClientResponse> | ClientResponse;
export type ErrorInterceptor = (err: any) => Promise<any> | any;
export declare class InterceptorManager {
  private requestInterceptors;
  private responseInterceptors;
  private errorInterceptors;
  useRequest(interceptor: RequestInterceptor): void;
  useResponse(interceptor: ResponseInterceptor): void;
  useError(interceptor: ErrorInterceptor): void;
  runRequestInterceptors(req: ClientRequest): Promise<ClientRequest>;
  runResponseInterceptors(res: ClientResponse): Promise<ClientResponse>;
  runErrorInterceptors(err: any): Promise<any>;
}
//# sourceMappingURL=interceptors.d.ts.map
