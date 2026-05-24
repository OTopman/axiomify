import { BaseClient, type ClientConfig } from '@axiomify/sdk-runtime';
import type * as Types from './types';

export class ApiClient extends BaseClient {
  constructor(config: ClientConfig) {
    super(config);
  }

  async listPets(): Promise<Types.Pet[]> {
    return this.request<Types.Pet[]>({ method: 'GET', path: `/pets` });
  }
}
