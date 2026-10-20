import { describe, expect, it } from 'vitest';
import reducer, {
  addBodyField,
  addHeader,
  addQueryParam,
  addUpload,
  loadSavedRequest,
  removeBodyField,
  removeHeader,
  removeQueryParam,
  removeUpload,
  setActiveSubTab,
  setApiKeyLocation,
  setApiKeyName,
  setApiKeyValue,
  setAuthPassword,
  setAuthToken,
  setAuthType,
  setAuthUsername,
  setBodyFields,
  setBodyMode,
  setExpandedTimelineItem,
  setHeaders,
  setMethod,
  setPath,
  setPathParams,
  setQueryParams,
  setReplays,
  setReqBody,
  setResponse,
  setResponseSubTab,
  setSending,
  setUploads,
  updateBodyField,
  updateHeader,
  updatePathParam,
  updateQueryParam,
} from '../src/store/slices/requestTesterSlice';

describe('requestTesterSlice', () => {
  const getInitialState = () => reducer(undefined, { type: '@@INIT' });

  it('handles setMethod and setPath', () => {
    let state = getInitialState();
    state = reducer(state, setMethod('POST'));
    expect(state.method).toBe('POST');

    state = reducer(state, setPath('/api/v1/orders'));
    expect(state.path).toBe('/api/v1/orders');
  });

  it('manages queryParams actions', () => {
    let state = getInitialState();
    state = reducer(state, setQueryParams([{ key: 'page', value: '1' }]));
    expect(state.queryParams).toHaveLength(1);

    state = reducer(state, addQueryParam());
    expect(state.queryParams).toHaveLength(2);

    state = reducer(
      state,
      updateQueryParam({ index: 1, key: 'limit', value: '50' }),
    );
    expect(state.queryParams[1]).toEqual({ key: 'limit', value: '50' });

    state = reducer(state, updateQueryParam({ index: 1, key: 'size' }));
    expect(state.queryParams[1].key).toBe('size');

    state = reducer(state, updateQueryParam({ index: 1, value: '100' }));
    expect(state.queryParams[1].value).toBe('100');

    // out-of-bounds update does not throw
    state = reducer(state, updateQueryParam({ index: 99, key: 'noop' }));

    state = reducer(state, removeQueryParam(0));
    expect(state.queryParams).toHaveLength(1);
    expect(state.queryParams[0].key).toBe('size');
  });

  it('manages pathParams actions', () => {
    let state = getInitialState();
    state = reducer(state, setPathParams([{ key: 'id', value: '123' }]));
    expect(state.pathParams[0]).toEqual({ key: 'id', value: '123' });

    state = reducer(
      state,
      updatePathParam({ index: 0, key: 'orderId', value: '456' }),
    );
    expect(state.pathParams[0]).toEqual({ key: 'orderId', value: '456' });

    state = reducer(state, updatePathParam({ index: 0, key: 'userId' }));
    expect(state.pathParams[0].key).toBe('userId');

    state = reducer(state, updatePathParam({ index: 0, value: '789' }));
    expect(state.pathParams[0].value).toBe('789');

    // out-of-bounds
    state = reducer(state, updatePathParam({ index: 5, key: 'none' }));
    expect(state.pathParams).toHaveLength(1);
  });

  it('manages headers actions', () => {
    let state = getInitialState();
    state = reducer(
      state,
      setHeaders([{ key: 'Authorization', value: 'Bearer abc' }]),
    );
    expect(state.headers).toHaveLength(1);

    state = reducer(state, addHeader());
    expect(state.headers).toHaveLength(2);

    state = reducer(
      state,
      updateHeader({ index: 1, key: 'X-Trace', value: 'xyz' }),
    );
    expect(state.headers[1]).toEqual({ key: 'X-Trace', value: 'xyz' });

    state = reducer(state, updateHeader({ index: 1, key: 'X-Request-Id' }));
    expect(state.headers[1].key).toBe('X-Request-Id');

    state = reducer(state, updateHeader({ index: 1, value: 'trace-1' }));
    expect(state.headers[1].value).toBe('trace-1');

    state = reducer(state, updateHeader({ index: 10, key: 'noop' }));

    state = reducer(state, removeHeader(0));
    expect(state.headers).toHaveLength(1);
    expect(state.headers[0].key).toBe('X-Request-Id');
  });

  it('manages bodyMode, reqBody, and bodyFields', () => {
    let state = getInitialState();
    state = reducer(state, setBodyMode('form-data'));
    expect(state.bodyMode).toBe('form-data');

    state = reducer(state, setReqBody('{"foo":"bar"}'));
    expect(state.reqBody).toBe('{"foo":"bar"}');

    state = reducer(state, setBodyFields([{ key: 'user', value: 'alice' }]));
    expect(state.bodyFields).toHaveLength(1);

    state = reducer(state, addBodyField());
    expect(state.bodyFields).toHaveLength(2);

    state = reducer(
      state,
      updateBodyField({ index: 1, key: 'pass', value: 'secret' }),
    );
    expect(state.bodyFields[1]).toEqual({ key: 'pass', value: 'secret' });

    state = reducer(state, updateBodyField({ index: 1, key: 'password' }));
    expect(state.bodyFields[1].key).toBe('password');

    state = reducer(
      state,
      updateBodyField({ index: 1, value: 'super-secret' }),
    );
    expect(state.bodyFields[1].value).toBe('super-secret');

    state = reducer(state, updateBodyField({ index: 10, key: 'none' }));

    state = reducer(state, removeBodyField(0));
    expect(state.bodyFields).toHaveLength(1);
    expect(state.bodyFields[0].key).toBe('password');
  });

  it('manages uploads actions', () => {
    let state = getInitialState();
    const file = {
      field: 'avatar',
      name: 'pic.png',
      type: 'image/png',
      contentBase64: 'data:image/png;base64,...',
    };
    state = reducer(state, setUploads([file]));
    expect(state.uploads).toHaveLength(1);

    state = reducer(
      state,
      addUpload({
        field: 'doc',
        name: 'report.pdf',
        type: 'application/pdf',
        contentBase64: 'data:...',
      }),
    );
    expect(state.uploads).toHaveLength(2);

    state = reducer(state, removeUpload(0));
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0].name).toBe('report.pdf');
  });

  it('manages response, replays, timeline, sending, subTabs', () => {
    let state = getInitialState();
    state = reducer(state, setSending(true));
    expect(state.sending).toBe(true);

    const dummyResponse = { status: 200, data: { ok: true } };
    state = reducer(state, setResponse(dummyResponse));
    expect(state.response).toEqual(dummyResponse);

    const replays = [
      {
        id: 'rep-1',
        method: 'GET',
        path: '/ping',
        timestamp: '2026-10-20T10:00:00Z',
      },
    ];
    state = reducer(state, setReplays(replays));
    expect(state.replays).toEqual(replays);

    state = reducer(state, setExpandedTimelineItem(2));
    expect(state.expandedTimelineItem).toBe(2);

    state = reducer(state, setActiveSubTab('auth'));
    expect(state.activeSubTab).toBe('auth');

    state = reducer(state, setResponseSubTab('headers'));
    expect(state.responseSubTab).toBe('headers');
  });

  it('manages authentication configuration', () => {
    let state = getInitialState();
    state = reducer(state, setAuthType('bearer'));
    expect(state.authType).toBe('bearer');

    state = reducer(state, setAuthToken('jwt-token-123'));
    expect(state.authToken).toBe('jwt-token-123');

    state = reducer(state, setAuthUsername('admin'));
    expect(state.authUsername).toBe('admin');

    state = reducer(state, setAuthPassword('s3cr3t'));
    expect(state.authPassword).toBe('s3cr3t');

    state = reducer(state, setApiKeyName('X-Custom-Key'));
    expect(state.apiKeyName).toBe('X-Custom-Key');

    state = reducer(state, setApiKeyValue('val-999'));
    expect(state.apiKeyValue).toBe('val-999');

    state = reducer(state, setApiKeyLocation('query'));
    expect(state.apiKeyLocation).toBe('query');
  });

  it('handles loadSavedRequest with partial or complete payloads', () => {
    let state = getInitialState();
    state = reducer(
      state,
      loadSavedRequest({
        method: 'PUT',
        path: '/api/v1/items/42',
        queryParams: [{ key: 'dryRun', value: 'true' }],
        pathParams: [{ key: 'id', value: '42' }],
        headers: [{ key: 'X-Tenant', value: 'alpha' }],
        bodyMode: 'text',
        body: 'raw payload',
        bodyFields: [{ key: 'k', value: 'v' }],
      }),
    );

    expect(state.method).toBe('PUT');
    expect(state.path).toBe('/api/v1/items/42');
    expect(state.queryParams).toEqual([{ key: 'dryRun', value: 'true' }]);
    expect(state.pathParams).toEqual([{ key: 'id', value: '42' }]);
    expect(state.headers).toEqual([{ key: 'X-Tenant', value: 'alpha' }]);
    expect(state.bodyMode).toBe('text');
    expect(state.reqBody).toBe('raw payload');
    expect(state.bodyFields).toEqual([{ key: 'k', value: 'v' }]);
  });
});
