/**
 * Regression test for the `NativeRequest.query` setter.
 *
 * Background: in 5.0 we converted `req.query` from a public field to a
 * lazy getter (parses the query string on first access — saves ~0.5µs
 * per request when handlers don't read it). The conversion accidentally
 * broke `@axiomify/security`, whose sanitiser does:
 *
 *   req.query = sanitiseInput(req.query)
 *
 * via `patchRequestProperty(req, 'query', ...)`. With only a getter, the
 * assignment is silently a no-op in non-strict code, or throws in strict
 * mode — either way the sanitised value never reaches the handler.
 *
 * The fix: pair the getter with a setter that stores into the same
 * `_parsedQuery` slot so a subsequent read returns the assigned value.
 *
 * This test pins the setter so a future "simplify" refactor that removes
 * the setter fails CI immediately.
 */
import { describe, expect, it } from 'vitest';
import { NativeRequest } from '../src/request';

function makeReq() {
  return new NativeRequest(
    'GET',
    '/test',
    '127.0.0.1',
    {},
    'tag=a&tag=b&name=ada',
    undefined,
  );
}

describe('NativeRequest.query — getter + setter contract', () => {
  it('reads return the parsed query on first access', () => {
    const req = makeReq();
    expect(req.query).toEqual({ tag: ['a', 'b'], name: 'ada' });
  });

  it('writes through to the parsed-query slot (security plugin path)', () => {
    const req = makeReq();
    // Force first parse, then overwrite as the sanitiser would.
    expect(req.query).toEqual({ tag: ['a', 'b'], name: 'ada' });

    const sanitised = { tag: 'a', name: 'sanitised' };
    req.query = sanitised;

    // Subsequent reads MUST return the assigned value — not re-parse the
    // original query string. If the setter regresses, this assertion
    // fails because the getter would return the original parse result.
    expect(req.query).toEqual(sanitised);
    expect(req.query.name).toBe('sanitised');
  });

  it('write-before-read also works (lazy parser bypassed entirely)', () => {
    const req = makeReq();
    // Assign before ever reading — the getter should NOT re-parse the
    // original query string on next access; it should return the
    // explicit assignment.
    const replacement = { manual: 'true' };
    req.query = replacement;
    expect(req.query).toEqual(replacement);
  });

  it('body and params remain plain writable fields', () => {
    // Sanity: only `query` is a getter-with-setter; body / params are
    // plain writable properties. If a future refactor accidentally
    // converts those to getters too, the sanitiser would break again.
    const req = makeReq();
    req.body = { hello: 'world' };
    req.params.id = 'new-value';
    expect(req.body).toEqual({ hello: 'world' });
    expect(req.params.id).toBe('new-value');
  });
});
