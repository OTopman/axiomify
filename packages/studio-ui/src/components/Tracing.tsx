import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  Layers,
  Search,
  Trash2,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
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
  const [copiedTraceId, setCopiedTraceId] = useState(false);

  const fetchTraces = async () => {
    try {
      const res = await apiFetch('/__studio/api/otlp/traces');
      if (res.ok) {
        const data = await res.json();
        setTraces(data.traces || []);

        // Update selected trace reference if it's active
        if (selectedTrace) {
          const updated = (data.traces || []).find(
            (t: StudioTrace) => t.traceId === selectedTrace.traceId,
          );
          if (updated) {
            setSelectedTrace(updated);
            // Update selected span reference
            if (selectedSpan) {
              const updatedSpan = updated.spans.find(
                (s: StudioSpan) => s.spanId === selectedSpan.spanId,
              );
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
      const res = await apiFetch('/__studio/api/otlp/traces', {
        method: 'DELETE',
      });
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
    const matchesPath =
      rootName.toLowerCase().includes(searchPath.toLowerCase()) ||
      trace.traceId.includes(searchPath);
    const hasError = trace.spans.some(
      (s) =>
        s.status.code === 2 ||
        s.attributes['exception.message'] ||
        s.attributes['failed'],
    );
    return matchesPath && (!errorsOnly || hasError);
  });

  const getStatusColor = (span: StudioSpan) => {
    const hasError =
      span.status.code === 2 ||
      span.attributes['exception.message'] ||
      span.attributes['failed'];
    if (hasError) return 'var(--error)';
    if (span.name.includes('GET')) return 'var(--accent-primary)';
    if (span.name.includes('POST')) return 'var(--success)';
    if (span.name.includes('PUT') || span.name.includes('PATCH'))
      return 'var(--warning)';
    if (span.name.includes('DELETE')) return '#f87171';
    return 'var(--text-secondary)';
  };

  const getSpanTypeColor = (type: string) => {
    switch (type) {
      case 'handler':
        return 'var(--accent-primary)';
      case 'middleware':
        return 'var(--warning)';
      case 'service':
        return 'var(--success)';
      default:
        return 'var(--text-secondary)';
    }
  };

  const getStatusBadge = (span?: StudioSpan) => {
    if (!span) return null;
    const hasError =
      span.status.code === 2 ||
      span.attributes['exception.message'] ||
      span.attributes['failed'];
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
    <div
      className="panel-modern-layout"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 20px',
        gap: '14px',
      }}
    >
      {/* ── Top Header Bar ─────────────────────────────────────────── */}
      <div
        className="panel-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 0,
          paddingBottom: '10px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="panel-title">Distributed Tracing & Waterfall</div>
            <span
              className="nav-badge"
              style={{ fontSize: '10px', padding: '2px 6px' }}
            >
              {traces.length} Traces
            </span>
          </div>
          <div className="panel-subtitle">
            OTel distributed trace spans, microservice execution timings, and
            error stack waterfalls
          </div>
        </div>

        <button
          className="btn btn-secondary"
          onClick={clearTraces}
          disabled={traces.length === 0}
          style={{
            padding: '5px 10px',
            fontSize: '11px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            margin: 0,
          }}
        >
          <Trash2 size={12} /> Clear Traces
        </button>
      </div>

      {/* ── Main Two-Column Layout ──────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '320px 1fr',
          gap: '16px',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Left Side: Trace Stream */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}
        >
          {/* Search & Filter Toolbar */}
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ position: 'relative' }}>
              <Search
                size={12}
                style={{
                  position: 'absolute',
                  left: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                type="text"
                className="filter-search-input"
                placeholder="Search route or trace ID..."
                value={searchPath}
                onChange={(e) => setSearchPath(e.target.value)}
                style={{
                  paddingLeft: '26px',
                  fontSize: '11.5px',
                  height: '28px',
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={errorsOnly}
                  onChange={(e) => setErrorsOnly(e.target.checked)}
                />
                <span>Errors Only</span>
              </label>
              <span
                style={{
                  fontSize: '10.5px',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {filteredTraces.length} matching
              </span>
            </div>
          </div>

          {/* Trace Cards List */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {loading && traces.length === 0 ? (
              <div
                style={{
                  color: 'var(--text-muted)',
                  padding: '40px 16px',
                  textAlign: 'center',
                  fontSize: '12px',
                }}
              >
                Loading traces...
              </div>
            ) : filteredTraces.length === 0 ? (
              <div
                style={{
                  color: 'var(--text-muted)',
                  padding: '40px 16px',
                  textAlign: 'center',
                  fontSize: '12px',
                }}
              >
                No traces recorded yet. Execute API calls to capture execution
                traces.
              </div>
            ) : (
              filteredTraces.map((trace) => {
                const root = trace.rootSpan;
                const hasError = trace.spans.some(
                  (s) =>
                    s.status.code === 2 ||
                    s.attributes['exception.message'] ||
                    s.attributes['failed'],
                );
                const isSelected = selectedTrace?.traceId === trace.traceId;

                // Extract method from root span name (e.g. "GET /api/users")
                const parts = (root?.name || '').split(' ');
                const method = parts.length > 1 ? parts[0].toUpperCase() : '';
                const path =
                  parts.length > 1
                    ? parts.slice(1).join(' ')
                    : root?.name || 'Request';

                return (
                  <div
                    key={trace.traceId}
                    onClick={() => {
                      setSelectedTrace(trace);
                      setSelectedSpan(null);
                    }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: isSelected
                        ? 'rgba(99, 102, 241, 0.08)'
                        : 'var(--bg-primary)',
                      border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      cursor: 'pointer',
                      transition: 'all var(--transition)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '5px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '6px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          minWidth: 0,
                          overflow: 'hidden',
                        }}
                      >
                        {method && (
                          <span
                            className={`method-badge method-${method}`}
                            style={{ fontSize: '9px', padding: '1px 5px' }}
                          >
                            {method}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            color: hasError
                              ? 'var(--error)'
                              : 'var(--text-primary)',
                            textOverflow: 'ellipsis',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {path}
                        </span>
                      </div>
                      {getStatusBadge(root)}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '10.5px',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <Layers size={10} /> {trace.spans.length} spans
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 600,
                          color:
                            trace.durationMs > 500
                              ? 'var(--warning)'
                              : 'var(--text-secondary)',
                        }}
                      >
                        {trace.durationMs.toFixed(1)} ms
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: '9.5px',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      ID: {trace.traceId.substring(0, 12)}…
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Side: Timeline Gantt & Span Details */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          {selectedTrace ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
              }}
            >
              {/* Trace Omnibar Header */}
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span>
                      {selectedTrace.rootSpan?.name || 'Execution Trace'}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        color: 'var(--accent)',
                        background: 'rgba(99, 102, 241, 0.1)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                      }}
                    >
                      {selectedTrace.durationMs.toFixed(2)} ms
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      marginTop: '4px',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      Trace ID: {selectedTrace.traceId}
                    </span>
                    <button
                      className="btn btn-secondary"
                      style={{
                        padding: '1px 6px',
                        fontSize: '10px',
                        margin: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      onClick={() => {
                        navigator.clipboard.writeText(selectedTrace.traceId);
                        setCopiedTraceId(true);
                        setTimeout(() => setCopiedTraceId(false), 1500);
                      }}
                    >
                      {copiedTraceId ? (
                        <Check size={10} style={{ color: 'var(--success)' }} />
                      ) : (
                        <Copy size={10} />
                      )}
                      {copiedTraceId ? 'Copied' : 'Copy ID'}
                    </button>
                    <span>• {selectedTrace.spans.length} spans</span>
                    <span>
                      •{' '}
                      {new Date(selectedTrace.startTimeMs).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Split: Gantt Execution Timeline + Span Details */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'minmax(320px, 1.4fr) minmax(280px, 1fr)',
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                {/* Gantt Timeline */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    borderRight: '1px solid var(--border)',
                    overflowY: 'auto',
                    padding: '12px 16px',
                    gap: '8px',
                  }}
                >
                  {/* Ruler bar */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '10px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)',
                      borderBottom: '1px dashed var(--border)',
                      paddingBottom: '4px',
                      marginBottom: '4px',
                    }}
                  >
                    <span>0 ms</span>
                    <span>
                      {(selectedTrace.durationMs * 0.25).toFixed(1)} ms
                    </span>
                    <span>
                      {(selectedTrace.durationMs * 0.5).toFixed(1)} ms
                    </span>
                    <span>
                      {(selectedTrace.durationMs * 0.75).toFixed(1)} ms
                    </span>
                    <span>{selectedTrace.durationMs.toFixed(1)} ms</span>
                  </div>

                  {selectedTrace.spans.map((span) => {
                    const left =
                      ((span.startTimeMs - selectedTrace.startTimeMs) /
                        Math.max(1, selectedTrace.durationMs)) *
                      100;
                    const width = Math.max(
                      2,
                      (span.durationMs /
                        Math.max(1, selectedTrace.durationMs)) *
                        100,
                    );
                    const isSpanSelected = selectedSpan?.spanId === span.spanId;
                    const type = span.attributes['axiomify.type'] || 'handler';

                    return (
                      <div
                        key={span.spanId}
                        onClick={() => setSelectedSpan(span)}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: isSpanSelected
                            ? 'var(--bg-primary)'
                            : 'transparent',
                          border: `1px solid ${isSpanSelected ? 'var(--accent)' : 'transparent'}`,
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '5px',
                          transition: 'all var(--transition)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '11.5px',
                          }}
                        >
                          <span
                            style={{
                              fontWeight: isSpanSelected ? 700 : 500,
                              color: 'var(--text-primary)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <span
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                background: getSpanTypeColor(type),
                              }}
                            />
                            {span.name}
                          </span>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '11px',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {span.durationMs.toFixed(2)} ms
                          </span>
                        </div>

                        {/* Gantt Bar */}
                        <div
                          style={{
                            width: '100%',
                            height: '7px',
                            background: 'var(--bg-primary)',
                            borderRadius: '3px',
                            position: 'relative',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              left: `${left}%`,
                              width: `${width}%`,
                              height: '100%',
                              background: getSpanTypeColor(type),
                              borderRadius: '3px',
                              boxShadow: isSpanSelected
                                ? '0 0 6px rgba(99, 102, 241, 0.5)'
                                : 'none',
                              transition: 'all 0.2s',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Span Inspector Side Panel */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    overflowY: 'auto',
                    padding: '14px 16px',
                    background: 'var(--bg-primary)',
                    gap: '14px',
                  }}
                >
                  {selectedSpan ? (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '14px',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            color: 'var(--text-muted)',
                          }}
                        >
                          Span Inspector
                        </div>
                        <h4
                          style={{
                            margin: '4px 0 2px 0',
                            fontSize: '13px',
                            color: 'var(--text-primary)',
                          }}
                        >
                          {selectedSpan.name}
                        </h4>
                        <div
                          style={{
                            fontSize: '10.5px',
                            color: 'var(--text-muted)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          Span ID: {selectedSpan.spanId}
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          gap: '8px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '3px',
                            textTransform: 'uppercase',
                            background: 'rgba(99, 102, 241, 0.1)',
                            color: getSpanTypeColor(
                              selectedSpan.attributes['axiomify.type'] ||
                                'handler',
                            ),
                          }}
                        >
                          {selectedSpan.attributes['axiomify.type'] ||
                            'handler'}
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            fontFamily: 'var(--font-mono)',
                            padding: '2px 6px',
                            borderRadius: '3px',
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {selectedSpan.durationMs.toFixed(2)} ms
                        </span>
                      </div>

                      {/* Exceptions / Errors */}
                      {(selectedSpan.status.code === 2 ||
                        selectedSpan.attributes['exception.message'] ||
                        selectedSpan.attributes['failed']) && (
                        <div
                          style={{
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            background: 'rgba(239, 68, 68, 0.08)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '10px',
                            color: 'var(--error)',
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: '11.5px',
                              marginBottom: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px',
                            }}
                          >
                            <AlertTriangle size={12} /> Exception Logged
                          </div>
                          <div
                            style={{ fontSize: '11px', wordBreak: 'break-all' }}
                          >
                            {selectedSpan.attributes['exception.message'] ||
                              selectedSpan.status.message ||
                              'Error executing span'}
                          </div>
                          {selectedSpan.attributes['exception.stacktrace'] && (
                            <pre
                              style={{
                                fontSize: '10px',
                                fontFamily: 'var(--font-mono)',
                                marginTop: '8px',
                                maxHeight: '140px',
                                overflowY: 'auto',
                                whiteSpace: 'pre-wrap',
                                background: 'rgba(0,0,0,0.3)',
                                padding: '6px',
                                borderRadius: '3px',
                              }}
                            >
                              {selectedSpan.attributes['exception.stacktrace']}
                            </pre>
                          )}
                        </div>
                      )}

                      {/* Attributes list */}
                      <div>
                        <div
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            color: 'var(--text-secondary)',
                            marginBottom: '8px',
                          }}
                        >
                          Attributes (
                          {Object.keys(selectedSpan.attributes).length})
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                          }}
                        >
                          {Object.entries(selectedSpan.attributes)
                            .filter(([k]) => k !== 'axiomify.type')
                            .map(([key, val]) => (
                              <div
                                key={key}
                                style={{
                                  fontSize: '11px',
                                  borderBottom: '1px solid var(--border)',
                                  paddingBottom: '5px',
                                }}
                              >
                                <div
                                  style={{
                                    color: 'var(--text-muted)',
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '10px',
                                    marginBottom: '2px',
                                  }}
                                >
                                  {key}
                                </div>
                                {key === 'service.args' ||
                                key.includes('payload') ||
                                typeof val === 'object' ? (
                                  <pre
                                    style={{
                                      margin: 0,
                                      padding: '4px 6px',
                                      background: 'var(--bg-secondary)',
                                      borderRadius: '3px',
                                      fontSize: '10px',
                                      fontFamily: 'var(--font-mono)',
                                      overflowX: 'auto',
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-all',
                                    }}
                                  >
                                    {typeof val === 'string'
                                      ? val
                                      : JSON.stringify(val, null, 2)}
                                  </pre>
                                ) : (
                                  <div
                                    style={{
                                      color: 'var(--text-primary)',
                                      fontFamily: 'var(--font-mono)',
                                      wordBreak: 'break-all',
                                    }}
                                  >
                                    {String(val)}
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-muted)',
                        fontSize: '12px',
                        fontStyle: 'italic',
                        textAlign: 'center',
                        padding: '40px 10px',
                      }}
                    >
                      Click on any span in the timeline to inspect its
                      attributes and telemetry data.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                gap: '8px',
              }}
            >
              <Activity size={32} style={{ opacity: 0.3 }} />
              <div>
                Select a trace from the left panel to inspect the execution
                waterfall.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
