import { describe, expect, it } from 'vitest';
import {
  collectAvailableVariables,
  extractVariableReferenceContext,
  filterVariables,
  insertVariableAtCursor,
} from '../src/utils/environment-intellisense';

describe('Environment Variable IntelliSense', () => {
  it('detects when cursor is typing a variable reference token', () => {
    // Exact {{ typing
    const ctx1 = extractVariableReferenceContext('{{', 2);
    expect(ctx1).toEqual({
      isOpen: true,
      query: '',
      tokenStart: 0,
      tokenEnd: 2,
      hasClosingBraces: false,
    });

    // In the middle of an endpoint path
    const ctx2 = extractVariableReferenceContext('/api/v1/{{user', 14);
    expect(ctx2).toEqual({
      isOpen: true,
      query: 'user',
      tokenStart: 8,
      tokenEnd: 14,
      hasClosingBraces: false,
    });

    // Bearer token header
    const ctx3 = extractVariableReferenceContext('Bearer {{auth_tok', 17);
    expect(ctx3).toEqual({
      isOpen: true,
      query: 'auth_tok',
      tokenStart: 7,
      tokenEnd: 17,
      hasClosingBraces: false,
    });

    // Already closed variable reference
    const ctx4 = extractVariableReferenceContext('Bearer {{token}}', 16);
    expect(ctx4).toBeNull();

    // No braces at all
    const ctx5 = extractVariableReferenceContext('https://example.com/users', 26);
    expect(ctx5).toBeNull();

    // Braces with existing closing braces right after cursor
    const ctx6 = extractVariableReferenceContext('{{token}}', 7);
    expect(ctx6).toEqual({
      isOpen: true,
      query: 'token',
      tokenStart: 0,
      tokenEnd: 7,
      hasClosingBraces: true,
    });
  });

  it('filters variables based on query matching key, value, or environment', () => {
    const vars = [
      { key: 'baseUrl', value: 'http://localhost:3000', environmentName: 'Local' },
      { key: 'apiKey', value: 'secret-1234', environmentName: 'Local' },
      { key: 'stagingUrl', value: 'https://staging.api.com', environmentName: 'Staging' },
    ];

    expect(filterVariables(vars, '')).toHaveLength(3);
    expect(filterVariables(vars, 'base')).toEqual([vars[0]]);
    expect(filterVariables(vars, '1234')).toEqual([vars[1]]);
    expect(filterVariables(vars, 'staging')).toEqual([vars[2]]);
    expect(filterVariables(vars, 'nonexistent')).toHaveLength(0);
  });

  it('correctly inserts the chosen variable and adjusts cursor position', () => {
    const text = 'Bearer {{tok';
    const result = insertVariableAtCursor(text, 7, 12, 'authToken');
    expect(result.newText).toBe('Bearer {{authToken}}');
    expect(result.newCursor).toBe('Bearer {{authToken}}'.length);

    // When closing braces were already present
    const textWithClosing = '{{tok}}';
    const result2 = insertVariableAtCursor(textWithClosing, 0, 5, 'authToken');
    expect(result2.newText).toBe('{{authToken}}');
    expect(result2.newCursor).toBe('{{authToken}}'.length);
  });

  it('collects and prioritises variables from the active environment', () => {
    const environments = [
      {
        id: 'env-1',
        name: 'Local',
        variables: [{ key: 'host', value: 'localhost:3000' }],
      },
      {
        id: 'env-2',
        name: 'Production',
        variables: [
          { key: 'host', value: 'api.production.com' },
          { key: 'cdn', value: 'cdn.production.com' },
        ],
      },
    ];

    const collected = collectAvailableVariables(environments, 'env-1', {
      PORT: '3000',
    });

    expect(collected).toEqual([
      {
        key: 'host',
        value: 'localhost:3000',
        environmentName: 'Local',
        environmentId: 'env-1',
        isCurrentEnv: true,
      },
      {
        key: 'cdn',
        value: 'cdn.production.com',
        environmentName: 'Production',
        environmentId: 'env-2',
        isCurrentEnv: false,
      },
      {
        key: 'PORT',
        value: '3000',
        environmentName: 'Server Env',
        isCurrentEnv: false,
      },
    ]);
  });
});
