import React, { useState, useEffect, useRef } from 'react';
import { DiscoveryData, RouteItem, SchemaItem, FindingItem, ServiceItem } from '../types';
import { apiFetch, getToken } from '../utils/api';

// ==========================================
// 1. SCHEMAS PANEL
// ==========================================
export const SchemasPanel: React.FC<{ discovery: DiscoveryData }> = ({ discovery }) => {
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});

  const toggleCard = (key: string) => {
    setOpenCards(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const schemas = discovery.schemas || [];

  if (schemas.length === 0) {
    return (
      <div>
        <div className="panel-header">
          <div className="panel-title">Schema Inspector</div>
          <div className="panel-subtitle">Validation schemas for each route (Zod → JSON Schema)</div>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">📐</div>
          <div className="empty-state-message">No schemas found — add Zod schemas to your routes</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">Schema Inspector</div>
        <div className="panel-subtitle">Validation schemas for each route (Zod → JSON Schema)</div>
      </div>
      <div>
        {schemas.map((s, idx) => {
          const key = `${s.method}:${s.path}:${idx}`;
          const isOpen = !!openCards[key];
          const sections: { label: string; data: any }[] = [];
          if (s.body) sections.push({ label: 'Body', data: s.body });
          if (s.query) sections.push({ label: 'Query', data: s.query });
          if (s.params) sections.push({ label: 'Params', data: s.params });
          if (s.response) sections.push({ label: 'Response', data: s.response });
          if (s.message) sections.push({ label: 'Message', data: s.message });
          if (s.files) sections.push({ label: 'Files', data: s.files });

          return (
            <div key={key} className={`schema-card ${isOpen ? 'open' : ''}`} style={{ textAlign: 'left' }}>
              <div className="schema-card-header" onClick={() => toggleCard(key)}>
                <span className="schema-card-chevron">{isOpen ? '▼' : '▶'}</span>
                <span className={`method-badge method-${s.method}`}>{s.method}</span>
                <span className="route-path" style={{ marginLeft: '8px' }}>{s.path}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: 'auto' }}>
                  {sections.length} schema{sections.length === 1 ? '' : 's'}
                </span>
              </div>
              {isOpen && (
                <div className="schema-card-body" style={{ padding: '0 16px 16px' }}>
                  {sections.map(sec => (
                    <div key={sec.label}>
                      <div className="schema-section-label">{sec.label}</div>
                      <pre className="schema-json" style={{ margin: 0 }}>
                        {JSON.stringify(sec.data, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ==========================================
// 2. OPENAPI PANEL
// ==========================================
export const OpenApiPanel: React.FC<{ discovery: DiscoveryData; onRefresh: () => void }> = ({ discovery, onRefresh }) => {
  const [syncing, setSyncing] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  const spec = discovery.openapi;
  const drift = discovery.drift;

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await apiFetch('/__studio/api/openapi/sync', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert('Successfully synced OpenAPI specification to openapi.json.');
        onRefresh();
      } else {
        alert('Error syncing spec: ' + data.message);
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleCopySpec = () => {
    if (!spec) return;
    navigator.clipboard.writeText(JSON.stringify(spec, null, 2)).then(() => {
      alert('Copied raw specification JSON!');
    });
  };

  const handleDownloadSpec = () => {
    if (!spec) return;
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'openapi.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderDriftCard = () => {
    if (!drift) return null;
    if (!drift.hasFile) {
      return (
        <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>OpenAPI File Sync</div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>No local <code style={{ fontFamily: 'var(--font-mono)' }}>openapi.json</code> file exists in the project root.</div>
          </div>
          <button className="btn" style={{ flex: 'none', background: 'var(--accent)' }} onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Create & Sync File'}
          </button>
        </div>
      );
    }

    if (!drift.synced) {
      return (
        <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '16px', textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--warning)' }}>⚠️ OpenAPI Spec Drift Detected</div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>The local <code style={{ fontFamily: 'var(--font-mono)' }}>openapi.json</code> file has diverged from the live API.</div>
            </div>
            <button className="btn" style={{ flex: 'none', background: 'var(--warning)', color: '#000' }} onClick={handleSync} disabled={syncing}>
              {syncing ? 'Syncing...' : 'Sync Schema to File'}
            </button>
          </div>
          <ul style={{ marginLeft: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            {(drift.diffs || []).map((d, i) => (
              <li key={i} style={{ marginBottom: '4px' }}>{d}</li>
            ))}
          </ul>
        </div>
      );
    }

    return (
      <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid var(--success)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--success)' }}>✅ OpenAPI Spec Synced</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>The local <code style={{ fontFamily: 'var(--font-mono)' }}>openapi.json</code> matches the live API spec perfectly.</div>
        </div>
        <button className="btn btn-secondary" style={{ flex: 'none', borderColor: 'var(--success)', color: 'var(--success)', margin: 0 }} onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Force Sync'}
        </button>
      </div>
    );
  };

  const specPaths = spec ? spec.paths || {} : {};

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">OpenAPI Viewer</div>
        <div className="panel-subtitle">Generated OpenAPI 3.1 specification</div>
      </div>

      {renderDriftCard()}

      {!spec || Object.keys(specPaths).length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📄</div>
          <div className="empty-state-message">OpenAPI spec not available or has no paths. Install @axiomify/openapi to enable.</div>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" style={{ margin: 0 }} onClick={() => setShowRawJson(!showRawJson)}>
              {showRawJson ? 'Hide Raw JSON' : 'Toggle Raw JSON'}
            </button>
            <button className="btn btn-secondary" style={{ margin: 0 }} onClick={handleCopySpec}>Copy JSON</button>
            <button className="btn btn-secondary" style={{ margin: 0 }} onClick={handleDownloadSpec}>Download Spec</button>
          </div>

          {showRawJson && (
            <div style={{ marginBottom: '24px', textAlign: 'left' }}>
              <div className="schema-section-label">Raw OpenAPI Spec</div>
              <pre className="schema-json" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                {JSON.stringify(spec, null, 2)}
              </pre>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left' }}>
            {Object.entries(specPaths).map(([path, pathItem]: [string, any]) => (
              Object.entries(pathItem).map(([method, op]: [string, any]) => {
                if (!['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].includes(method.toLowerCase())) return null;
                const mUpper = method.toUpperCase();
                const key = `${mUpper}:${path}`;
                const summary = op.summary || `${mUpper} ${path}`;

                return (
                  <div key={key} className="schema-card" style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="schema-card-header" style={{ cursor: 'default' }}>
                      <span className={`method-badge method-${mUpper}`}>{mUpper}</span>
                      <span className="route-path" style={{ marginLeft: '8px' }}>{path}</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '13px', marginLeft: '8px' }}>{summary}</span>
                    </div>
                    <div className="schema-card-body" style={{ display: 'block', padding: '16px' }}>
                      {op.description && (
                        <div style={{ marginBottom: '12px', color: 'var(--text-secondary)', fontSize: '13px' }}>{op.description}</div>
                      )}

                      {/* Params */}
                      {op.parameters && op.parameters.length > 0 && (
                        <div style={{ marginBottom: '16px' }}>
                          <div className="schema-section-label">Parameters</div>
                          <table className="route-table">
                            <thead>
                              <tr>
                                <th>Name</th>
                                <th>In</th>
                                <th>Type</th>
                                <th>Required</th>
                                <th>Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {op.parameters.map((p: any, i: number) => (
                                <tr key={i}>
                                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{p.name}</td>
                                  <td><span className="validation-pill">{p.in}</span></td>
                                  <td style={{ fontFamily: 'var(--font-mono)' }}>{p.schema?.type || 'any'}</td>
                                  <td>
                                    {p.required ? (
                                      <span style={{ color: 'var(--error)', fontSize: '11px' }}>required</span>
                                    ) : (
                                      <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>optional</span>
                                    )}
                                  </td>
                                  <td style={{ color: 'var(--text-secondary)' }}>{p.description || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Request body */}
                      {op.requestBody && (
                        <div style={{ marginBottom: '16px' }}>
                          <div className="schema-section-label">Request Body</div>
                          {Object.entries(op.requestBody.content || {}).map(([mime, media]: [string, any]) => (
                            <div key={mime}>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                Content-Type: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-text)' }}>{mime}</code>
                              </div>
                              {media.schema && (
                                <pre className="schema-json" style={{ margin: 0 }}>
                                  {JSON.stringify(media.schema, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Responses */}
                      {op.responses && Object.keys(op.responses).length > 0 && (
                        <div>
                          <div className="schema-section-label">Responses</div>
                          {Object.entries(op.responses).map(([code, r]: [string, any]) => {
                            const isSuccess = code.startsWith('2');
                            const isError = code.startsWith('4') || code.startsWith('5');
                            const codeColor = isSuccess ? 'var(--success)' : isError ? 'var(--error)' : 'var(--warning)';

                            return (
                              <div key={code} style={{ marginTop: '12px' }}>
                                <div>
                                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: codeColor, marginRight: '8px' }}>{code}</span>
                                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{r.description || ''}</span>
                                </div>
                                {r.content && Object.entries(r.content).map(([mime, media]: [string, any]) => (
                                  media.schema ? (
                                    <pre key={mime} className="schema-json" style={{ marginTop: '6px' }}>
                                      {JSON.stringify(media.schema, null, 2)}
                                    </pre>
                                  ) : null
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================
// 3. DI SERVICES PANEL
// ==========================================
export const ServicesPanel: React.FC<{ discovery: DiscoveryData }> = ({ discovery }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const services = discovery.services || [];
  const filtered = services.filter(s => 
    s.token.toLowerCase().includes(searchTerm.toLowerCase().trim()) || 
    s.type.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
    s.methods.some(m => m.toLowerCase().includes(searchTerm.toLowerCase().trim()))
  );

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">DI Services Explorer</div>
        <div className="panel-subtitle">Registered dependency injection services and methods</div>
      </div>

      <div className="search-bar">
        <input
          className="search-input"
          type="text"
          placeholder="Search services by token, methods, or type..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🧩</div>
          <div className="empty-state-message">No services found in the DI container.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px', textAlign: 'left' }}>
          {filtered.map(s => (
            <div key={s.token} className="info-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', margin: 0 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span className="info-card-label" style={{ marginBottom: 0 }}>Service Token</span>
                  <span className="tag-pill" style={{ fontFamily: 'var(--font-mono)' }}>{s.type}</span>
                </div>
                <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginBottom: '12px', wordBreak: 'break-all' }}>
                  {s.token}
                </div>
                <div style={{ borderTop: '1px dashed var(--border)', paddingTop: '8px' }}>
                  {s.methods.length > 0 ? (
                    <div>
                      <div className="schema-section-label">Public Methods</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                        {s.methods.map(m => (
                          <span key={m} className="validation-pill" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                            {m}()
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '12px', marginTop: '10px' }}>
                      No public methods exposed.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ==========================================
// 4. LIFECYCLE HOOKS PANEL
// ==========================================
export const HooksPanel: React.FC<{ discovery: DiscoveryData }> = ({ discovery }) => {
  const hooks = discovery.hooks || [];
  const totalHandlers = hooks.reduce((acc, h) => acc + h.count, 0);

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">Lifecycle Hooks</div>
        <div className="panel-subtitle">Registered hook handlers across the request lifecycle</div>
      </div>

      <div className="info-grid" style={{ marginBottom: '24px' }}>
        <div className="info-card" style={{ margin: 0 }}>
          <div className="info-card-label">Total Hook Points</div>
          <div className="info-card-value">{hooks.length}</div>
        </div>
        <div className="info-card" style={{ margin: 0 }}>
          <div className="info-card-label">Total Handler Functions</div>
          <div className="info-card-value">{totalHandlers}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left' }}>
        {hooks.map(h => (
          <div key={h.name} className="schema-card">
            <div className="schema-card-header" style={{ cursor: 'default' }}>
              <span className="method-badge method-WS" style={{ fontSize: '10px', padding: '2px 6px' }}>HOOK</span>
              <span className="route-path" style={{ marginLeft: '8px', fontWeight: 600 }}>{h.name}</span>
              <span className="tag-pill" style={{ marginLeft: 'auto' }}>{h.count} handler{h.count === 1 ? '' : 's'}</span>
            </div>
            <div className="schema-card-body" style={{ display: 'block', padding: '16px' }}>
              {h.handlers && h.handlers.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {h.handlers.map((fn, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--accent)' }}>⚓</span>
                      <span>{fn}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '12px' }}>No handlers registered.</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ==========================================
// 5. HEALTH DASHBOARD
// ==========================================
export const HealthPanel: React.FC<{ discovery: DiscoveryData }> = ({ discovery }) => {
  const [openFindings, setOpenFindings] = useState<Record<number, boolean>>({});

  const health = discovery.health;
  if (!health) {
    return (
      <div>
        <div className="panel-header">
          <div className="panel-title">Health Dashboard</div>
          <div className="panel-subtitle">Production-readiness checks and configuration audits</div>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">❤️</div>
          <div className="empty-state-message">Health diagnostics report not available.</div>
        </div>
      </div>
    );
  }

  const { summary, findings } = health;

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">Health Dashboard</div>
        <div className="panel-subtitle">Production-readiness checks and configuration audits</div>
      </div>

      <div className="info-grid" style={{ marginBottom: '24px' }}>
        <div className="info-card" style={{ margin: 0, borderLeft: '4px solid var(--success)' }}>
          <div className="info-card-label">PASSED CHECKS</div>
          <div className="info-card-value" style={{ color: 'var(--success)' }}>{summary.passes || 0}</div>
        </div>
        <div className="info-card" style={{ margin: 0, borderLeft: '4px solid var(--warning)' }}>
          <div className="info-card-label">WARNING CHECKS</div>
          <div className="info-card-value" style={{ color: 'var(--warning)' }}>{summary.warnings || 0}</div>
        </div>
        <div className="info-card" style={{ margin: 0, borderLeft: '4px solid var(--error)' }}>
          <div className="info-card-label">FAIL CHECKS</div>
          <div className="info-card-value" style={{ color: 'var(--error)' }}>{summary.failures || 0}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left' }}>
        {findings.map((f, idx) => {
          const isOpen = !!openFindings[idx];
          return (
            <div key={idx} className={`finding-card severity-${f.severity} ${isOpen ? 'open' : ''}`}>
              <div className="finding-card-header" onClick={() => setOpenFindings(prev => ({ ...prev, [idx]: !isOpen }))}>
                <span className="finding-card-status-icon">{f.severity === 'fail' ? '❌' : f.severity === 'warn' ? '⚠️' : '✅'}</span>
                <span className="finding-card-title">{f.message}</span>
                <span className="finding-card-area">{f.area}</span>
              </div>
              {isOpen && f.hint && (
                <div className="finding-card-body">
                  <div style={{ padding: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    <strong>Remediation / Suggestion:</strong> {f.hint}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ==========================================
// 6. FRAMEWORK CONFIG & SYSTEM STATS
// ==========================================
export const ConfigPanel: React.FC<{ discovery: DiscoveryData }> = ({ discovery }) => {
  const [stats, setStats] = useState<any | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const res = await apiFetch('/__studio/api/system');
      if (res.ok) {
        setStats(await res.json());
      }
    } catch {}
  };

  const getStatusColor = (val: number) => {
    if (val > 80) return 'error';
    if (val > 50) return 'warning';
    return 'success';
  };

  const envs = stats?.env || {};
  const filteredEnvs = Object.entries(envs).filter(([k, v]) => 
    k.toLowerCase().includes(searchTerm.toLowerCase().trim()) || 
    String(v).toLowerCase().includes(searchTerm.toLowerCase().trim())
  );

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">Framework Configuration</div>
        <div className="panel-subtitle">Application settings and overview</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', textAlign: 'left', flexWrap: 'wrap' }}>
        {/* Framework Meta */}
        <div className="tester-section">
          <div className="tester-section-title">📦 Application Info</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
            <div><strong>Environment:</strong> <span className="tag-pill">{discovery.config.env || 'development'}</span></div>
            <div><strong>Routes Count:</strong> {discovery.routes?.length || 0}</div>
            <div><strong>DI Services:</strong> {discovery.services?.length || 0}</div>
            <div><strong>Lifecycle Hooks:</strong> {discovery.hooks?.length || 0}</div>
          </div>
        </div>

        {/* Live System Stats */}
        <div className="tester-section">
          <div className="tester-section-title">⏱️ Live System Metrics</div>
          {stats ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span>CPU Usage</span>
                  <span>{stats.cpu?.toFixed(1)}%</span>
                </div>
                <div className="metric-progress-container">
                  <div className={`metric-progress-bar ${getStatusColor(stats.cpu)}`} style={{ width: `${stats.cpu}%` }} />
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span>Memory Usage</span>
                  <span>{(stats.memory?.heapUsed / 1024 / 1024).toFixed(0)} MB / {(stats.memory?.heapTotal / 1024 / 1024).toFixed(0)} MB</span>
                </div>
                {(() => {
                  const percent = Math.min((stats.memory?.heapUsed / stats.memory?.heapTotal) * 100, 100) || 0;
                  return (
                    <div className="metric-progress-container">
                      <div className={`metric-progress-bar ${getStatusColor(percent)}`} style={{ width: `${percent}%` }} />
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '12px' }}>Stats loading...</div>
          )}
        </div>
      </div>

      {/* Env Variables */}
      <div className="env-table-container" style={{ textAlign: 'left' }}>
        <div className="env-search-bar">
          <span style={{ fontSize: '13px', fontWeight: 600 }}>Environment Variables</span>
          <input
            className="text-input"
            type="text"
            placeholder="Search env keys..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ width: '220px', margin: 0, padding: '6px' }}
          />
        </div>
        <table className="env-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {filteredEnvs.length === 0 ? (
              <tr>
                <td colSpan={2} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '16px' }}>No matching environment variables.</td>
              </tr>
            ) : (
              filteredEnvs.map(([k, v]) => (
                <tr key={k}>
                  <td className="env-key">{k}</td>
                  <td className="env-val">{String(v)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ==========================================
// 7. EVENTS PANEL
// ==========================================
export const EventsPanel: React.FC<{ discovery: DiscoveryData }> = ({ discovery }) => {
  const events = discovery.events || [];

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">Event Bus Explorer</div>
        <div className="panel-subtitle">Registered events and listener counts in the application bus</div>
      </div>

      {events.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📣</div>
          <div className="empty-state-message">No active events found. Listeners must register on Axiomify Event Bus.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left' }}>
          {events.map((ev: any) => (
            <div key={ev.name} className="schema-card">
              <div className="schema-card-header" style={{ cursor: 'default' }}>
                <span className="method-badge method-GET" style={{ fontSize: '10px', padding: '2px 6px' }}>EVENT</span>
                <span className="route-path" style={{ marginLeft: '8px', fontWeight: 600 }}>{ev.name}</span>
                <span className="tag-pill" style={{ marginLeft: 'auto' }}>{ev.listenerCount} listener{ev.listenerCount === 1 ? '' : 's'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ==========================================
// 8. ARCHITECTURE PANEL
// ==========================================
export const ArchitecturePanel: React.FC<{ discovery: DiscoveryData }> = ({ discovery }) => {
  const nodes = discovery.archMap || [];

  const getBadgeColor = (type: string) => {
    switch (type) {
      case 'route': return 'var(--accent)';
      case 'middleware': return 'var(--method-head)';
      case 'validation': return 'var(--warning)';
      case 'controller': return 'var(--success)';
      case 'repository': return 'var(--method-ws)';
      case 'database': return 'var(--error)';
      default: return 'var(--info)';
    }
  };

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">Application Architecture Map</div>
        <div className="panel-subtitle">Dependency graph nodes mapping registered controllers, layers, and service injections</div>
      </div>

      {nodes.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🗺️</div>
          <div className="empty-state-message">Architecture map has no registered injections.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left' }}>
          {nodes.map(node => (
            <div key={node.id} className="schema-card">
              <div className="schema-card-header" style={{ cursor: 'default' }}>
                <span className="method-badge method-WS" style={{ fontSize: '10px', padding: '2px 6px', background: getBadgeColor(node.type), color: '#fff' }}>
                  {node.type.toUpperCase()}
                </span>
                <span className="route-path" style={{ marginLeft: '8px', fontWeight: 600 }}>{node.name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: 'auto' }}>id: {node.id}</span>
              </div>
              <div className="schema-card-body" style={{ display: 'block', padding: '16px' }}>
                <div className="schema-section-label">Dependencies</div>
                {node.dependencies && node.dependencies.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                    {node.dependencies.map(dep => (
                      <span key={dep} className="validation-pill" style={{ textTransform: 'none', background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
                        {dep}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>No dependencies.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ==========================================
// 9. WS ANALYTICS PANEL
// ==========================================
export const WsAnalyticsPanel: React.FC = () => {
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 2000);
    return () => clearInterval(interval);
  }, []);

  const fetchAnalytics = async () => {
    try {
      const res = await apiFetch('/__studio/api/ws-analytics');
      if (res.ok) {
        setData(await res.json());
      }
    } catch {}
  };

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">WebSocket Traffic Analytics</div>
        <div className="panel-subtitle">Real-time stats of connections, rooms, and frame throughput</div>
      </div>

      {data ? (
        <div>
          <div className="info-grid" style={{ marginBottom: '24px' }}>
            <div className="info-card" style={{ margin: 0 }}>
              <div className="info-card-label">Active Connections</div>
              <div className="info-card-value">{data.activeConnections}</div>
            </div>
            <div className="info-card" style={{ margin: 0 }}>
              <div className="info-card-label">Total Rooms</div>
              <div className="info-card-value">{data.totalRooms}</div>
            </div>
            <div className="info-card" style={{ margin: 0 }}>
              <div className="info-card-label">Total Frames Recv</div>
              <div className="info-card-value">{data.totalFramesReceived}</div>
            </div>
            <div className="info-card" style={{ margin: 0 }}>
              <div className="info-card-label">Total Frames Sent</div>
              <div className="info-card-value">{data.totalFramesSent}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', textAlign: 'left', flexWrap: 'wrap' }}>
            {/* Active Clients */}
            <div className="tester-section">
              <div className="tester-section-title">🔌 Active WebSockets Client List</div>
              {data.clients && data.clients.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {data.clients.map((c: any) => (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: '12px' }}>
                      <div>
                        <strong>ID:</strong> <code style={{ fontFamily: 'var(--font-mono)' }}>{c.id.substring(0, 10)}...</code>
                      </div>
                      <span className="tag-pill">{c.protocol}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '12px' }}>No active connections.</div>
              )}
            </div>

            {/* Rooms list */}
            <div className="tester-section">
              <div className="tester-section-title">🏠 Active Rooms</div>
              {data.rooms && Object.keys(data.rooms).length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {Object.entries(data.rooms).map(([name, size]: [string, any]) => (
                    <div key={name} style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: '12px' }}>
                      <strong>Room: {name}</strong>
                      <span className="validation-pill">{size} client{size === 1 ? '' : 's'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '12px' }}>No active rooms.</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '12px' }}>Analytics loading...</div>
      )}
    </div>
  );
};

// ==========================================
// 10. METRICS PANEL
// ==========================================
interface ParsedMetric {
  name: string;
  labels: Record<string, string>;
  value: number;
}

function parsePrometheus(raw: string): ParsedMetric[] {
  const lines = raw.split('\n');
  const results: ParsedMetric[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = /^([a-zA-Z_][a-zA-Z0-9_]*)(?:\{([^}]+)\})?\s+(.+)$/.exec(trimmed);
    if (!match) continue;

    const name = match[1];
    const labelsRaw = match[2] || '';
    const value = parseFloat(match[3]);

    const labels: Record<string, string> = {};
    if (labelsRaw) {
      const pairs = labelsRaw.split(',');
      for (const pair of pairs) {
        const parts = pair.split('=');
        if (parts.length === 2) {
          const k = parts[0].trim();
          const v = parts[1].trim().replace(/^"|"$/g, '');
          labels[k] = v;
        }
      }
    }
    results.push({ name, labels, value });
  }
  return results;
}

export const MetricsPanel: React.FC = () => {
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchMetrics = async () => {
    try {
      const res = await apiFetch('/__studio/api/metrics');
      if (res.ok) {
        setData(await res.json());
      }
    } catch {}
  };

  if (!data) {
    return (
      <div>
        <div className="panel-header">
          <div className="panel-title">Metrics Dashboard</div>
          <div className="panel-subtitle">Latency metrics and request throughput checks</div>
        </div>
        <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '12px' }}>Metrics loading...</div>
      </div>
    );
  }

  if (!data.available) {
    return (
      <div>
        <div className="panel-header">
          <div className="panel-title">Metrics Dashboard</div>
          <div className="panel-subtitle">Latency metrics and request throughput checks</div>
        </div>
        <div className="empty-state" style={{ textAlign: 'left', display: 'block', padding: '32px' }}>
          <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '12px' }}>📊 Metrics Plugin Inactive</div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '20px' }}>
            The metrics collection plugin is not active in this application. To enable real-time Prometheus throughput and latency analysis, register the metrics plugin on your application instance:
          </p>
          <pre style={{ padding: '16px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-mono)', fontSize: '12px', overflowX: 'auto', marginBottom: '20px' }}>
{`import { useMetrics } from '@axiomify/metrics';

// Register the metrics plugin in your app entrypoint
useMetrics(app);`}
          </pre>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Note: By default, metrics are exposed at the <code style={{ fontFamily: 'var(--font-mono)' }}>{data.path || '/metrics'}</code> route.
          </div>
        </div>
      </div>
    );
  }

  // Parse Prometheus text payload
  const metrics = parsePrometheus(data.raw || '');

  // Calculate totals
  let totalRequests = 0;
  let totalDurationMs = 0;
  let wsConnectedClients = 0;
  let hasWsStats = false;

  interface RouteMetric {
    method: string;
    route: string;
    requests: number;
    durationMs: number;
    statuses: Record<string, number>;
  }
  const routeMetricsMap = new Map<string, RouteMetric>();

  for (const m of metrics) {
    if (m.name === 'http_requests_total') {
      totalRequests += m.value;
      const key = `${m.labels.method}:${m.labels.route}`;
      let rm = routeMetricsMap.get(key);
      if (!rm) {
        rm = { method: m.labels.method || 'GET', route: m.labels.route || '/', requests: 0, durationMs: 0, statuses: {} };
        routeMetricsMap.set(key, rm);
      }
      rm.requests += m.value;
      const status = m.labels.status || '200';
      rm.statuses[status] = (rm.statuses[status] || 0) + m.value;
    } else if (m.name === 'http_request_duration_ms') {
      totalDurationMs += m.value;
      const key = `${m.labels.method}:${m.labels.route}`;
      let rm = routeMetricsMap.get(key);
      if (!rm) {
        rm = { method: m.labels.method || 'GET', route: m.labels.route || '/', requests: 0, durationMs: 0, statuses: {} };
        routeMetricsMap.set(key, rm);
      }
      rm.durationMs += m.value;
    } else if (m.name === 'ws_connected_clients') {
      wsConnectedClients = m.value;
      hasWsStats = true;
    }
  }

  const routesList = Array.from(routeMetricsMap.values()).sort((a, b) => b.requests - a.requests);
  const globalAvgResponseTimeMs = totalRequests > 0 ? totalDurationMs / totalRequests : 0;

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">Metrics Dashboard</div>
        <div className="panel-subtitle">Latency metrics and request throughput checks</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', textAlign: 'left' }}>
        <div className="info-grid">
          <div className="info-card" style={{ margin: 0 }}>
            <div className="info-card-label">Total Requests</div>
            <div className="info-card-value">{totalRequests}</div>
          </div>
          <div className="info-card" style={{ margin: 0 }}>
            <div className="info-card-label">Average Response Time</div>
            <div className="info-card-value">{globalAvgResponseTimeMs.toFixed(1)} ms</div>
          </div>
          {hasWsStats && (
            <div className="info-card" style={{ margin: 0 }}>
              <div className="info-card-label">Active WebSockets</div>
              <div className="info-card-value" style={{ color: 'var(--method-ws)' }}>{wsConnectedClients}</div>
            </div>
          )}
        </div>

        <div className="tester-section">
          <div className="tester-section-title">📊 HTTP Route Throughput & Latency</div>
          {routesList.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '12px' }}>
              No traffic requests captured by the metrics collector yet. Send some requests to see statistics!
            </div>
          ) : (
            <div className="card" style={{ padding: '8px', margin: 0, overflowX: 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)' }}>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Method</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Route</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Requests Count</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Avg Latency</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Status Breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  {routesList.map((r, idx) => {
                    const avg = r.requests > 0 ? r.durationMs / r.requests : 0;
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px' }}>
                          <span className={`method-badge method-${r.method}`} style={{ fontSize: '9px', padding: '2px 6px' }}>{r.method}</span>
                        </td>
                        <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.route}</td>
                        <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>{r.requests}</td>
                        <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>{avg.toFixed(1)} ms</td>
                        <td style={{ padding: '8px' }}>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {Object.entries(r.statuses).map(([status, count]) => {
                              const isSuccess = status.startsWith('2');
                              const isError = status.startsWith('4') || status.startsWith('5');
                              const color = isSuccess ? 'var(--success)' : isError ? 'var(--error)' : 'var(--warning)';
                              return (
                                <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: `${color}15`, color }}>
                                  {status}: {count}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="tester-section">
          <div className="tester-section-title">🔌 Raw Prometheus Data</div>
          <pre style={{ maxHeight: '250px', overflowY: 'auto', padding: '16px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
            {data.raw}
          </pre>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 11. PERFORMANCE OBSERVATORY
// ==========================================
export const PerformancePanel: React.FC = () => {
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    fetchPerf();
    const interval = setInterval(fetchPerf, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchPerf = async () => {
    try {
      const res = await apiFetch('/__studio/api/perf');
      if (res.ok) {
        setData(await res.json());
      }
    } catch {}
  };

  const renderTable = (label: string, items: any[], columns: string[], columnLabels?: string[]) => (
    <div style={{ marginBottom: '24px', textAlign: 'left' }}>
      <div className="tester-section-title" style={{ marginBottom: '8px' }}>{label}</div>
      {items.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic' }}>No metrics available.</div>
      ) : (
        <div className="card" style={{ padding: '8px', margin: 0, overflowX: 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                {columns.map((c, i) => (
                  <th key={c} style={{ padding: '6px 8px', textTransform: 'capitalize', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    {columnLabels ? columnLabels[i] : c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                  {columns.map(c => {
                    const isDuration = c.toLowerCase().includes('ms') || c.toLowerCase().includes('p50') || c.toLowerCase().includes('p95') || c.toLowerCase().includes('p99') || c.toLowerCase() === 'avg' || c.toLowerCase() === 'min' || c.toLowerCase() === 'max';
                    const val = it[c];
                    
                    let displayVal = '—';
                    if (val !== undefined && val !== null) {
                      if (isDuration) {
                        displayVal = `${Number(val).toFixed(1)} ms`;
                      } else if (c === 'timestamp') {
                        displayVal = new Date(val).toLocaleTimeString();
                      } else {
                        displayVal = String(val);
                      }
                    }

                    return (
                      <td key={c} style={{ padding: '6px 8px', fontFamily: c === 'query' || c === 'route' || c === 'token' ? 'var(--font-mono)' : 'inherit', fontSize: '11px' }}>
                        {c === 'method' ? (
                          <span className={`method-badge method-${displayVal}`} style={{ fontSize: '9px', padding: '1px 4px' }}>{displayVal}</span>
                        ) : (
                          displayVal
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">Performance Observatory</div>
        <div className="panel-subtitle">Slowest HTTP routes, middlewares, dependencies, and database queries</div>
      </div>

      {data ? (
        <div>
          {renderTable(
            'Slowest HTTP Routes', 
            data.routes || [], 
            ['method', 'route', 'count', 'avg', 'p50', 'p95', 'p99'],
            ['Method', 'Route Path', 'Invocations', 'Avg Duration', 'P50', 'P95', 'P99']
          )}
          {renderTable(
            'Slowest Middlewares', 
            data.middleware || [], 
            ['name', 'count', 'avg', 'p50', 'p95', 'p99'],
            ['Middleware Name', 'Invocations', 'Avg Duration', 'P50', 'P95', 'P99']
          )}
          {renderTable(
            'Slowest DI Services', 
            data.services || [], 
            ['token', 'method', 'count', 'avg', 'p50', 'p95', 'p99'],
            ['Service Token', 'Method', 'Invocations', 'Avg Duration', 'P50', 'P95', 'P99']
          )}
          {renderTable(
            'Slowest Database Queries', 
            data.queries?.slowest || [], 
            ['query', 'durationMs', 'timestamp'],
            ['Query Statement', 'Duration', 'Timestamp']
          )}
        </div>
      ) : (
        <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '12px' }}>Performance metrics loading...</div>
      )}
    </div>
  );
};

// ==========================================
// 12. SDK IMPACT ANALYZER
// ==========================================
export const SdkImpactPanel: React.FC = () => {
  const [impacts, setImpacts] = useState<any[]>([]);
  const [sdkFilter, setSdkFilter] = useState('all');
  const [sevFilter, setSevFilter] = useState('all');

  useEffect(() => {
    fetchImpacts();
  }, []);

  const fetchImpacts = async () => {
    try {
      const res = await apiFetch('/__studio/api/sdk-impacts');
      if (res.ok) {
        const data = await res.json();
        setImpacts(data.impacts || []);

        const badge = document.getElementById('badge-sdk-impact');
        if (badge) {
          badge.textContent = String(data.impacts?.length || 0);
          badge.style.display = data.impacts?.length > 0 ? 'inline-block' : 'none';
        }
      }
    } catch {}
  };

  const handleDismiss = async (id: string) => {
    try {
      const res = await apiFetch(`/__studio/api/sdk-impact?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) fetchImpacts();
    } catch {}
  };

  const handleDismissAll = async () => {
    if (!confirm('Are you sure you want to dismiss all impacts?')) return;
    try {
      const res = await apiFetch('/__studio/api/sdk-impacts', { method: 'DELETE' });
      if (res.ok) fetchImpacts();
    } catch {}
  };

  const filtered = impacts.filter(it => {
    const matchSdk = sdkFilter === 'all' || it.affectedSdks.includes(sdkFilter);
    const matchSev = sevFilter === 'all' || it.changeType === sevFilter;
    return matchSdk && matchSev;
  });

  return (
    <div>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div className="panel-title">SDK Impact Analyzer</div>
          <div className="panel-subtitle">Drift compatibility compatibility warnings for Client SDK compilation</div>
        </div>
        <button className="btn btn-secondary" onClick={handleDismissAll} disabled={impacts.length === 0}>
          Dismiss All
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left' }}>
        <div className="card" style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px', margin: 0 }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600 }}>Filter SDK:</span>
            {['all', 'typescript', 'python', 'dart'].map(sdk => (
              <button
                key={sdk}
                className={`btn btn-secondary ${sdkFilter === sdk ? 'active' : ''}`}
                style={{ margin: 0, padding: '4px 8px', fontSize: '11px' }}
                onClick={() => setSdkFilter(sdk)}
              >
                {sdk.toUpperCase()}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600 }}>Filter Severity:</span>
            {['all', 'breaking', 'non-breaking', 'patch'].map(sev => (
              <button
                key={sev}
                className={`btn btn-secondary ${sevFilter === sev ? 'active' : ''}`}
                style={{ margin: 0, padding: '4px 8px', fontSize: '11px' }}
                onClick={() => setSevFilter(sev)}
              >
                {sev.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', fontSize: '13px' }}>
            No compatibility changes detected. Make some changes in your code or schemas!
          </div>
        ) : (
          filtered.map(item => {
            let typeColor = 'var(--text-muted)';
            if (item.changeType === 'breaking' || item.changeType === 'removed') typeColor = 'var(--error)';
            else if (item.changeType === 'non-breaking' || item.changeType === 'new') typeColor = 'var(--warning)';
            else if (item.changeType === 'patch') typeColor = 'var(--success)';

            return (
              <div key={item.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', margin: 0, borderTop: `3px solid ${typeColor}`, background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span className={`method-badge method-${item.method}`} style={{ fontSize: '10px', padding: '2px 6px' }}>{item.method}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{item.route}</span>
                    <span style={{ borderRadius: 'var(--radius-sm)', background: `${typeColor}20`, color: typeColor, fontSize: '10px', fontWeight: 600, padding: '2px 6px', textTransform: 'uppercase' }}>
                      {item.changeType}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {item.affectedSdks.map((sdk: string) => (
                        <span key={sdk} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2px 8px', fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                          {sdk.toUpperCase()}
                        </span>
                      ))}
                    </div>
                    <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: '11px', margin: 0 }} onClick={() => handleDismiss(item.id)}>Dismiss</button>
                  </div>
                </div>
                <ul style={{ margin: 0, paddingLeft: '20px', listStyleType: 'disc' }}>
                  {item.details.map((d: string, idx: number) => (
                    <li key={idx} style={{ marginBottom: '4px', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{d}</li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ==========================================
// 13. CONTRACT TESTING PANEL
// ==========================================
export const ContractsPanel: React.FC = () => {
  const [results, setResults] = useState<any[]>([]);
  const [autoRun, setAutoRun] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetchContracts();
  }, []);

  const fetchContracts = async () => {
    try {
      const res = await apiFetch('/__studio/api/contracts');
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
        setAutoRun(data.autoRun);

        const failed = data.results ? data.results.filter((c: any) => !c.passed && c.status === 'failed').length : 0;
        const badge = document.getElementById('badge-contracts');
        if (badge) {
          badge.textContent = String(failed);
          badge.style.display = failed > 0 ? 'inline-flex' : 'none';
        }
      }
    } catch {}
  };

  const handleRun = async () => {
    setRunning(true);
    try {
      const res = await apiFetch('/__studio/api/contracts/run', { method: 'POST' });
      if (res.ok) fetchContracts();
    } catch {
    } finally {
      setRunning(false);
    }
  };

  const handleToggleAuto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.checked;
    setAutoRun(val);
    try {
      await apiFetch(`/__studio/api/contracts/toggle-autorun?enable=${val}`, { method: 'POST' });
    } catch {}
  };

  return (
    <div>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div className="panel-title">Contract Testing Center</div>
          <div className="panel-subtitle">Schema mock compliance validations against request payloads</div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={autoRun} onChange={handleToggleAuto} />
            Auto-Run on Reload
          </label>
          <button className="btn" onClick={handleRun} disabled={running}>
            {running ? 'Running...' : 'Run All Tests'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left' }}>
        {results.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', fontSize: '13px' }}>
            No contract specifications loaded. Generate schemas to activate validations!
          </div>
        ) : (
          results.map((c, i) => (
            <div key={i} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px', margin: 0, borderLeft: `4px solid ${c.passed ? 'var(--success)' : 'var(--error)'}`, background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className={`method-badge method-${c.method}`}>{c.method}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700 }}>{c.route}</span>
                </div>
                <span style={{ color: c.passed ? 'var(--success)' : 'var(--error)', fontWeight: 'bold', textTransform: 'uppercase', fontSize: '12px' }}>
                  {c.status || (c.passed ? 'PASSED' : 'FAILED')}
                </span>
              </div>
              {!c.passed && c.error && (
                <pre style={{ margin: '8px 0 0 0', padding: '10px', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: 'var(--radius-sm)', color: 'var(--error)', fontSize: '11px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {c.error}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ==========================================
// 14. QUALITY PANEL
// ==========================================
export const QualityPanel: React.FC = () => {
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    fetchQuality();
  }, []);

  const fetchQuality = async () => {
    try {
      const res = await apiFetch('/__studio/api/quality');
      if (res.ok) {
        const payload = await res.json();
        setData(payload);
        
        // Update badge
        const badge = document.getElementById('badge-quality');
        if (badge && payload.report?.total !== undefined) {
          badge.textContent = String(payload.report.total);
        }
      }
    } catch {}
  };

  if (!data) {
    return (
      <div>
        <div className="panel-header">
          <div className="panel-title">API Quality Score</div>
          <div className="panel-subtitle">Weighted index scoring documentation, validations, and security configs</div>
        </div>
        <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '12px' }}>Quality score loading...</div>
      </div>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'var(--success)';
    if (score >= 70) return 'var(--warning)';
    return 'var(--error)';
  };

  const report = data.report || { total: 100, dimensions: {}, perRoute: [] };

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">API Quality Score</div>
        <div className="panel-subtitle">Weighted index scoring documentation, validations, and security configs</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '20px', textAlign: 'left', flexWrap: 'wrap', marginBottom: '24px' }}>
        {/* Score widget */}
        <div className="tester-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Global Rating</div>
          <div style={{ fontSize: '72px', fontWeight: 800, color: getScoreColor(report.total), lineHeight: 1 }}>{report.total}</div>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginTop: '8px' }}>out of 100 points</div>
        </div>

        {/* Quality issues checklists */}
        <div className="tester-section">
          <div className="tester-section-title">🏆 API Quality Checklist</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {Object.entries(report.dimensions || {}).map(([key, dim]: [string, any]) => {
              const nameMap: Record<string, string> = {
                schemaCoverage: 'Schema Coverage',
                documentation: 'OpenAPI Documentation',
                performance: 'Performance Latency',
                security: 'Security Violations',
                contractCompliance: 'Contract Compliance',
              };
              const label = nameMap[key] || key;
              const passed = dim.score >= 70;
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <span style={{ fontSize: '16px' }}>{passed ? '✅' : '⚠️'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                      <span style={{ color: 'var(--text-primary)' }}>{label}</span>
                      <span style={{ color: getScoreColor(dim.score) }}>{dim.score} / 100 <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'normal' }}>(weight: {dim.weight}%)</span></span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{dim.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Per-Route Quality Report Card */}
      <div className="tester-section" style={{ textAlign: 'left' }}>
        <div className="tester-section-title" style={{ marginBottom: '12px' }}>🧭 Route-Specific Quality Details</div>
        {report.perRoute && report.perRoute.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '12px' }}>No routes analyzed.</div>
        ) : (
          <div className="card" style={{ padding: '8px', margin: 0, overflowX: 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)' }}>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Method</th>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Route Path</th>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Route Score</th>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Identified Improvements</th>
                </tr>
              </thead>
              <tbody>
                {report.perRoute.map((r: any, idx: number) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px' }}>
                      <span className={`method-badge method-${r.method}`} style={{ fontSize: '9px', padding: '2px 6px' }}>{r.method}</span>
                    </td>
                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.route}</td>
                    <td style={{ padding: '8px', fontWeight: 700, color: getScoreColor(r.score) }}>{r.score}</td>
                    <td style={{ padding: '8px' }}>
                      {r.issues && r.issues.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-secondary)' }}>
                          {r.issues.map((issue: string, iIdx: number) => (
                            <li key={iIdx} style={{ fontSize: '11px', listStyleType: 'disc', marginBottom: '2px' }}>{issue}</li>
                          ))}
                        </ul>
                      ) : (
                        <span style={{ color: 'var(--success)', fontWeight: 500 }}>✨ Perfect rating</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 15. AI TELEMETRY ASSISTANT
// ==========================================
export const AiAssistantPanel: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const [messages, setMessages] = useState<{ sender: 'user' | 'ai'; text: string; loading?: boolean; isError?: boolean }[]>([
    { sender: 'ai', text: 'Hello! I am your Axiomify AI Telemetry Assistant. Ask me anything about your API routes, validations, system memory metrics, or static security findings.' }
  ]);
  const [inputMsg, setInputMsg] = useState('');
  const [sending, setSending] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // AI Configuration Settings States
  const [aiConfig, setAiConfig] = useState({ provider: 'gemini', hasEnvKey: false });
  const [customKey, setCustomKey] = useState(sessionStorage.getItem('axiomify_ai_key') || '');
  const [selectedProvider, setSelectedProvider] = useState(sessionStorage.getItem('axiomify_ai_provider') || 'gemini');
  const [saveToEnv, setSaveToEnv] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Auto scroll chat
  useEffect(() => {
    if (threadEndRef.current) {
      threadEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Load AI configuration status on mount
  useEffect(() => {
    fetchAiStatus();
  }, []);

  const fetchAiStatus = async () => {
    try {
      const res = await apiFetch('/__studio/api/ai/status');
      if (res.ok) {
        const payload = await res.json();
        setAiConfig({ provider: payload.provider, hasEnvKey: payload.hasEnvKey });
        
        if (!sessionStorage.getItem('axiomify_ai_provider')) {
          setSelectedProvider(payload.provider || 'gemini');
        }
      }
    } catch {}
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      sessionStorage.setItem('axiomify_ai_provider', selectedProvider);
      sessionStorage.setItem('axiomify_ai_key', customKey);

      if (saveToEnv && customKey) {
        const res = await apiFetch('/__studio/api/ai/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: selectedProvider, apiKey: customKey }),
        });
        if (res.ok) {
          alert('AI Configuration successfully saved to your project .env file!');
          fetchAiStatus();
        } else {
          const err = await res.json();
          alert('Failed to save to .env: ' + (err.error || 'Unknown error'));
        }
      } else {
        alert('AI settings applied for the current browser session.');
      }
      setShowSettings(false);
    } catch (err: any) {
      alert('Error saving settings: ' + err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const formatMarkdown = (md: string) => {
    let html = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const bt = String.fromCharCode(96);
    
    // Fenced Code block
    const codeBlockRegex = new RegExp(bt + '{3}([a-zA-Z0-9+#-]+)?\\n([\\s\\S]*?)\\n' + bt + '{3}', 'g');
    html = html.replace(codeBlockRegex, (_, lang, code) => {
      return `<pre className="schema-json" style="margin:10px 0; overflow-x:auto; padding:12px; font-family:var(--font-mono); font-size:12px; background:var(--bg-tertiary); border:1px solid var(--border); border-radius:var(--radius-sm);"><code className="language-${lang || ''}">${code}</code></pre>`;
    });

    // Inline Code block
    const inlineCodeRegex = new RegExp(bt + '([^' + bt + '\\n]+)' + bt, 'g');
    html = html.replace(inlineCodeRegex, '<code style="font-family:var(--font-mono); background:var(--bg-tertiary); border:1px solid var(--border); border-radius:3px; padding:2px 4px; font-size:12px; color:var(--accent-text);">$1</code>');

    // Bold text
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:700; color:var(--text-primary);">$1</strong>');

    // List elements
    html = html.replace(/^\s*[-*+]\s+(.+)$/gm, '<li style="margin-left:20px; margin-bottom:4px; font-size:13px; list-style-type:disc;">$1</li>');
    html = html.replace(/(<li[\s\S]*?<\/li>)/g, '<ul style="margin:8px 0;">$1</ul>');
    html = html.replace(/<\/ul>\s*<ul style="margin:8px 0;">/g, '');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  };

  const handleSend = async () => {
    const prompt = inputMsg.trim();
    if (!prompt || sending) return;

    setInputMsg('');
    setSending(true);

    // Push User bubble
    setMessages(prev => [...prev, { sender: 'user', text: prompt }]);

    // Push AI placeholder bubble
    setMessages(prev => [...prev, { sender: 'ai', text: 'Analyzing telemetry context...', loading: true }]);

    let fullResponseText = '';
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      const token = getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Check session settings
      const localProvider = sessionStorage.getItem('axiomify_ai_provider');
      const localKey = sessionStorage.getItem('axiomify_ai_key');
      if (localKey && localProvider) {
        headers['x-axiomify-ai-key'] = localKey;
        headers['x-axiomify-ai-provider'] = localProvider;
      }

      const res = await fetch('/__studio/api/ai/analyze', {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            sender: 'ai',
            text: `Error requesting AI analysis: ${errData.error || res.statusText}`,
            isError: true,
          };
          return updated;
        });
        setSending(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let buffer = '';

      if (!reader) {
        throw new Error('Response stream not readable');
      }

      // Remove placeholder loading
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { sender: 'ai', text: '' };
        return updated;
      });

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          let lineEndIdx;
          while ((lineEndIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.substring(0, lineEndIdx).trim();
            buffer = buffer.substring(lineEndIdx + 1);

            if (line.startsWith('data: ')) {
              const dataStr = line.substring(6);
              if (dataStr === '[DONE]') {
                done = true;
                break;
              }
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.text) {
                  fullResponseText += parsed.text;
                  setMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      sender: 'ai',
                      text: fullResponseText,
                    };
                    return updated;
                  });
                }
                if (parsed.error) {
                  setMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      sender: 'ai',
                      text: `${fullResponseText}\n\nStream Error: ${parsed.error}`,
                      isError: true,
                    };
                    return updated;
                  });
                }
              } catch {}
            }
          }
        }
      }
    } catch (err: any) {
      console.error('Error during AI streaming:', err);
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          sender: 'ai',
          text: `Connection Error: ${err.message}`,
          isError: true,
        };
        return updated;
      });
    } finally {
      setSending(false);
    }
  };

  const handleKeydown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '16px' }}>
        <div style={{ textAlign: 'left' }}>
          <div className="panel-title">AI Telemetry Assistant</div>
          <div className="panel-subtitle">
            Active Provider: <strong style={{ color: 'var(--accent)' }}>{aiConfig.provider?.toUpperCase()}</strong>
            {aiConfig.hasEnvKey ? ' (API Key loaded from environment)' : ' (Key missing - configure settings below)'}
          </div>
        </div>
        <button className="btn btn-secondary" onClick={() => setShowSettings(!showSettings)}>
          ⚙️ AI Provider Settings
        </button>
      </div>

      {showSettings && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', margin: '0 0 16px 0', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', textAlign: 'left' }}>
          <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>🤖 Configure AI Provider</div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>AI Model Provider</label>
              <select 
                className="select-input"
                style={{ width: '100%', margin: 0, padding: '8px' }}
                value={selectedProvider}
                onChange={e => setSelectedProvider(e.target.value)}
              >
                <option value="gemini">Google Gemini (gemini-2.5-flash)</option>
                <option value="openai">OpenAI (gpt-4o-mini)</option>
                <option value="claude">Anthropic Claude (claude-3-5-sonnet)</option>
                <option value="qwen">Alibaba Qwen (qwen-turbo)</option>
              </select>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>API Secret Key</label>
              <input
                type="password"
                className="text-input"
                style={{ width: '100%', margin: 0, padding: '8px' }}
                placeholder="Paste API Key here..."
                value={customKey}
                onChange={e => setCustomKey(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginTop: '4px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', userSelect: 'none', color: 'var(--text-secondary)' }}>
              <input 
                type="checkbox"
                checked={saveToEnv}
                onChange={e => setSaveToEnv(e.target.checked)}
              />
              Save variables to project <code style={{ fontFamily: 'var(--font-mono)' }}>.env</code> file
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary" style={{ margin: 0, padding: '6px 12px', fontSize: '12px' }} onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="btn" style={{ margin: 0, padding: '6px 16px', fontSize: '12px', background: 'var(--accent)' }} onClick={handleSaveSettings} disabled={savingSettings}>
                {savingSettings ? 'Saving...' : 'Apply & Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px', textAlign: 'left' }}>
        <div className="tester-section" style={{ height: '600px', display: 'flex', flexDirection: 'column', padding: 0 }}>
          
          {/* Chat thread */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {messages.map((m, idx) => {
              const isUser = m.sender === 'user';
              return (
                <div key={idx} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                  {!isUser && (
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>
                      ✨
                    </div>
                  )}
                  <div 
                    style={{
                      background: isUser ? 'var(--accent)' : 'var(--bg-primary)',
                      color: isUser ? '#fff' : (m.isError ? 'var(--error)' : 'var(--text-primary)'),
                      border: isUser ? 'none' : '1px solid var(--border)',
                      borderRadius: isUser ? 'var(--radius-md) 0 var(--radius-md) var(--radius-md)' : '0 var(--radius-md) var(--radius-md) var(--radius-md)',
                      padding: '12px 16px',
                      fontSize: '13px',
                      maxWidth: '85%',
                      lineHeight: 1.5,
                      fontStyle: m.loading ? 'italic' : 'normal',
                    }}
                    dangerouslySetInnerHTML={{ __html: isUser ? m.text.replace(/\n/g, '<br>') : formatMarkdown(m.text) }}
                  />
                  {isUser && (
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--border-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>
                      👤
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={threadEndRef} />
          </div>

          {/* Chat input box */}
          <div style={{ padding: '16px', borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', gap: '10px', alignItems: 'center' }}>
            <textarea
              className="search-input"
              style={{ flex: 1, height: '60px', minHeight: '60px', maxHeight: '150px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px', padding: '10px', lineHeight: 1.4, resize: 'vertical' }}
              placeholder="Ask anything about your API, e.g. Why is my route /users slow?..."
              value={inputMsg}
              onChange={e => setInputMsg(e.target.value)}
              onKeyDown={handleKeydown}
              disabled={sending}
            />
            <button
              className="btn"
              onClick={handleSend}
              disabled={sending || !inputMsg.trim()}
              style={{ height: '60px', width: '60px', fontSize: '18px', background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0 }}
            >
              📤
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
