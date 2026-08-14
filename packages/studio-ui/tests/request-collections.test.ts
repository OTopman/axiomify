import { describe, expect, it } from 'vitest';
import { substituteRequestVariables } from '../src/utils/request-collections';

describe('Studio request environments', () => {
  it('substitutes named variables and leaves unknown placeholders intact', () => {
    const variables = [
      { key: 'baseUrl', value: 'http://localhost:3001' },
      { key: 'accessToken', value: 'secret' },
    ];
    expect(
      substituteRequestVariables('{{baseUrl}}/users/{{ userId }}', variables),
    ).toBe('http://localhost:3001/users/{{ userId }}');
    expect(
      substituteRequestVariables('Bearer {{accessToken}}', variables),
    ).toBe('Bearer secret');
  });
});
