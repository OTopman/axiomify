import Editor, { Monaco } from '@monaco-editor/react';
import React, { useEffect, useRef, useState } from 'react';
import { DiscoveryData } from '../types';
import { apiFetch } from '../utils/api';
import {
  createStudioId,
  loadRequestCollections,
  loadRequestEnvironments,
  saveRequestCollections,
  saveRequestEnvironments,
  substituteRequestVariables,
  type RequestCollection,
  type RequestEnvironment,
  type SavedRequest,
} from '../utils/request-collections';

interface RequestBuilderProps {
  discovery: DiscoveryData;
  isDark?: boolean;
  prefilledMethod?: string;
  prefilledPath?: string;
  onClearPrefill?: () => void;
}

interface KeyVal {
  key: string;
  value: string;
}

interface UploadFile {
  field: string;
  name: string;
  type: string;
  contentBase64: string;
}

type BodyMode = 'none' | 'json' | 'text' | 'form-data' | 'urlencoded';

const BODY_MODE_OPTIONS: Array<{ value: BodyMode; label: string }> = [
  { value: 'none', label: 'none' },
  { value: 'json', label: 'raw JSON' },
  { value: 'text', label: 'raw text' },
  { value: 'form-data', label: 'form-data' },
  { value: 'urlencoded', label: 'x-www-form-urlencoded' },
];

function contentTypeForBodyMode(mode: BodyMode): string | null {
  switch (mode) {
    case 'json':
      return 'application/json';
    case 'text':
      return 'text/plain; charset=utf-8';
    case 'form-data':
      return 'multipart/form-data';
    case 'urlencoded':
      return 'application/x-www-form-urlencoded';
    default:
      return null;
  }
}

function inferBodyMode(headers: Record<string, unknown> | undefined): BodyMode {
  const contentType = Object.entries(headers || {}).find(
    ([key]) => key.toLowerCase() === 'content-type',
  )?.[1];
  const normalized = String(contentType || '').toLowerCase();
  if (normalized.includes('multipart/form-data')) return 'form-data';
  if (normalized.includes('application/x-www-form-urlencoded'))
    return 'urlencoded';
  if (normalized.includes('application/json') || normalized.includes('+json'))
    return 'json';
  if (normalized) return 'text';
  return 'none';
}

interface ReplayHistoryItem {
  id: string;
  method: string;
  path: string;
  timestamp: string;
  status?: number;
  duration?: number;
  request?: any;
}

function formatDuration(value: unknown, decimals = 2): string {
  const duration = Number(value);
  return Number.isFinite(duration) ? `${duration.toFixed(decimals)} ms` : '—';
}

