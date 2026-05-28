import { type ClientRequest, type ClientResponse } from './types';

export type RequestInterceptor = (req: ClientRequest) => Promise<ClientRequest> | ClientRequest;
export type ResponseInterceptor = (res: ClientResponse) => Promise<ClientResponse> | ClientResponse;
export type ErrorInterceptor = (err: any) => Promise<any> | any;

export class InterceptorManager {
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];
  private errorInterceptors: ErrorInterceptor[] = [];

  useRequest(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  useResponse(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  useError(interceptor: ErrorInterceptor): void {
    this.errorInterceptors.push(interceptor);
  }

  async runRequestInterceptors(req: ClientRequest): Promise<ClientRequest> {
    let currentReq = { ...req };
    for (const interceptor of this.requestInterceptors) {
      currentReq = await interceptor(currentReq);
    }
    return currentReq;
  }

  async runResponseInterceptors(res: ClientResponse): Promise<ClientResponse> {
    let currentRes = res;
    for (const interceptor of this.responseInterceptors) {
      currentRes = await interceptor(currentRes);
    }
    return currentRes;
  }

  async runErrorInterceptors(err: any): Promise<any> {
    let currentErr = err;
    for (const interceptor of this.errorInterceptors) {
      try {
        currentErr = await interceptor(currentErr);
      } catch (e) {
        currentErr = e;
      }
    }
    throw currentErr;
  }
}
