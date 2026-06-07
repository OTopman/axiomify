import { BaseClient, WebSocketClient, type ClientConfig, type WebSocketClientOptions } from '@axiomify/sdk-runtime';
import type * as Types from './types';

export class ApiClient extends BaseClient {
  constructor(config: ClientConfig) {
    super(config);
  }

  async getMetrics(): Promise<void> {
    return this.request<void>({ method: 'GET', path: `/metrics` });
  }

  async getAssetsAll(): Promise<void> {
    return this.request<void>({ method: 'GET', path: `/assets/*` });
  }

  async getApiUsers(): Promise<Types.GetApiUsersResponse> {
    return this.request<Types.GetApiUsersResponse>({ method: 'GET', path: `/api/users` });
  }

  async postApiUsers(request: { body: Types.PostApiUsersRequest }): Promise<void> {
    return this.request<void>({ method: 'POST', path: `/api/users`, body: request.body });
  }

  async postApiUsersAvatar(request: { body: Types.PostApiUsersAvatarRequest }): Promise<void> {
    return this.request<void>({ method: 'POST', path: `/api/users/avatar`, body: request.body });
  }

  async postGraphql(): Promise<void> {
    return this.request<void>({ method: 'POST', path: `/graphql` });
  }

  async getGraphql(): Promise<void> {
    return this.request<void>({ method: 'GET', path: `/graphql` });
  }

  async getGraphqlPlayground(): Promise<void> {
    return this.request<void>({ method: 'GET', path: `/graphql/playground` });
  }

  async getApiSecureData(): Promise<void> {
    return this.request<void>({ method: 'GET', path: `/api/secure-data` });
  }

  async getProtectedData(): Promise<void> {
    return this.request<void>({ method: 'GET', path: `/protected/data` });
  }

  async getPing(): Promise<Types.GetPingResponse> {
    return this.request<Types.GetPingResponse>({ method: 'GET', path: `/ping` });
  }

  async getApiLogin(): Promise<void> {
    return this.request<void>({ method: 'GET', path: `/api/login` });
  }

  async getDownload(): Promise<void> {
    return this.request<void>({ method: 'GET', path: `/download` });
  }

  async getLiveFeed(): Promise<void> {
    return this.request<void>({ method: 'GET', path: `/live-feed` });
  }

  async getDocsOpenapiJson(): Promise<void> {
    return this.request<void>({ method: 'GET', path: `/docs/openapi.json` });
  }

  async getDocs(): Promise<void> {
    return this.request<void>({ method: 'GET', path: `/docs` });
  }
}
