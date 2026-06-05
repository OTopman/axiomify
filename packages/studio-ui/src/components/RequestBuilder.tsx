import React, { useState, useEffect } from 'react';
import { DiscoveryData, RouteItem, SchemaItem } from '../types';
import { apiFetch } from '../utils/api';

interface RequestBuilderProps {
  discovery: DiscoveryData;
  prefilledMethod?: string;
  prefilledPath?: string;
  onClearPrefill?: () => void;
}

interface KeyVal {
  key: string;
  value: string;
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

export const RequestBuilder: React.FC<RequestBuilderProps> = ({
  discovery,
  prefilledMethod = '',
  prefilledPath = '',
  onClearPrefill,
}) => {
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('');
  const [queryParams, setQueryParams] = useState<KeyVal[]>([]);
  const [headers, setHeaders] = useState<KeyVal[]>([
    { key: 'Content-Type', value: 'application/json' }
  ]);
  const [reqBody, setReqBody] = useState('');
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<any | null>(null);
  const [replays, setReplays] = useState<ReplayHistoryItem[]>([]);
  const [expandedTimelineItem, setExpandedTimelineItem] = useState<number | null>(null);

  // Load replays list on mount
  useEffect(() => {
    fetchReplays();
  }, []);

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
        setReplays(data.replays || []);
      }
    } catch (err) {
      console.error('Failed to fetch request replays:', err);
    }
  };

  const clearAllReplays = async () => {
    if (!confirm('Are you sure you want to clear request history?')) return;
    try {
      const res = await apiFetch('/__studio/api/request/replays', { method: 'DELETE' });
      if (res.ok) {
        setReplays([]);
      }
    } catch (err) {
      console.error('Failed to clear replays:', err);
    }
  };

  const generateJsonTemplate = (schema: any): any => {
    if (!schema) return null;
    if (schema.type === 'object' && schema.properties) {
      const obj: Record<string, any> = {};
      for (const [k, prop] of Object.entries(schema.properties)) {
        obj[k] = generateJsonTemplate(prop);
      }
      return obj;
    }
    if (schema.type === 'array') {
      return [generateJsonTemplate(schema.items)];
    }
    if (schema.type === 'string') {
      return schema.description || 'string';
    }
    if (schema.type === 'number' || schema.type === 'integer') {
      return 0;
    }
    if (schema.type === 'boolean') {
      return true;
    }
    return null;
  };

  const prefillFromRoute = (m: string, p: string) => {
    const schema = discovery.schemas.find(s => s.method === m && s.path === p);
    if (schema && schema.body) {
      const template = generateJsonTemplate(schema.body);
      setReqBody(JSON.stringify(template, null, 2));
    } else {
      setReqBody('');
    }

    if (schema && schema.query && schema.query.properties) {
      const q: KeyVal[] = Object.keys(schema.query.properties).map(k => ({
        key: k,
        value: '',
      }));
      setQueryParams(q);
    } else {
      setQueryParams([]);
    }
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

  const handleReplayClick = async (replay: ReplayHistoryItem) => {
    setMethod(replay.method);
    setPath(replay.path);
    
    // Parse query params
    const q: KeyVal[] = [];
    if (replay.request?.query) {
      Object.entries(replay.request.query).forEach(([k, v]) => {
        q.push({ key: k, value: String(v) });
      });
    }
    setQueryParams(q);

    // Parse headers
    const h: KeyVal[] = [];
    if (replay.request?.headers) {
      Object.entries(replay.request.headers).forEach(([k, v]) => {
        h.push({ key: k, value: String(v) });
      });
    }
    setHeaders(h);

    // Parse body
    if (replay.request?.body) {
      setReqBody(JSON.stringify(replay.request.body, null, 2));
    } else {
      setReqBody('');
    }

    // Load full replay if available
    try {
      const res = await apiFetch(`/__studio/api/request/replay?id=${encodeURIComponent(replay.id)}`);
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

    const query: Record<string, string> = {};
    queryParams.forEach(q => {
      if (q.key.trim()) query[q.key.trim()] = q.value.trim();
    });

    const hdrs: Record<string, string> = {};
    headers.forEach(h => {
      if (h.key.trim()) hdrs[h.key.trim()] = h.value.trim();
    });

    let body: any = undefined;
    if (reqBody.trim()) {
      try {
        body = JSON.parse(reqBody.trim());
      } catch (err: any) {
        alert('Invalid JSON request body: ' + err.message);
        setSending(false);
        return;
      }
    }

    try {
      const res = await apiFetch('/__studio/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, path, headers: hdrs, query, body }),
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

  const getStatusText = (code: number) => {
    const statusTexts: Record<number, string> = {
      200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
      301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
      400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
      500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable'
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

  const addQueryParam = () => setQueryParams(prev => [...prev, { key: '', value: '' }]);
  const removeQueryParam = (index: number) => setQueryParams(prev => prev.filter((_, i) => i !== index));
  const updateQueryParam = (index: number, field: 'key' | 'value', val: string) => {
    setQueryParams(prev => prev.map((item, i) => i === index ? { ...item, [field]: val } : item));
  };

  const addHeader = () => setHeaders(prev => [...prev, { key: '', value: '' }]);
  const removeHeader = (index: number) => setHeaders(prev => prev.filter((_, i) => i !== index));
  const updateHeader = (index: number, field: 'key' | 'value', val: string) => {
    setHeaders(prev => prev.map((item, i) => i === index ? { ...item, [field]: val } : item));
  };

  const handleCopyResponse = () => {
    if (!response) return;
    const txt = typeof response.body === 'object' ? JSON.stringify(response.body, null, 2) : String(response.body);
    navigator.clipboard.writeText(txt).then(() => {
      alert('Copied response body!');
    });
  };

  const renderPayloadSection = (label: string, data: any) => {
    const hasData = data && Object.keys(data).length > 0;
    const [open, setOpen] = useState(label === 'body' || label === 'state');

    return (
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', background: 'var(--bg-secondary)', marginBottom: '4px' }}>
        <div 
          style={{ display: 'flex', justifyContent: 'space-between', fontWeight: hasData ? 600 : 400, color: hasData ? 'var(--text-primary)' : 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}
          onClick={() => hasData && setOpen(!open)}
        >
          <span>{label}</span>
          <span>{hasData ? (open ? '▼' : '▶') : '—'}</span>
        </div>
        {hasData && open && (
          <pre style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'var(--font-mono)', textAlign: 'left' }}>
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
        <div className="panel-subtitle">Interact with and test routes directly against your in-memory Axiomify app instance</div>
      </div>

      <div className="search-bar">
        <select 
          className="select-input" 
          style={{ maxWidth: '400px' }}
          onChange={handleRouteSelectChange}
          value={`${method} ${path}`}
        >
          <option value="">-- Choose a discovered route to pre-fill --</option>
          {(discovery.routes || []).filter(r => !r.isWs).map(r => (
            <option key={`${r.method} ${r.path}`} value={`${r.method} ${r.path}`}>
              {r.method} {r.path}
            </option>
          ))}
        </select>
      </div>

      <div className="tester-container">
        {/* Replay History Sidebar */}
        <div className="tester-section" style={{ maxHeight: '700px', overflowY: 'auto' }}>
          <div className="tester-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '8px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span>⏱️</span> Replay History</span>
            <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: '10px', borderRadius: 'var(--radius-sm)', margin: 0 }} onClick={clearAllReplays}>Clear</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {replays.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '16px 0' }}>No execution runs.</div>
            ) : (
              replays.map(item => {
                const isSuccess = item.status && item.status >= 200 && item.status < 300;
                return (
                  <button
                    key={item.id}
                    className="nav-item"
                    style={{ textAlign: 'left', flexGrow: 1, padding: '8px 10px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', margin: 0, width: '100%' }}
                    onClick={() => handleReplayClick(item)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <span className={`method-badge method-${item.method}`} style={{ fontSize: '9px', padding: '1px 4px' }}>{item.method}</span>
                      <span style={{ color: isSuccess ? 'var(--success)' : 'var(--error)', fontWeight: 'bold', fontSize: '11px' }}>
                        {item.status || 'ERROR'}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-primary)', wordBreak: 'break-all', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                      {item.path}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', width: '100%' }}>
                      <span>{item.duration ? `${item.duration.toFixed(0)}ms` : ''}</span>
                      <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
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
            <div className="form-group" style={{ width: '120px', flex: 'none' }}>
              <label className="form-label">Method</label>
              <select className="select-input" value={method} onChange={e => setMethod(e.target.value)}>
                {['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Path</label>
              <input className="text-input" type="text" placeholder="/api/v1/resource" value={path} onChange={e => setPath(e.target.value)} />
            </div>
          </div>

          {/* Query Params */}
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label className="form-label">Query Parameters</label>
              <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={addQueryParam}>+ Add Param</button>
            </div>
            <div>
              {queryParams.map((q, i) => (
                <div key={i} className="kv-row">
                  <input className="text-input" type="text" placeholder="Key" value={q.key} onChange={e => updateQueryParam(i, 'key', e.target.value)} />
                  <input className="text-input" type="text" placeholder="Value" value={q.value} onChange={e => updateQueryParam(i, 'value', e.target.value)} />
                  <button className="btn btn-danger" style={{ margin: 0 }} onClick={() => removeQueryParam(i)}>Remove</button>
                </div>
              ))}
            </div>
          </div>

          {/* Headers */}
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label className="form-label">Headers</label>
              <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={addHeader}>+ Add Header</button>
            </div>
            <div>
              {headers.map((h, i) => (
                <div key={i} className="kv-row">
                  <input className="text-input" type="text" placeholder="Key" value={h.key} onChange={e => updateHeader(i, 'key', e.target.value)} />
                  <input className="text-input" type="text" placeholder="Value" value={h.value} onChange={e => updateHeader(i, 'value', e.target.value)} />
                  <button className="btn btn-danger" style={{ margin: 0 }} onClick={() => removeHeader(i)}>Remove</button>
                </div>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="form-group">
            <label className="form-label">Request Body (JSON)</label>
            <textarea className="textarea-input" placeholder='{"key": "value"}' value={reqBody} onChange={e => setReqBody(e.target.value)} />
          </div>

          <div style={{ marginTop: '10px' }}>
            <button className="btn" style={{ width: '100%', margin: 0 }} onClick={handleSendRequest} disabled={sending}>
              {sending ? (
                <>
                  <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', marginRight: '8px' }} />
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
        <div className="tester-section" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="tester-section-title">
            <span>📥</span> Response
          </div>

          {!response ? (
            <div className="response-placeholder">
              <span>📥</span>
              <span>Send a request to see the response here</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span className="form-label" style={{ marginRight: '8px' }}>Status</span>
                  <span className="response-status-badge" style={getStatusStyle(response.status)}>
                    {response.status} {response.status !== 'ERROR' && getStatusText(response.status)}
                  </span>
                </div>
                {response.status !== 'ERROR' && (
                  <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', margin: 0 }} onClick={handleCopyResponse}>Copy Body</button>
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
                            <td className="response-headers-value">{String(v)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Response Body */}
              <div className="form-group" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <label className="form-label">Body</label>
                <pre className="response-body-pre" style={{ textAlign: 'left' }}>
                  {response.status === 'ERROR'
                    ? response.body
                    : (response.body !== null && response.body !== undefined
                      ? (typeof response.body === 'object' ? JSON.stringify(response.body, null, 2) : String(response.body))
                      : '[Empty Response Body]')}
                </pre>
              </div>

              {/* Validation Errors */}
              {response.profile?.validationErrors && response.profile.validationErrors.length > 0 && (
                <div className="form-group" style={{ marginTop: '16px' }}>
                  <label className="form-label" style={{ color: 'var(--error)', fontWeight: 600 }}>Validation Errors</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 'var(--radius-md)', padding: '16px', textAlign: 'left' }}>
                    {response.profile.validationErrors.map((err: any, errIdx: number) => (
                      <div key={errIdx} style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: 'var(--radius-sm)', padding: '10px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div>
                          <strong style={{ color: 'var(--error)' }}>Field:</strong> <code style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--error)' }}>{err.field}</code> (<span style={{ textTransform: 'uppercase', fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)' }}>{err.location}</span>)
                        </div>
                        <div><strong>Reason:</strong> {err.reason}</div>
                        <div>
                          <strong>Received:</strong> <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-tertiary)', padding: '2px 4px', borderRadius: '3px', fontSize: '11px' }}>{JSON.stringify(err.received)}</code>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline Profiler */}
              {response.profile?.timeline && response.profile.timeline.length > 0 && (
                <div className="form-group" style={{ marginTop: '16px' }}>
                  <label className="form-label">Execution Timeline</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px' }}>
                    {(() => {
                      const maxDuration = Math.max(...response.profile.timeline.map((t: any) => t.duration), 1);
                      return response.profile.timeline.map((item: any, itemIdx: number) => {
                        const percentage = Math.max((item.duration / maxDuration) * 100, 2);
                        let typeClass = 'timeline-type-middleware';
                        if (item.type === 'hook') typeClass = 'timeline-type-hook';
                        else if (item.type === 'handler') typeClass = 'timeline-type-handler';

                        const isClickable = item.before && item.after;
                        const isDetailOpen = expandedTimelineItem === itemIdx;

                        return (
                          <div key={itemIdx} className={`timeline-row ${isClickable ? 'clickable' : ''}`} style={{ textAlign: 'left' }} onClick={() => isClickable && setExpandedTimelineItem(isDetailOpen ? null : itemIdx)}>
                            <div className="timeline-label-row">
                              <div>
                                <span style={{ color: 'var(--text-primary)', fontSize: '12px' }}>{item.name}</span>
                                <span className={`timeline-type-badge ${typeClass}`}>{item.type}</span>
                              </div>
                              <span className="timeline-duration">{item.duration.toFixed(2)} ms</span>
                            </div>
                            <div className="timeline-bar-container">
                              <div className="timeline-bar" style={{ width: `${percentage}%` }} />
                            </div>

                            {isClickable && isDetailOpen && (
                              <div style={{ padding: '12px', margin: '4px 0 12px 0', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                  <div>
                                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase' }}>📥 State Before</div>
                                    {renderPayloadSection('body', item.before?.body)}
                                    {renderPayloadSection('state', item.before?.state)}
                                    {renderPayloadSection('headers', item.before?.headers)}
                                    {renderPayloadSection('query', item.before?.query)}
                                    {renderPayloadSection('params', item.before?.params)}
                                  </div>
                                  <div>
                                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent)', marginBottom: '6px', textTransform: 'uppercase' }}>📤 State After</div>
                                    {renderPayloadSection('body', item.after?.body)}
                                    {renderPayloadSection('state', item.after?.state)}
                                    {renderPayloadSection('headers', item.after?.headers)}
                                    {renderPayloadSection('query', item.after?.query)}
                                    {renderPayloadSection('params', item.after?.params)}
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
              {response.profile?.queries && response.profile.queries.length > 0 && (
                <div className="form-group" style={{ marginTop: '16px' }}>
                  <label className="form-label">Database Queries</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px', textAlign: 'left' }}>
                    {response.profile.queries.map((item: any, qIdx: number) => (
                      <div key={qIdx} className="db-query-row">
                        <div className="db-query-header">
                          <span className="db-query-badge">DATABASE QUERY</span>
                          <span className="db-query-duration">{item.duration.toFixed(2)} ms</span>
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
