import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';

interface StudioSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeMs: number;
  durationMs: number;
  attributes: Record<string, any>;
  status: { code: number; message?: string };
}

interface StudioTrace {
  traceId: string;
  spans: StudioSpan[];
  startTimeMs: number;
  durationMs: number;
  rootSpan?: StudioSpan;
}

export const TracingPanel: React.FC = () => {
  const [traces, setTraces] = useState<StudioTrace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<StudioTrace | null>(null);
  const [selectedSpan, setSelectedSpan] = useState<StudioSpan | null>(null);
  const [searchPath, setSearchPath] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchTraces = async () => {
    try {
      const res = await apiFetch('/__studio/api/otlp/traces');
      if (res.ok) {
        const data = await res.json();
        setTraces(data.traces || []);
        
        // Update selected trace reference if it's active
        if (selectedTrace) {
          const updated = (data.traces || []).find((t: StudioTrace) => t.traceId === selectedTrace.traceId);
          if (updated) {
            setSelectedTrace(updated);
            // Update selected span reference
            if (selectedSpan) {
              const updatedSpan = updated.spans.find((s: StudioSpan) => s.spanId === selectedSpan.spanId);
              if (updatedSpan) setSelectedSpan(updatedSpan);
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch traces:', err);
    } finally {
      setLoading(false);
    }
  };

  const clearTraces = async () => {
    if (!confirm('Are you sure you want to clear all recorded traces?')) return;
    try {
      const res = await apiFetch('/__studio/api/otlp/traces', { method: 'DELETE' });
      if (res.ok) {
        setTraces([]);
        setSelectedTrace(null);
        setSelectedSpan(null);
      }
    } catch (err) {
      console.error('Failed to clear traces:', err);
    }
  };

  useEffect(() => {
    fetchTraces();
    const interval = setInterval(fetchTraces, 3000);
    return () => clearInterval(interval);
  }, [selectedTrace?.traceId, selectedSpan?.spanId]);

  // Filter traces
  const filteredTraces = traces.filter((trace) => {
    const rootName = trace.rootSpan?.name || '';
    const matchesPath = rootName.toLowerCase().includes(searchPath.toLowerCase()) || trace.traceId.includes(searchPath);
    const hasError = trace.spans.some((s) => s.status.code === 2 || s.attributes['exception.message'] || s.attributes['failed']);
    return matchesPath && (!errorsOnly || hasError);
  });

  const getStatusColor = (span: StudioSpan) => {
    const hasError = span.status.code === 2 || span.attributes['exception.message'] || span.attributes['failed'];
    if (hasError) return 'var(--error)';
    if (span.name.includes('GET')) return 'var(--accent-primary)';
    if (span.name.includes('POST')) return 'var(--success)';
    if (span.name.includes('PUT') || span.name.includes('PATCH')) return 'var(--warning)';
    if (span.name.includes('DELETE')) return '#f87171';
    return 'var(--text-secondary)';
  };

  const getSpanTypeColor = (type: string) => {
    switch (type) {
      case 'handler': return 'var(--accent-primary)';
      case 'middleware': return 'var(--warning)';
      case 'service': return 'var(--success)';
      default: return 'var(--text-secondary)';
    }
  };

  const getStatusBadge = (span?: StudioSpan) => {
    if (!span) return null;
    const hasError = span.status.code === 2 || span.attributes['exception.message'] || span.attributes['failed'];
    const statusCode = span.attributes['http.status_code'];
    
    if (hasError) {
      return <span className="badge badge-error">ERROR</span>;
    }
    if (statusCode) {
      const isSuccess = statusCode >= 200 && statusCode < 400;
      return (
        <span className={`badge ${isSuccess ? 'badge-success' : 'badge-warn'}`}>
          {statusCode}
        </span>
      );
    }
    return <span className="badge badge-info">OK</span>;
  };

  return (
    <div className="tracing-container" style={{ display: 'flex', height: 'calc(100vh - 120px)', gap: '16px' }}>
      
      {/* Trace List Side Panel */}
      <div className="trace-list-panel" style={{ width: '30%', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', paddingRight: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div className="panel-title" style={{ margin: 0 }}>Traces</div>
          <button className="btn btn-secondary" onClick={clearTraces} style={{ padding: '4px 8px', fontSize: '12px' }}>
            🗑️ Clear
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          <input
            type="text"
            className="input-text"
            placeholder="Search by path or trace ID..."
            value={searchPath}
            onChange={(e) => setSearchPath(e.target.value)}
            style={{ width: '100%', fontSize: '13px', padding: '6px' }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={errorsOnly}
              onChange={(e) => setErrorsOnly(e.target.checked)}
            />
            Errors Only
          </label>
        </div>

        {/* Traces List */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {loading && traces.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)', padding: '20px', textAlign: 'center', fontSize: '13px' }}>Loading traces...</div>
          ) : filteredTraces.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)', padding: '20px', textAlign: 'center', fontSize: '13px' }}>No traces found.</div>
          ) : (
            filteredTraces.map((trace) => {
              const root = trace.rootSpan;
              const hasError = trace.spans.some((s) => s.status.code === 2 || s.attributes['exception.message'] || s.attributes['failed']);
              const isSelected = selectedTrace?.traceId === trace.traceId;

              return (
                <div
                  key={trace.traceId}
                  onClick={() => {
                    setSelectedTrace(trace);
                    setSelectedSpan(null);
                  }}
                  className={`trace-item ${isSelected ? 'active' : ''}`}
                  style={{
                    padding: '10px',
                    borderRadius: '6px',
                    background: isSelected ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                    border: `1px solid ${isSelected ? 'var(--accent-primary)' : 'var(--border)'}`,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    position: 'relative'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '13px', wordBreak: 'break-all', color: hasError ? 'var(--error)' : 'var(--text-primary)' }}>
                      {root?.name || 'Unknown Request'}
                    </span>
                    {getStatusBadge(root)}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    <span>{trace.spans.length} spans</span>
                    <span>{trace.durationMs.toFixed(1)} ms</span>
                  </div>
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'monospace' }}>
                    ID: {trace.traceId.substring(0, 8)}...
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Trace Timeline & Details View */}
      <div className="trace-details-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {selectedTrace ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            
            {/* Trace Header */}
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>
                  Trace: {selectedTrace.rootSpan?.name || 'Request'}
                </h3>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                  Trace ID: {selectedTrace.traceId}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '20px', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                <span><strong>Duration:</strong> {selectedTrace.durationMs.toFixed(2)} ms</span>
                <span><strong>Spans:</strong> {selectedTrace.spans.length}</span>
                <span><strong>Started:</strong> {new Date(selectedTrace.startTimeMs).toLocaleTimeString()}</span>
              </div>
            </div>

            {/* Timelines and Span details split */}
            <div style={{ display: 'flex', flex: 1, gap: '16px', overflow: 'hidden' }}>
              
              {/* Timeline (Gantt Chart) */}
              <div style={{ width: '60%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '8px' }}>
                <div className="panel-subtitle" style={{ marginBottom: '8px' }}>Execution Timeline</div>
                {selectedTrace.spans.map((span) => {
                  const left = ((span.startTimeMs - selectedTrace.startTimeMs) / Math.max(1, selectedTrace.durationMs)) * 100;
                  const width = Math.max(1.5, (span.durationMs / Math.max(1, selectedTrace.durationMs)) * 100);
                  const isSpanSelected = selectedSpan?.spanId === span.spanId;
                  const type = span.attributes['axiomify.type'] || 'handler';

                  return (
                    <div
                      key={span.spanId}
                      onClick={() => setSelectedSpan(span)}
                      style={{
                        padding: '8px',
                        borderRadius: '4px',
                        background: isSpanSelected ? 'var(--bg-secondary)' : 'transparent',
                        border: `1px solid ${isSpanSelected ? 'var(--border)' : 'transparent'}`,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                        <span style={{ fontWeight: isSpanSelected ? 'bold' : 'normal', color: 'var(--text-primary)' }}>
                          {span.name}
                        </span>
                        <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>
                          {span.durationMs.toFixed(2)} ms
                        </span>
                      </div>
                      
                      {/* Gantt Bar */}
                      <div style={{ width: '100%', height: '8px', background: 'var(--bg-secondary)', borderRadius: '4px', position: 'relative', overflow: 'hidden' }}>
                        <div
                          style={{
                            position: 'absolute',
                            left: `${left}%`,
                            width: `${width}%`,
                            height: '100%',
                            background: getSpanTypeColor(type),
                            borderRadius: '4px',
                            transition: 'all 0.3s'
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Span Inspector Panel */}
              <div style={{ flex: 1, borderLeft: '1px solid var(--border)', paddingLeft: '16px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
                {selectedSpan ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                      <div className="panel-subtitle" style={{ margin: 0 }}>Span Details</div>
                      <h4 style={{ margin: '8px 0 4px 0', color: 'var(--text-primary)' }}>{selectedSpan.name}</h4>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                        Span ID: {selectedSpan.spanId}
                      </div>
                    </div>

                    <div>
                      <strong>Span Type:</strong>{' '}
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 'bold',
                          color: getSpanTypeColor(selectedSpan.attributes['axiomify.type'] || 'handler'),
                          textTransform: 'uppercase',
                        }}
                      >
                        {selectedSpan.attributes['axiomify.type'] || 'handler'}
                      </span>
                    </div>

                    {/* Exceptions (Errors) */}
                    {(selectedSpan.status.code === 2 || selectedSpan.attributes['exception.message'] || selectedSpan.attributes['failed']) && (
                      <div
                        style={{
                          border: '1px solid var(--error)',
                          background: 'rgba(239, 68, 68, 0.08)',
                          borderRadius: '6px',
                          padding: '10px',
                          color: 'var(--error)',
                        }}
                      >
                        <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '4px' }}>Exception Logged</div>
                        <div style={{ fontSize: '12px', wordBreak: 'break-all' }}>
                          {selectedSpan.attributes['exception.message'] || selectedSpan.status.message || 'Error executing request'}
                        </div>
                        {selectedSpan.attributes['exception.stacktrace'] && (
                          <pre
                            style={{
                              fontSize: '10px',
                              fontFamily: 'monospace',
                              marginTop: '8px',
                              maxHeight: '150px',
                              overflowY: 'auto',
                              whiteSpace: 'pre-wrap',
                              background: 'rgba(0,0,0,0.2)',
                              padding: '6px',
                              borderRadius: '4px',
                            }}
                          >
                            {selectedSpan.attributes['exception.stacktrace']}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* Attributes list */}
                    <div>
                      <div className="panel-subtitle" style={{ fontSize: '12px', marginBottom: '8px' }}>Attributes</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {Object.entries(selectedSpan.attributes)
                          .filter(([k]) => k !== 'axiomify.type')
                          .map(([key, val]) => (
                            <div key={key} style={{ fontSize: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                              <div style={{ color: 'var(--text-secondary)', fontWeight: 'bold', fontSize: '11px', marginBottom: '2px' }}>{key}</div>
                              {key === 'service.args' || key.includes('payload') || typeof val === 'object' ? (
                                <pre style={{ margin: 0, padding: '4px', background: 'var(--bg-secondary)', borderRadius: '4px', fontSize: '10px', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                  {typeof val === 'string' ? val : JSON.stringify(val, null, 2)}
                                </pre>
                              ) : (
                                <div style={{ color: 'var(--text-primary)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                  {String(val)}
                                </div>
                              )}
                            </div>
                          ))}
                        {Object.keys(selectedSpan.attributes).length <= 1 && (
                          <div style={{ color: 'var(--text-secondary)', fontSize: '12px', fontStyle: 'italic' }}>No additional attributes available.</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '13px', fontStyle: 'italic' }}>
                    Select a span in the timeline to view its attributes.
                  </div>
                )}
              </div>

            </div>

          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
            <span style={{ fontSize: '32px', marginBottom: '12px' }}>🧭</span>
            <span>Select a trace from the list to view its execution spans.</span>
          </div>
        )}
      </div>

    </div>
  );
};
