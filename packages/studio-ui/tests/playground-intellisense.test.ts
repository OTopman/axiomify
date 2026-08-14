import { describe, expect, it } from 'vitest';
import {
  extractPlaygroundOperations,
  getPlaygroundCompletionQuery,
  getPlaygroundPropertyCompletionContext,
} from '../src/utils/playground-intellisense';

describe('Playground SDK IntelliSense', () => {
  it('extracts generated client methods, signatures, and documentation', () => {
    const operations = extractPlaygroundOperations([
      {
        path: 'client.ts',
        content: `
          /** Get the current user. */
          async getCurrentUser(request: { id: string }): Promise<User> { return this.request({}); }
          async listUsers(): Promise<User[]> { return this.request({}); }
        `,
      },
    ]);

    expect(operations).toEqual([
      expect.objectContaining({
        name: 'getCurrentUser',
        signature: 'getCurrentUser(request: { id: string }): Promise<User>',
        documentation: 'Get the current user.',
        parameters: [{ name: 'id', optional: false, type: 'string' }],
      }),
      expect.objectContaining({
        name: 'listUsers',
        signature: 'listUsers(): Promise<User[]>',
      }),
    ]);
  });

  it('finds the partial method name following client dot access', () => {
    expect(getPlaygroundCompletionQuery('const result = await client.')).toBe(
      '',
    );
    expect(
      getPlaygroundCompletionQuery('const result = await client.get'),
    ).toBe('get');
    expect(
      getPlaygroundCompletionQuery('const result = await other.'),
    ).toBeNull();
  });

  it('finds request fields while a generated SDK call object is being written', () => {
    expect(
      getPlaygroundPropertyCompletionContext('await client.createUser({ ema'),
    ).toEqual({
      operationName: 'createUser',
      query: 'ema',
      usedPropertyNames: [],
    });
    expect(
      getPlaygroundPropertyCompletionContext(
        'await client.createUser({ email: "a@b.com", na',
      ),
    ).toEqual({
      operationName: 'createUser',
      query: 'na',
      usedPropertyNames: ['email'],
    });
    expect(
      getPlaygroundPropertyCompletionContext(
        'await client.createUser({ body: { na',
      ),
    ).toBeNull();
  });
});