export const RequestBuilder: React.FC<RequestBuilderProps> = ({
  discovery,
  isDark = true,
  prefilledMethod = '',
  prefilledPath = '',
  onClearPrefill,
}) => {
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('');
  const [queryParams, setQueryParams] = useState<KeyVal[]>([]);
  const [pathParams, setPathParams] = useState<KeyVal[]>([]);
  const [headers, setHeaders] = useState<KeyVal[]>([
    { key: 'Content-Type', value: 'application/json' },
  ]);
  const [reqBody, setReqBody] = useState('');
  const [bodyMode, setBodyMode] = useState<BodyMode>('json');
  const [bodyFields, setBodyFields] = useState<KeyVal[]>([]);
  const [uploads, setUploads] = useState<UploadFile[]>([]);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<any | null>(null);
  const [replays, setReplays] = useState<ReplayHistoryItem[]>([]);
  const [expandedTimelineItem, setExpandedTimelineItem] = useState<
    number | null
  >(null);
  const [collections, setCollections] = useState<RequestCollection[]>(() =>
    loadRequestCollections(),
  );
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [environments, setEnvironments] = useState<RequestEnvironment[]>(() =>
    loadRequestEnvironments(),
  );
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('');
  const [environmentVariables, setEnvironmentVariables] = useState<KeyVal[]>(
    [],
  );
  const completionProviderRef = useRef<{ dispose: () => void } | null>(null);
  const selectedBodySchema = discovery.schemas.find(
    (s) => s.method === method && s.path === path,
  )?.body;
  const bodySchemaRef = useRef<any>(undefined);
  bodySchemaRef.current = selectedBodySchema;

  // Load replays list on mount
  useEffect(() => {
    fetchReplays();

    const handleReplaysUpdated = () => {
      fetchReplays();
    };
    window.addEventListener('axiomify-replays-updated', handleReplaysUpdated);
    return () => {
      window.removeEventListener(
        'axiomify-replays-updated',
        handleReplaysUpdated,
      );
    };
  }, []);

  useEffect(() => () => completionProviderRef.current?.dispose(), []);

  // Handle pre-fill from quick test click
  useEffect(() => {
    if (prefilledMethod && prefilledPath) {
      setMethod(prefilledMethod);
      setPath(prefilledPath);
      prefillFromRoute(prefilledMethod, prefilledPath);
      if (onClearPrefill) onClearPrefill();
    }
  }, [prefilledMethod, prefilledPath]);

  const fetchReplays = async () => {
    try {
      const res = await apiFetch('/__studio/api/request/replays');
      if (res.ok) {
        const data = await res.json();
        const history = data.history || data.replays || [];
        setReplays([...history].reverse());
      }
    } catch (err) {
      console.error('Failed to fetch request replays:', err);
    }
  };

  const clearAllReplays = async () => {
    if (!confirm('Are you sure you want to clear request history?')) return;
    try {
      const res = await apiFetch('/__studio/api/request/replays', {
        method: 'DELETE',
      });
      if (res.ok) {
        setReplays([]);
      }
    } catch (err) {
      console.error('Failed to clear replays:', err);
    }
  };

  const generateMockData = (keyName: string, schema: any): any => {
    if (!schema) return null;
    const lowerKey = keyName.toLowerCase();

    if (schema.type === 'object' && schema.properties) {
      const obj: Record<string, any> = {};
      for (const [k, prop] of Object.entries(schema.properties)) {
        obj[k] = generateMockData(k, prop);
      }
      return obj;
    }
    if (schema.type === 'array') {
      return [generateMockData(keyName, schema.items)];
    }
    if (schema.type === 'string') {
      if (lowerKey.includes('email')) {
        return `john.doe.${Math.floor(Math.random() * 1000)}@example.com`;
      }
      if (lowerKey.includes('name')) {
        if (lowerKey.includes('first')) return 'John';
        if (lowerKey.includes('last')) return 'Doe';
        return 'John Doe';
      }
      if (lowerKey.includes('uuid') || lowerKey.includes('id')) {
        return '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
      }
      if (lowerKey.includes('phone') || lowerKey.includes('tel')) {
        return '+1-555-0199';
      }
      if (lowerKey.includes('address') || lowerKey.includes('street')) {
        return '123 Main Street, Springfield';
      }
      if (
        lowerKey.includes('date') ||
        lowerKey.includes('time') ||
        lowerKey.includes('at')
      ) {
        return new Date().toISOString();
      }
      if (
        lowerKey.includes('avatar') ||
        lowerKey.includes('url') ||
        lowerKey.includes('image')
      ) {
        return 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150';
      }
      if (schema.enum && schema.enum.length > 0) {
        return schema.enum[0];
      }
      return schema.description || 'Sample String';
    }
    if (schema.type === 'number' || schema.type === 'integer') {
      if (lowerKey.includes('age')) return 30;
      if (lowerKey.includes('price')) return 19.99;
      if (lowerKey.includes('quantity') || lowerKey.includes('count')) return 5;
      if (lowerKey.includes('year')) return 2026;
      return 42;
    }
    if (schema.type === 'boolean') {
      return true;
    }
    return null;
  };

  const getPathParamsList = (pathStr: string): string[] => {
    const matches: string[] = [];
    const colonRegex = /:([a-zA-Z0-9_]+)/g;
    let match;
    while ((match = colonRegex.exec(pathStr)) !== null) {
      matches.push(match[1]);
    }
    const braceRegex = /{([a-zA-Z0-9_]+)}/g;
    while ((match = braceRegex.exec(pathStr)) !== null) {
      matches.push(match[1]);
    }
    return Array.from(new Set(matches));
  };

  const prefillFromRoute = (m: string, p: string) => {
    const schema = discovery.schemas.find(
      (s) => s.method === m && s.path === p,
    );

    // Fill request body
    if (schema && schema.body) {
      const template = generateMockData('body', schema.body);
      setBodyMode('json');
      setReqBody(JSON.stringify(template, null, 2));
    } else {
      setReqBody('');
    }

    // Fill query parameters
    if (schema && schema.query && schema.query.properties) {
      const props = schema.query.properties;
      const q: KeyVal[] = Object.keys(props).map((k) => {
        const val = generateMockData(k, props[k]);
        return {
          key: k,
          value: val !== null ? String(val) : '',
        };
      });
      setQueryParams(q);
    } else {
      setQueryParams([]);
    }

    // Fill path parameters
    const parsedParams = getPathParamsList(p);
    const paramsList: KeyVal[] = parsedParams.map((paramName) => {
      const paramSchema = schema?.params?.properties?.[paramName];
      const val = generateMockData(
        paramName,
        paramSchema || { type: 'string' },
      );
      return {
        key: paramName,
        value: val !== null ? String(val) : '',
      };
    });
    setPathParams(paramsList);
  };

  const applySavedRequest = (request: SavedRequest) => {
    setMethod(request.method);
    setPath(request.path);
    setQueryParams(request.queryParams || []);
    setPathParams(request.pathParams || []);
    setHeaders(request.headers || []);
    setBodyMode(request.bodyMode || 'none');
    setReqBody(request.body || '');
    setBodyFields(request.bodyFields || []);
    setUploads([]);
  };

  const createCollection = () => {
    const name = window.prompt('Collection name');
    if (!name?.trim()) return;
    const collection: RequestCollection = {
      id: createStudioId('collection'),
      name: name.trim(),
      requests: [],
    };
    const next = [...collections, collection];
    setCollections(next);
    saveRequestCollections(next);
    setSelectedCollectionId(collection.id);
  };

  const saveCurrentRequest = () => {
    if (!selectedCollectionId) {
      alert('Create or select a collection first.');
      return;
    }
    const name = window.prompt('Saved request name', `${method} ${path}`);
    if (!name?.trim()) return;
    const saved: SavedRequest = {
      id: createStudioId('request'),
      name: name.trim(),
      method,
      path,
      queryParams,
      pathParams,
      headers,
      bodyMode,
      body: reqBody,
      bodyFields,
    };
    const next = collections.map((collection) =>
      collection.id === selectedCollectionId
        ? { ...collection, requests: [...collection.requests, saved] }
        : collection,
    );
    setCollections(next);
    saveRequestCollections(next);
  };

  const deleteSavedRequest = (requestId: string) => {
    const next = collections.map((collection) =>
      collection.id === selectedCollectionId
        ? {
            ...collection,
            requests: collection.requests.filter(
              (request) => request.id !== requestId,
            ),
          }
        : collection,
    );
    setCollections(next);
    saveRequestCollections(next);
  };

  const createEnvironment = () => {
    const name = window.prompt('Environment name', 'Local');
    if (!name?.trim()) return;
    const environment: RequestEnvironment = {
      id: createStudioId('environment'),
      name: name.trim(),
      variables: [],
    };
    const next = [...environments, environment];
    setEnvironments(next);
    saveRequestEnvironments(next);
    setSelectedEnvironmentId(environment.id);
    setEnvironmentVariables([]);
  };

  const handleEnvironmentSelect = (id: string) => {
    setSelectedEnvironmentId(id);
    setEnvironmentVariables(
      environments.find((environment) => environment.id === id)?.variables ||
        [],
    );
  };

  const saveEnvironment = () => {
    if (!selectedEnvironmentId) {
      alert('Create or select an environment first.');
      return;
    }
    const next = environments.map((environment) =>
      environment.id === selectedEnvironmentId
        ? {
            ...environment,
            variables: environmentVariables.filter((variable) =>
              variable.key.trim(),
            ),
          }
        : environment,
    );
    setEnvironments(next);
    saveRequestEnvironments(next);
  };

  const handleRouteSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (!val) return;
    const parts = val.split(' ');
    const m = parts[0];
    const p = parts[1];
    setMethod(m);
    setPath(p);
    prefillFromRoute(m, p);
  };

  const handleReplayClick = async (replay: any) => {
    setMethod(replay.method);
    setPath(replay.path);
    setPathParams([]); // Replays have concrete paths, clear path params input

    // Parse query params
    const q: KeyVal[] = [];
    if (replay.query) {
      Object.entries(replay.query).forEach(([k, v]) => {
        q.push({ key: k, value: String(v) });
      });
    }
    setQueryParams(q);

    // Parse headers
    const h: KeyVal[] = [];
    if (replay.headers) {
      Object.entries(replay.headers).forEach(([k, v]) => {
        h.push({ key: k, value: String(v) });
      });
    }
    setHeaders(h);

    // Parse body
    const replayBodyMode = inferBodyMode(replay.headers);
    setBodyMode(replayBodyMode);
    if (
      (replayBodyMode === 'form-data' || replayBodyMode === 'urlencoded') &&
      replay.body &&
      typeof replay.body === 'object'
    ) {
      setBodyFields(
        Object.entries(replay.body).map(([key, value]) => ({
          key,
          value: String(value),
        })),
      );
      setReqBody('');
    } else {
      setBodyFields([]);
      setReqBody(
        replay.body
          ? typeof replay.body === 'string'
            ? replay.body
            : JSON.stringify(replay.body, null, 2)
          : '',
      );
    }

    // Load full replay if available
    try {
      const res = await apiFetch(
        `/__studio/api/request/replay?id=${encodeURIComponent(replay.id)}`,
      );
      if (res.ok) {
        const fullItem = await res.json();
        if (fullItem.response) {
          setResponse(fullItem.response);
          setExpandedTimelineItem(null);
        }
      }
    } catch (e) {
      console.error('Failed to load full replay details:', e);
    }
  };

  const handleSendRequest = async () => {
    if (!path.trim()) {
      alert('Please enter a request path');
      return;
    }

    setSending(true);
    setExpandedTimelineItem(null);
    const resolveVariables = (value: string) =>
      substituteRequestVariables(value, environmentVariables);

    const query: Record<string, string> = {};
    queryParams.forEach((q) => {
      const key = resolveVariables(q.key).trim();
      if (key) query[key] = resolveVariables(q.value).trim();
    });

    const hdrs: Record<string, string> = {};
    headers.forEach((h) => {
      const key = resolveVariables(h.key).trim();
      if (key) hdrs[key] = resolveVariables(h.value).trim();
    });

    let body: any = undefined;
    if (bodyMode === 'json' && reqBody.trim()) {
      try {
        body = JSON.parse(resolveVariables(reqBody).trim());
      } catch (err: any) {
        alert('Invalid JSON request body: ' + err.message);
        setSending(false);
        return;
      }
    } else if (bodyMode === 'text' && reqBody) {
      body = resolveVariables(reqBody);
    } else if (bodyMode === 'form-data' || bodyMode === 'urlencoded') {
      body = bodyFields.reduce<Record<string, string>>((fields, field) => {
        const key = resolveVariables(field.key).trim();
        if (key) fields[key] = resolveVariables(field.value);
        return fields;
      }, {});
    }

    // Substitute path parameter values in the path
    let finalPath = resolveVariables(path).trim();
    pathParams.forEach((p) => {
      const key = resolveVariables(p.key).trim();
      if (key) {
        finalPath = finalPath
          .replace(`:${key}`, resolveVariables(p.value).trim())
          .replace(`{${key}}`, resolveVariables(p.value).trim());
      }
    });

    try {
      const res = await apiFetch('/__studio/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method,
          path: finalPath,
          headers: hdrs,
          query,
          body,
          bodyMode,
          files: uploads,
        }),
      });

      const result = await res.json();
      setSending(false);
      fetchReplays();

      if (result.error) {
        setResponse({
          status: 'ERROR',
          body: result.error + (result.message ? ': ' + result.message : ''),
          headers: {},
        });
        return;
      }

      setResponse(result);
    } catch (err: any) {
      setSending(false);
      setResponse({
        status: 'ERROR',
        body: 'Network error sending request: ' + err.message,
        headers: {},
      });
    }
  };

  const handleFilesSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const picked = Array.from(event.target.files || []);
    const next = await Promise.all(
      picked.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return {
          field: 'file',
          name: file.name,
          type: file.type || 'application/octet-stream',
          contentBase64: btoa(binary),
        };
      }),
    );
    setUploads(next);
    if (next.length > 0 && bodyMode !== 'form-data') {
      handleBodyModeChange('form-data');
    }
    // Allow selecting the same file again after it has been removed.
    event.target.value = '';
  };

  const getStatusText = (code: number) => {
    const statusTexts: Record<number, string> = {
      200: 'OK',
      201: 'Created',
      202: 'Accepted',
      204: 'No Content',
      301: 'Moved Permanently',
      302: 'Found',
      304: 'Not Modified',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    };
    return statusTexts[code] || '';
  };

  const getStatusStyle = (code: number | string) => {
    if (code === 'ERROR') {
      return { background: 'rgba(255, 107, 107, 0.15)', color: 'var(--error)' };
    }
    const num = Number(code);
    if (num >= 200 && num < 300) {
      return { background: 'rgba(0, 210, 160, 0.15)', color: 'var(--success)' };
    } else if (num >= 300 && num < 400) {
      return { background: 'rgba(255, 193, 7, 0.15)', color: 'var(--warning)' };
    } else {
      return { background: 'rgba(255, 107, 107, 0.15)', color: 'var(--error)' };
    }
  };

  const addQueryParam = () =>
    setQueryParams((prev) => [...prev, { key: '', value: '' }]);
  const removeQueryParam = (index: number) =>
    setQueryParams((prev) => prev.filter((_, i) => i !== index));
  const updateQueryParam = (
    index: number,
    field: 'key' | 'value',
    val: string,
  ) => {
    setQueryParams((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: val } : item)),
    );
  };

  const addHeader = () =>
    setHeaders((prev) => [...prev, { key: '', value: '' }]);
  const removeHeader = (index: number) =>
    setHeaders((prev) => prev.filter((_, i) => i !== index));
  const updateHeader = (index: number, field: 'key' | 'value', val: string) => {
    setHeaders((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: val } : item)),
    );
  };

  const applyBodyContentType = (
    currentHeaders: KeyVal[],
    mode: BodyMode,
  ): KeyVal[] => {
    const contentType = contentTypeForBodyMode(mode);
    const matchingIndex = currentHeaders.findIndex(
      (header) => header.key.toLowerCase() === 'content-type',
    );
    if (!contentType) {
      return currentHeaders.filter(
        (header) => header.key.toLowerCase() !== 'content-type',
      );
    }
    if (matchingIndex === -1) {
      return [...currentHeaders, { key: 'Content-Type', value: contentType }];
    }
    return currentHeaders.map((header, index) =>
      index === matchingIndex ? { ...header, value: contentType } : header,
    );
  };

  const handleBodyModeChange = (nextMode: BodyMode) => {
    setBodyMode(nextMode);
    setHeaders((currentHeaders) =>
      applyBodyContentType(currentHeaders, nextMode),
    );
    if (
      (nextMode === 'form-data' || nextMode === 'urlencoded') &&
      bodyFields.length === 0
    ) {
      setBodyFields([{ key: '', value: '' }]);
    }
  };

  const addBodyField = () =>
    setBodyFields((prev) => [...prev, { key: '', value: '' }]);
  const removeBodyField = (index: number) =>
    setBodyFields((prev) => prev.filter((_, i) => i !== index));
  const updateBodyField = (
    index: number,
    field: 'key' | 'value',
    value: string,
  ) => {
    setBodyFields((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const formatJsonBody = () => {
    if (!reqBody.trim()) return;
    try {
      setReqBody(JSON.stringify(JSON.parse(reqBody), null, 2));
    } catch (err: any) {
      alert('Invalid JSON request body: ' + err.message);
    }
  };

  const handleJsonEditorMount = (_editor: any, monaco: Monaco) => {
    completionProviderRef.current?.dispose();
    completionProviderRef.current =
      monaco.languages.registerCompletionItemProvider('json', {
        triggerCharacters: ['{', ',', ' '],
        provideCompletionItems: (model: any, position: any) => {
          const properties = bodySchemaRef.current?.properties;
          if (!properties || typeof properties !== 'object')
            return { suggestions: [] };
          const prefix = model
            .getLineContent(position.lineNumber)
            .slice(0, position.column - 1);
          const openKey = /"([^"\n]*)$/.exec(prefix);
          const range = openKey
            ? {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: position.column - openKey[1].length,
                endColumn: position.column,
              }
            : undefined;
          return {
            suggestions: Object.entries(properties).map(
              ([key, property]: [string, any]) => {
                const sample = JSON.stringify(
                  generateMockData(key, property),
                  null,
                  2,
                );
                return {
                  label: key,
                  kind: monaco.languages.CompletionItemKind.Property,
                  detail:
                    property?.description || property?.type || 'Schema field',
                  documentation: property?.description,
                  insertText: openKey
                    ? `${key}": ${sample}`
                    : `"${key}": ${sample}`,
                  range,
                };
              },
            ),
          };
        },
      });
  };

  const handleCopyResponse = () => {
    if (!response) return;
    const txt =
      typeof response.body === 'object'
        ? JSON.stringify(response.body, null, 2)
        : String(response.body);
    navigator.clipboard.writeText(txt).then(() => {
      alert('Copied response body!');
    });
  };

  const RenderPayloadSection = ({
    label,
    data,
  }: {
    label: string;
    data: any;
  }) => {
    const hasData = data && Object.keys(data).length > 0;
    const [open, setOpen] = useState(label === 'body' || label === 'state');

    return (
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 8px',
          background: 'var(--bg-secondary)',
          marginBottom: '4px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontWeight: hasData ? 600 : 400,
            color: hasData ? 'var(--text-primary)' : 'var(--text-muted)',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onClick={() => hasData && setOpen(!open)}
        >
          <span>{label}</span>
          <span>{hasData ? (open ? '▼' : '▶') : '—'}</span>
        </div>
        {hasData && open && (
          <pre
            style={{
              marginTop: '6px',
              fontSize: '11px',
              color: 'var(--text-primary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              fontFamily: 'var(--font-mono)',
              textAlign: 'left',
            }}
          >
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">Request Tester</div>
        <div className="panel-subtitle">
          Interact with and test routes directly against your in-memory Axiomify
          app instance
        </div>
      </div>

      <div className="search-bar">
        <select
          className="select-input"
          style={{ maxWidth: '400px' }}
          onChange={handleRouteSelectChange}
          value={`${method} ${path}`}
        >
          <option value="">-- Choose a discovered route to pre-fill --</option>
          {(discovery.routes || [])
            .filter((r) => !r.isWs)
            .map((r) => (
              <option
                key={`${r.method} ${r.path}`}
                value={`${r.method} ${r.path}`}
              >
                {r.method} {r.path}
              </option>
            ))}
        </select>
      </div>

      <div
        className="tester-section"
        style={{
          marginBottom: '16px',
          display: 'grid',
          gridTemplateColumns: 'minmax(260px, 1fr) minmax(300px, 1fr)',
          gap: '16px',
          alignItems: 'start',
        }}
      >
        <div>
          <div className="tester-section-title" style={{ marginBottom: '8px' }}>
            📁 Request Collections
          </div>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              marginBottom: '8px',
            }}
          >
            <select
              className="select-input"
              value={selectedCollectionId}
              onChange={(event) => setSelectedCollectionId(event.target.value)}
              style={{ margin: 0, flex: 1 }}
            >
              <option value="">Select collection</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name} ({collection.requests.length})
                </option>
              ))}
            </select>
            <button
              className="btn btn-secondary"
              style={{ margin: 0, padding: '6px 9px', fontSize: '11px' }}
              onClick={createCollection}
            >
              New
            </button>
            <button
              className="btn btn-secondary"
              style={{ margin: 0, padding: '6px 9px', fontSize: '11px' }}
              onClick={saveCurrentRequest}
              title="File uploads are not saved in a collection"
            >
              Save request
            </button>
          </div>
          {collections
            .find((collection) => collection.id === selectedCollectionId)
            ?.requests.map((request) => (
              <div
                key={request.id}
                style={{
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'center',
                  padding: '4px 0',
                }}
              >
                <button
                  className="btn btn-secondary"
                  style={{
                    flex: 1,
                    margin: 0,
                    padding: '5px 8px',
                    textAlign: 'left',
                    fontSize: '11px',
                  }}
                  onClick={() => applySavedRequest(request)}
                >
                  <strong>{request.method}</strong> {request.name}
                </button>
                <button
                  className="btn btn-danger"
                  style={{ margin: 0, padding: '4px 7px', fontSize: '10px' }}
                  onClick={() => deleteSavedRequest(request.id)}
                >
                  Delete
                </button>
              </div>
            ))}
        </div>

        <div>
          <div className="tester-section-title" style={{ marginBottom: '8px' }}>
            🌐 Environments
          </div>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              marginBottom: '8px',
            }}
          >
            <select
              className="select-input"
              value={selectedEnvironmentId}
              onChange={(event) => handleEnvironmentSelect(event.target.value)}
              style={{ margin: 0, flex: 1 }}
            >
              <option value="">No environment</option>
              {environments.map((environment) => (
                <option key={environment.id} value={environment.id}>
                  {environment.name}
                </option>
              ))}
            </select>
            <button
              className="btn btn-secondary"
              style={{ margin: 0, padding: '6px 9px', fontSize: '11px' }}
              onClick={createEnvironment}
            >
              New
            </button>
            <button
              className="btn btn-secondary"
              style={{ margin: 0, padding: '6px 9px', fontSize: '11px' }}
              onClick={saveEnvironment}
            >
              Save
            </button>
          </div>
          {selectedEnvironmentId && (
            <>
              {environmentVariables.map((variable, index) => (
                <div
                  key={index}
                  className="kv-row"
                  style={{ marginBottom: '6px' }}
                >
                  <input
                    className="text-input"
                    aria-label="Environment variable name"
                    placeholder="Variable"
                    value={variable.key}
                    onChange={(event) =>
                      setEnvironmentVariables((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, key: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <input
                    className="text-input"
                    aria-label="Environment variable value"
                    placeholder="Value"
                    value={variable.value}
                    onChange={(event) =>
                      setEnvironmentVariables((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, value: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <button
                    className="btn btn-danger"
                    style={{ margin: 0 }}
                    onClick={() =>
                      setEnvironmentVariables((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '11px', margin: 0 }}
                onClick={() =>
                  setEnvironmentVariables((current) => [
                    ...current,
                    { key: '', value: '' },
                  ])
                }
              >
                + Add variable
              </button>
              <div
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  marginTop: '6px',
                }}
              >
                Use <code>{'{{variable}}'}</code> in paths, query values,
                headers, and request bodies. Saved values stay in this browser
                only.
              </div>
            </>
          )}
        </div>
      </div>

      <div className="tester-container">
        {/* Replay History Sidebar */}
        <div
          className="tester-section"
          style={{ maxHeight: '700px', overflowY: 'auto' }}
        >
          <div
            className="tester-section-title"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              marginBottom: '8px',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>⏱️</span> Replay History
            </span>
            <button
              className="btn btn-secondary"
              style={{
                padding: '2px 8px',
                fontSize: '10px',
                borderRadius: 'var(--radius-sm)',
                margin: 0,
              }}
              onClick={clearAllReplays}
            >
              Clear
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {replays.length === 0 ? (
              <div
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '12px',
                  textAlign: 'center',
                  padding: '16px 0',
                }}
              >
                No execution runs.
              </div>
            ) : (
              replays.map((item) => {
                const isSuccess =
                  item.status && item.status >= 200 && item.status < 300;
                return (
                  <button
                    key={item.id}
                    className="nav-item"
                    style={{
                      textAlign: 'left',
                      flexGrow: 1,
                      padding: '8px 10px',
                      fontSize: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-secondary)',
                      borderRadius: 'var(--radius-sm)',
                      margin: 0,
                      width: '100%',
                    }}
                    onClick={() => handleReplayClick(item)}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        width: '100%',
                      }}
                    >
                      <span
                        className={`method-badge method-${item.method}`}
                        style={{ fontSize: '9px', padding: '1px 4px' }}
                      >
                        {item.method}
                      </span>
                      <span
                        style={{
                          color: isSuccess ? 'var(--success)' : 'var(--error)',
                          fontWeight: 'bold',
                          fontSize: '11px',
                        }}
                      >
                        {item.status || 'ERROR'}
                      </span>
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        color: 'var(--text-primary)',
                        wordBreak: 'break-all',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        width: '100%',
                      }}
                    >
                      {item.path}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        width: '100%',
                      }}
                    >
                      <span>
                        {item.duration === undefined || item.duration === null
                          ? ''
                          : formatDuration(item.duration, 0)}
                      </span>
                      <span>
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Request Builder */}
        <div className="tester-section">
          <div className="tester-section-title">
            <span>📝</span> Request Builder
          </div>

          <div className="form-row">
            <div
              className="form-group"
              style={{ width: '120px', flex: 'none' }}
            >
              <label className="form-label">Method</label>
              <select
                className="select-input"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {[
                  'GET',
                  'POST',
                  'PUT',
                  'DELETE',
                  'PATCH',
                  'HEAD',
                  'OPTIONS',
                ].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Path</label>
              <input
                className="text-input"
                type="text"
                placeholder="/api/v1/resource"
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </div>
          </div>

          {/* Path Parameters */}
          {pathParams.length > 0 && (
            <div className="form-group">
              <label className="form-label">Path Parameters</label>
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
              >
                {pathParams.map((p, i) => (
                  <div key={i} className="kv-row">
                    <input
                      className="text-input"
                      type="text"
                      readOnly
                      value={p.key}
                      style={{
                        opacity: 0.7,
                        background: 'var(--bg-secondary)',
                        flex: 1,
                      }}
                    />
                    <input
                      className="text-input"
                      type="text"
                      placeholder="Value"
                      value={p.value}
                      style={{ flex: 2 }}
                      onChange={(e) => {
                        const nextVal = e.target.value;
                        setPathParams((prev) =>
                          prev.map((item, idx) =>
                            idx === i ? { ...item, value: nextVal } : item,
                          ),
                        );
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Query Params */}
          <div className="form-group">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '4px',
              }}
            >
              <label className="form-label">Query Parameters</label>
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '11px' }}
                onClick={addQueryParam}
              >
                + Add Param
              </button>
            </div>
            <div>
              {queryParams.map((q, i) => (
                <div key={i} className="kv-row">
                  <input
                    className="text-input"
                    type="text"
                    placeholder="Key"
                    value={q.key}
                    onChange={(e) => updateQueryParam(i, 'key', e.target.value)}
                  />
                  <input
                    className="text-input"
                    type="text"
                    placeholder="Value"
                    value={q.value}
                    onChange={(e) =>
                      updateQueryParam(i, 'value', e.target.value)
                    }
                  />
                  <button
                    className="btn btn-danger"
                    style={{ margin: 0 }}
                    onClick={() => removeQueryParam(i)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Headers */}
          <div className="form-group">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '4px',
              }}
            >
              <label className="form-label">Headers</label>
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '11px' }}
                onClick={addHeader}
              >
                + Add Header
              </button>
            </div>
            <div>
              {headers.map((h, i) => (
                <div key={i} className="kv-row">
                  <input
                    className="text-input"
                    type="text"
                    placeholder="Key"
                    value={h.key}
                    onChange={(e) => updateHeader(i, 'key', e.target.value)}
                  />
                  <input
                    className="text-input"
                    type="text"
                    placeholder="Value"
                    value={h.value}
                    onChange={(e) => updateHeader(i, 'value', e.target.value)}
                  />
                  <button
                    className="btn btn-danger"
                    style={{ margin: 0 }}
                    onClick={() => removeHeader(i)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="form-group">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '4px',
              }}
            >
              <label className="form-label" htmlFor="request-body-mode">
                Body
              </label>
              <select
                id="request-body-mode"
                className="select-input"
                style={{
                  width: 'auto',
                  margin: 0,
                  padding: '5px 8px',
                  fontSize: '12px',
                }}
                value={bodyMode}
                onChange={(e) =>
                  handleBodyModeChange(e.target.value as BodyMode)
                }
              >
                {BODY_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {bodyMode === 'none' && (
              <div
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '12px',
                  padding: '12px',
                  border: '1px dashed var(--border)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                This request will be sent without a body.
              </div>
            )}

            {bodyMode === 'json' && (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '5px',
                  }}
                >
                  <span
                    style={{ color: 'var(--text-muted)', fontSize: '11px' }}
                  >
                    {selectedBodySchema?.properties
                      ? 'Schema fields autocomplete as you type (or press Ctrl/Cmd+Space).'
                      : 'Valid JSON is sent as application/json.'}
                  </span>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '3px 7px', fontSize: '11px', margin: 0 }}
                    onClick={formatJsonBody}
                  >
                    Format JSON
                  </button>
                </div>
                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    overflow: 'hidden',
                    minHeight: '220px',
                  }}
                >
                  <Editor
                    height="220px"
                    language="json"
                    theme={isDark ? 'vs-dark' : 'light'}
                    value={reqBody}
                    onChange={(value) => setReqBody(value || '')}
                    onMount={handleJsonEditorMount}
                    options={{
                      automaticLayout: true,
                      minimap: { enabled: false },
                      fontSize: 13,
                      fontFamily: 'JetBrains Mono, Menlo, monospace',
                      suggest: { showProperties: true },
                    }}
                  />
                </div>
              </>
            )}

            {bodyMode === 'text' && (
              <textarea
                className="textarea-input"
                aria-label="Raw text request body"
                placeholder="Plain text request body"
                value={reqBody}
                onChange={(e) => setReqBody(e.target.value)}
              />
            )}

            {(bodyMode === 'form-data' || bodyMode === 'urlencoded') && (
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
              >
                {bodyFields.map((field, index) => (
                  <div key={index} className="kv-row">
                    <input
                      className="text-input"
                      aria-label={`${bodyMode} field name`}
                      placeholder="Key"
                      value={field.key}
                      onChange={(e) =>
                        updateBodyField(index, 'key', e.target.value)
                      }
                    />
                    <input
                      className="text-input"
                      aria-label={`${bodyMode} field value`}
                      placeholder="Value"
                      value={field.value}
                      onChange={(e) =>
                        updateBodyField(index, 'value', e.target.value)
                      }
                    />
                    <button
                      className="btn btn-danger"
                      style={{ margin: 0 }}
                      onClick={() => removeBodyField(index)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  className="btn btn-secondary"
                  style={{
                    alignSelf: 'flex-start',
                    padding: '4px 8px',
                    fontSize: '11px',
                    margin: 0,
                  }}
                  onClick={addBodyField}
                >
                  + Add Field
                </button>
              </div>
            )}
          </div>

          {bodyMode === 'form-data' && (
            <div className="form-group">
              <label className="form-label">File uploads</label>
              <input
                className="text-input"
                type="file"
                multiple
                onChange={handleFilesSelected}
              />
              <div
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  marginTop: '5px',
                }}
              >
                Form fields and files are sent as a genuine{' '}
                <code>multipart/form-data</code> request.
              </div>
              {uploads.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    marginTop: '8px',
                  }}
                >
                  {uploads.map((upload, index) => (
                    <div
                      key={`${upload.name}-${index}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '12px',
                      }}
                    >
                      <span style={{ flex: 1, fontFamily: 'var(--font-mono)' }}>
                        📎 {upload.name}
                      </span>
                      <input
                        className="text-input"
                        aria-label={`Multipart field for ${upload.name}`}
                        value={upload.field}
                        onChange={(e) =>
                          setUploads((prev) =>
                            prev.map((item, i) =>
                              i === index
                                ? { ...item, field: e.target.value }
                                : item,
                            ),
                          )
                        }
                        style={{ width: '100px' }}
                      />
                      <button
                        className="btn btn-danger"
                        style={{ margin: 0, padding: '4px 8px' }}
                        onClick={() =>
                          setUploads((prev) =>
                            prev.filter((_, i) => i !== index),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: '10px' }}>
            <button
              className="btn"
              style={{ width: '100%', margin: 0 }}
              onClick={handleSendRequest}
              disabled={sending}
            >
              {sending ? (
                <>
                  <div
                    className="spinner"
                    style={{
                      width: '14px',
                      height: '14px',
                      borderWidth: '2px',
                      marginRight: '8px',
                    }}
                  />
                  Sending...
                </>
              ) : (
                <>
                  <span>⚡</span> Send Request
                </>
              )}
            </button>
          </div>
        </div>

        {/* Response Viewer */}
        <div
          className="tester-section"
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          <div className="tester-section-title">
            <span>📥</span> Response
          </div>

          {!response ? (
            <div className="response-placeholder">
              <span>📥</span>
              <span>Send a request to see the response here</span>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                flex: 1,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <span className="form-label" style={{ marginRight: '8px' }}>
                    Status
                  </span>
                  <span
                    className="response-status-badge"
                    style={getStatusStyle(response.status)}
                  >
                    {response.status}{' '}
                    {response.status !== 'ERROR' &&
                      getStatusText(response.status)}
                  </span>
                </div>
                {response.status !== 'ERROR' && (
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '12px', margin: 0 }}
                    onClick={handleCopyResponse}
                  >
                    Copy Body
                  </button>
                )}
              </div>

              {/* Response Headers */}
              {response.headers && Object.keys(response.headers).length > 0 && (
                <div className="form-group">
                  <label className="form-label">Headers</label>
                  <div className="response-headers-container">
                    <table className="response-headers-table">
                      <tbody>
                        {Object.entries(response.headers).map(([k, v]) => (
                          <tr key={k}>
                            <td className="response-headers-key">{k}</td>
                            <td className="response-headers-value">
                              {String(v)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Response Body */}
              <div
                className="form-group"
                style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
              >
                <label className="form-label">Body</label>
                <pre
                  className="response-body-pre"
                  style={{ textAlign: 'left' }}
                >
                  {response.status === 'ERROR'
                    ? response.body
                    : response.body !== null && response.body !== undefined
                      ? typeof response.body === 'object'
                        ? JSON.stringify(response.body, null, 2)
                        : String(response.body)
                      : '[Empty Response Body]'}
                </pre>
              </div>

              {/* Validation Errors */}
              {response.profile?.validationErrors &&
                response.profile.validationErrors.length > 0 && (
                  <div className="form-group" style={{ marginTop: '16px' }}>
                    <label
                      className="form-label"
                      style={{ color: 'var(--error)', fontWeight: 600 }}
                    >
                      Validation Errors
                    </label>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        background: 'rgba(239, 68, 68, 0.05)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        borderRadius: 'var(--radius-md)',
                        padding: '16px',
                        textAlign: 'left',
                      }}
                    >
                      {response.profile.validationErrors.map(
                        (err: any, errIdx: number) => (
                          <div
                            key={errIdx}
                            style={{
                              background: 'rgba(239, 68, 68, 0.05)',
                              border: '1px solid rgba(239, 68, 68, 0.15)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '10px',
                              fontSize: '12px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px',
                            }}
                          >
                            <div>
                              <strong style={{ color: 'var(--error)' }}>
                                Field:
                              </strong>{' '}
                              <code
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontWeight: 600,
                                  color: 'var(--error)',
                                }}
                              >
                                {err.field}
                              </code>{' '}
                              (
                              <span
                                style={{
                                  textTransform: 'uppercase',
                                  fontSize: '10px',
                                  fontWeight: 600,
                                  color: 'var(--text-secondary)',
                                }}
                              >
                                {err.location}
                              </span>
                              )
                            </div>
                            <div>
                              <strong>Reason:</strong> {err.reason}
                            </div>
                            <div>
                              <strong>Received:</strong>{' '}
                              <code
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  background: 'var(--bg-tertiary)',
                                  padding: '2px 4px',
                                  borderRadius: '3px',
                                  fontSize: '11px',
                                }}
                              >
                                {JSON.stringify(err.received)}
                              </code>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}

              {/* Timeline Profiler */}
              {response.profile?.timeline &&
                response.profile.timeline.length > 0 && (
                  <div className="form-group" style={{ marginTop: '16px' }}>
                    <label className="form-label">Execution Timeline</label>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        padding: '16px',
                      }}
                    >
                      {(() => {
                        const timeline = response.profile.timeline.filter(
                          (item: any) => item && typeof item === 'object',
                        );
                        const maxDuration = Math.max(
                          ...timeline.map(
                            (item: any) => Number(item.duration) || 0,
                          ),
                          1,
                        );
                        return timeline.map((item: any, itemIdx: number) => {
                          const duration = Number(item.duration) || 0;
                          const percentage = Math.max(
                            (duration / maxDuration) * 100,
                            2,
                          );
                          let typeClass = 'timeline-type-middleware';
                          if (item.type === 'hook')
                            typeClass = 'timeline-type-hook';
                          else if (item.type === 'handler')
                            typeClass = 'timeline-type-handler';

                          const isClickable = item.before && item.after;
                          const isDetailOpen = expandedTimelineItem === itemIdx;

                          return (
                            <div
                              key={itemIdx}
                              className={`timeline-row ${isClickable ? 'clickable' : ''}`}
                              style={{ textAlign: 'left' }}
                              onClick={() =>
                                isClickable &&
                                setExpandedTimelineItem(
                                  isDetailOpen ? null : itemIdx,
                                )
                              }
                            >
                              <div className="timeline-label-row">
                                <div>
                                  <span
                                    style={{
                                      color: 'var(--text-primary)',
                                      fontSize: '12px',
                                    }}
                                  >
                                    {item.name}
                                  </span>
                                  <span
                                    className={`timeline-type-badge ${typeClass}`}
                                  >
                                    {item.type}
                                  </span>
                                </div>
                                <span className="timeline-duration">
                                  {formatDuration(item.duration)}
                                </span>
                              </div>
                              <div className="timeline-bar-container">
                                <div
                                  className="timeline-bar"
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>

                              {isClickable && isDetailOpen && (
                                <div
                                  style={{
                                    padding: '12px',
                                    margin: '4px 0 12px 0',
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 'var(--radius-sm)',
                                  }}
                                >
                                  <div
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: '1fr 1fr',
                                      gap: '16px',
                                    }}
                                  >
                                    <div>
                                      <div
                                        style={{
                                          fontSize: '11px',
                                          fontWeight: 700,
                                          color: 'var(--text-secondary)',
                                          marginBottom: '6px',
                                          textTransform: 'uppercase',
                                        }}
                                      >
                                        📥 State Before
                                      </div>
                                      <RenderPayloadSection
                                        label="body"
                                        data={item.before?.body}
                                      />
                                      <RenderPayloadSection
                                        label="state"
                                        data={item.before?.state}
                                      />
                                      <RenderPayloadSection
                                        label="headers"
                                        data={item.before?.headers}
                                      />
                                      <RenderPayloadSection
                                        label="query"
                                        data={item.before?.query}
                                      />
                                      <RenderPayloadSection
                                        label="params"
                                        data={item.before?.params}
                                      />
                                    </div>
                                    <div>
                                      <div
                                        style={{
                                          fontSize: '11px',
                                          fontWeight: 700,
                                          color: 'var(--accent)',
                                          marginBottom: '6px',
                                          textTransform: 'uppercase',
                                        }}
                                      >
                                        📤 State After
                                      </div>
                                      <RenderPayloadSection
                                        label="body"
                                        data={item.after?.body}
                                      />
                                      <RenderPayloadSection
                                        label="state"
                                        data={item.after?.state}
                                      />
                                      <RenderPayloadSection
                                        label="headers"
                                        data={item.after?.headers}
                                      />
                                      <RenderPayloadSection
                                        label="query"
                                        data={item.after?.query}
                                      />
                                      <RenderPayloadSection
                                        label="params"
                                        data={item.after?.params}
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}

              {/* Database Queries */}
              {response.profile?.queries &&
                response.profile.queries.length > 0 && (
                  <div className="form-group" style={{ marginTop: '16px' }}>
                    <label className="form-label">Database Queries</label>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        padding: '16px',
                        textAlign: 'left',
                      }}
                    >
                      {response.profile.queries
                        .filter((item: any) => item && typeof item === 'object')
                        .map((item: any, qIdx: number) => (
                          <div key={qIdx} className="db-query-row">
                            <div className="db-query-header">
                              <span className="db-query-badge">
                                DATABASE QUERY
                              </span>
                              <span className="db-query-duration">
                                {formatDuration(item.duration)}
                              </span>
                            </div>
                            <pre className="db-query-sql">{item.query}</pre>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
