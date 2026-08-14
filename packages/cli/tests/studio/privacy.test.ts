import { afterEach, describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import {
  getStudioPrivacyOptions,
  handleGetPrivacy,
  handlePostPrivacy,
  redactForStudio,
  redactTextForStudio,
  sanitizeRecordedBody,
  sanitizeRecordedHeaders,
  setStudioPrivacyOptions,
} from '../../src/studio/api/privacy';
import { sanitizeReplayItem } from '../../src/studio/api/replay';
import {
  getSessionData,
  recordEvent,
  recordQuery,
  recordSessionError,
} from '../../src/studio/api/recorder';

describe('Studio recorder privacy', () => {
  function responseCapture() {
    const result: { status?: number; body?: any } = {};
    const res: any = {
      writeHead(status: number) {
        result.status = status;
      },
      end(body: string) {
        result.body = JSON.parse(body);
      },
    };
    return { res, result };
  }
  afterEach(() => {
    setStudioPrivacyOptions({ includeBodies: true, sensitiveKeys: [] });
  });

  it('redacts sensitive fields recursively and sensitive headers', () => {
    const body = redactForStudio({
      profile: { password: 'not-for-export' },
      accessToken: 'secret-token',
      safe: 'kept',
    });

    expect(body).toEqual({
      profile: { password: '••••••••' },
      accessToken: '••••••••',
      safe: 'kept',
    });
    expect(
      sanitizeRecordedHeaders({
        Authorization: 'Bearer private',
        accept: 'application/json',
      }),
    ).toEqual({
      Authorization: '••••••••',
      accept: 'application/json',
    });
  });

  it('supports disabling body capture and project-specific redaction keys', () => {
    setStudioPrivacyOptions({ sensitiveKeys: ['memberNumber'] });
    expect(
      sanitizeRecordedBody({ memberNumber: '12345', label: 'visible' }),
    ).toEqual({
      memberNumber: '••••••••',
      label: 'visible',
    });

    setStudioPrivacyOptions({ includeBodies: false });
    expect(sanitizeRecordedBody({ anything: 'private' })).toBe(
      '[Body recording disabled]',
    );
  });

  it('sanitizes replay entries before they can be persisted to disk', () => {
    setStudioPrivacyOptions({ sensitiveKeys: ['memberNumber'] });
    const replay = sanitizeReplayItem({
      id: 'replay-1',
      method: 'POST',
      path: '/payments',
      timestamp: '2026-01-01T00:00:00.000Z',
      headers: { authorization: 'Bearer private', accept: 'application/json' },
      query: { token: 'query-secret', page: '1' },
      body: { password: 'body-secret', memberNumber: '1234', visible: true },
    });

    expect(replay.headers).toEqual({
      authorization: '••••••••',
      accept: 'application/json',
    });
    expect(replay.query).toEqual({ token: '••••••••', page: '1' });
    expect(replay.body).toEqual({
      password: '••••••••',
      memberNumber: '••••••••',
      visible: true,
    });
  });

  it('redacts text-based error, event, and query records', () => {
    setStudioPrivacyOptions({ sensitiveKeys: ['memberNumber'] });
    expect(
      redactTextForStudio('password=plain Bearer abc.def.ghi? token=abc'),
    ).toBe('password=•••••••• Bearer ••••••••? token=••••••••');

    recordSessionError({
      requestId: 'privacy-error',
      name: 'Error',
      message: 'api-key: key-123',
      stack: 'token=stack-secret',
      method: 'GET',
      path: '/',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    recordEvent({
      requestId: 'privacy-event',
      type: 'bus:payment',
      payload: { memberNumber: '1234' },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    recordQuery({
      requestId: 'privacy-query',
      query: 'find({ password: "db-secret" })',
      durationMs: 1,
      failed: false,
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    const session = getSessionData();
    expect(
      session.errors.find((error) => error.requestId === 'privacy-error'),
    ).toMatchObject({ message: 'api-key: ••••••••', stack: 'token=••••••••' });
    expect(
      session.events.find((event) => event.requestId === 'privacy-event')
        ?.payload,
    ).toEqual({ memberNumber: '••••••••' });
    expect(
      session.queries.find((query) => query.requestId === 'privacy-query')
        ?.query,
    ).toBe('find({ password: •••••••• })');
    session.errors.length = 0;
    session.events.length = 0;
    session.queries.length = 0;
  });

  it('serves and validates privacy configuration endpoints', async () => {
    const get = responseCapture();
    handleGetPrivacy({} as any, get.res);
    expect(get.result).toMatchObject({ status: 200 });
    expect(get.result.body).toEqual(getStudioPrivacyOptions());

    const post = responseCapture();
    await handlePostPrivacy(
      Readable.from([
        Buffer.from(
          JSON.stringify({ includeBodies: false, sensitiveKeys: ['account'] }),
        ),
      ]) as any,
      post.res,
    );
    expect(post.result).toMatchObject({
      status: 200,
      body: { includeBodies: false, sensitiveKeys: ['account'] },
    });

    for (const body of ['{"sensitiveKeys":"invalid"}', '{invalid']) {
      const invalid = responseCapture();
      await handlePostPrivacy(
        Readable.from([Buffer.from(body)]) as any,
        invalid.res,
      );
      expect(invalid.result.status).toBe(400);
    }
  });
});
