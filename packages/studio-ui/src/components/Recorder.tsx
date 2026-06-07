import React, { useEffect, useState } from 'react';
import { apiFetch, getToken } from '../utils/api';

interface RecorderProps {}

export const Recorder: React.FC<RecorderProps> = () => {
  const [sessionData, setSessionData] = useState<any | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string>('');
  const [activeDetailSection, setActiveDetailSection] = useState<'request' | 'middlewares' | 'queries' | 'response'>('request');

  useEffect(() => {
    fetchSession();
    const interval = setInterval(fetchSession, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (sessionData?.entries?.length > 0 && !selectedRequestId) {
      setSelectedRequestId(sessionData.entries[0].requestId);
    }
  }, [sessionData, selectedRequestId]);

  const fetchSession = async () => {
    try {
      const res = await apiFetch('/__studio/api/session');
      if (res.ok) {
        const data = await res.json();
        setSessionData(data);

        // Update badge if present
        const badge = document.getElementById('badge-recorder');
        if (badge && data.summary) {
          badge.textContent = String(data.summary.requestCount || 0);
        }
      }
    } catch (err) {
      console.error('Failed to fetch session:', err);
    }
  };

  const handleClearSession = async () => {
    if (!confirm('Are you sure you want to clear session recording data?')) return;
    try {
      const res = await apiFetch('/__studio/api/session', { method: 'DELETE' });
      if (res.ok) {
        setSessionData(null);
        setSelectedRequestId('');
        const badge = document.getElementById('badge-recorder');
        if (badge) badge.textContent = '0';
      }
    } catch (err) {
      console.error('Failed to clear session:', err);
    }
  };

  const handleExportHar = () => {
    const token = getToken();
    window.location.href = `/__studio/api/session/har?token=${encodeURIComponent(token)}`;
  };

  const entries = sessionData?.entries || [];
  const selectedEntry = entries.find((e: any) => e.requestId === selectedRequestId) || entries[0];

  const getStatusStyle = (code: number) => {
    if (code >= 200 && code < 300) return { background: 'rgba(0, 210, 160, 0.15)', color: 'var(--success)' };
    if (code >= 300 && code < 400) return { background: 'rgba(255, 193, 7, 0.15)', color: 'var(--warning)' };
    return { background: 'rgba(255, 107, 107, 0.15)', color: 'var(--error)' };
  };

  return (
    <div>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div className="panel-title">Session Recorder</div>
          <div className="panel-subtitle">Capture, examine, and export HTTP/WS api request transaction sessions</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={handleClearSession} disabled={!sessionData}>
            Clear Recorder
          </button>
          <button className="btn" onClick={handleExportHar}>
            ⬇ Export HAR
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📡</div>
          <div className="empty-state-message">No requests recorded yet. Fire some requests via the Request Tester or host API.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '24px', minHeight: '650px', height: 'auto', textAlign: 'left' }}>
          {/* Left Panel: Transaction Logs List */}
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>Recorded Transactions</div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '600px' }}>
              {entries.map((e: any) => {
                const isSelected = selectedEntry && e.requestId === selectedEntry.requestId;
                const status = e.response?.status || 0;
                const duration = e.response?.durationMs;
                return (
                  <div
                    key={e.requestId}
                    style={{
                      background: isSelected ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
                      border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onClick={() => setSelectedRequestId(e.requestId)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span className={`method-badge method-${e.request.method}`} style={{ fontSize: '9px', padding: '1px 5px' }}>
                        {e.request.method}
                      </span>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {status > 0 && (
                          <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px', ...getStatusStyle(status) }}>
                            {status}
                          </span>
                        )}
                        {duration !== undefined && (
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            {duration.toFixed(1)}ms
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-all', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.request.path}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-muted)', marginTop: '6px' }}>
                      <span>ID: {e.requestId.slice(0, 8)}...</span>
                      <span>{new Date(e.request.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Panel: Transaction Flowchart & Payloads Details */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {selectedEntry ? (
              <>
                {/* Visual Flowchart */}
                <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '24px', textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '20px', textAlign: 'left' }}>
                    Transaction Lifecycle Flowchart
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    {/* Node 1: Client */}
                    <div
                      style={{
                        background: activeDetailSection === 'request' ? 'rgba(0, 120, 255, 0.08)' : 'var(--bg-primary)',
                        border: activeDetailSection === 'request' ? '2px solid var(--accent)' : '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                        minWidth: '130px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: activeDetailSection === 'request' ? '0 0 10px rgba(0, 120, 255, 0.15)' : 'none',
                      }}
                      onClick={() => setActiveDetailSection('request')}
                    >
                      <div style={{ fontSize: '24px', marginBottom: '4px' }}>💻</div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>Client Request</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{selectedEntry.request.method}</div>
                    </div>

                    <div style={{ fontSize: '18px', color: 'var(--text-muted)', fontWeight: 800 }}>➔</div>

                    {/* Node 2: Middlewares */}
                    <div
                      style={{
                        background: activeDetailSection === 'middlewares' ? 'rgba(0, 120, 255, 0.08)' : 'var(--bg-primary)',
                        border: activeDetailSection === 'middlewares' ? '2px solid var(--accent)' : '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                        minWidth: '130px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: activeDetailSection === 'middlewares' ? '0 0 10px rgba(0, 120, 255, 0.15)' : 'none',
                      }}
                      onClick={() => setActiveDetailSection('middlewares')}
                    >
                      <div style={{ fontSize: '24px', marginBottom: '4px' }}>🛡️</div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>Middlewares</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {selectedEntry.request.headers?.['content-type'] ? 'Parser + Custom' : 'Standard'}
                      </div>
                    </div>

                    <div style={{ fontSize: '18px', color: 'var(--text-muted)', fontWeight: 800 }}>➔</div>

                    {/* Node 3: Database Queries */}
                    <div
                      style={{
                        background: activeDetailSection === 'queries' ? 'rgba(0, 120, 255, 0.08)' : 'var(--bg-primary)',
                        border: activeDetailSection === 'queries' ? '2px solid var(--accent)' : '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                        minWidth: '130px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: activeDetailSection === 'queries' ? '0 0 10px rgba(0, 120, 255, 0.15)' : 'none',
                      }}
                      onClick={() => setActiveDetailSection('queries')}
                    >
                      <div style={{ fontSize: '24px', marginBottom: '4px' }}>🛢️</div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>Database Queries</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{selectedEntry.queries?.length || 0} executed</div>
                    </div>

                    <div style={{ fontSize: '18px', color: 'var(--text-muted)', fontWeight: 800 }}>➔</div>

                    {/* Node 4: Server Response */}
                    <div
                      style={{
                        background: activeDetailSection === 'response' ? 'rgba(0, 120, 255, 0.08)' : 'var(--bg-primary)',
                        border: activeDetailSection === 'response' ? '2px solid var(--accent)' : '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                        minWidth: '130px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: activeDetailSection === 'response' ? '0 0 10px rgba(0, 120, 255, 0.15)' : 'none',
                      }}
                      onClick={() => setActiveDetailSection('response')}
                    >
                      <div style={{ fontSize: '24px', marginBottom: '4px' }}>📥</div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>Server Response</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 'bold' }}>
                        {selectedEntry.response ? selectedEntry.response.status : 'NO RESPONSE'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Details Section */}
                <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '24px', flex: 1, minHeight: '350px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {activeDetailSection === 'request' && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                        <div>
                          <span className="tag-pill" style={{ textTransform: 'uppercase' }}>Request Details</span>
                          <h4 style={{ margin: '6px 0 0 0', fontSize: '14px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                            {selectedEntry.request.method} {selectedEntry.request.path}
                          </h4>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>Headers</div>
                          <pre style={{ margin: 0, fontSize: '11px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto', background: 'var(--bg-primary)', border: '1px solid var(--border)', padding: '10px', borderRadius: 'var(--radius-sm)' }}>
                            {JSON.stringify(selectedEntry.request.headers, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>Body / Query Params</div>
                          <pre style={{ margin: 0, fontSize: '11px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto', background: 'var(--bg-primary)', border: '1px solid var(--border)', padding: '10px', borderRadius: 'var(--radius-sm)' }}>
                            {selectedEntry.request.body ? JSON.stringify(selectedEntry.request.body, null, 2) : (selectedEntry.request.query && Object.keys(selectedEntry.request.query).length > 0 ? JSON.stringify(selectedEntry.request.query, null, 2) : 'No payload / query parameters')}
                          </pre>
                        </div>
                      </div>
                    </>
                  )}

                  {activeDetailSection === 'middlewares' && (
                    <>
                      <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                        <span className="tag-pill" style={{ textTransform: 'uppercase' }}>Middlewares Execution</span>
                        <h4 style={{ margin: '6px 0 0 0', fontSize: '14px', color: 'var(--text-primary)' }}>
                          Request Processing Pipeline
                        </h4>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {selectedEntry.timeline && selectedEntry.timeline.length > 0 ? (
                          selectedEntry.timeline.map((step: any, idx: number) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 14px' }}>
                              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{step.name}</span>
                              <span style={{ fontSize: '11px', color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>{step.duration.toFixed(2)} ms</span>
                            </div>
                          ))
                        ) : (
                          <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '12px' }}>
                            No pipeline execution markers recorded. Custom middleware stats may not be configured.
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {activeDetailSection === 'queries' && (
                    <>
                      <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                        <span className="tag-pill" style={{ textTransform: 'uppercase' }}>Database Queries</span>
                        <h4 style={{ margin: '6px 0 0 0', fontSize: '14px', color: 'var(--text-primary)' }}>
                          SQL & ORM Operations ({selectedEntry.queries?.length || 0})
                        </h4>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', maxHeight: '300px' }}>
                        {!selectedEntry.queries || selectedEntry.queries.length === 0 ? (
                          <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '20px' }}>
                            No database queries executed during this transaction.
                          </div>
                        ) : (
                          selectedEntry.queries.map((q: any, idx: number) => (
                            <div key={idx} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                                <span style={{ fontWeight: 700, color: q.failed ? 'var(--error)' : 'var(--success)' }}>
                                  {q.failed ? '❌ FAILED' : '✅ SUCCESS'}
                                </span>
                                <span>{q.durationMs.toFixed(1)} ms</span>
                              </div>
                              <pre style={{ margin: 0, fontSize: '11px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
                                {q.query}
                              </pre>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  )}

                  {activeDetailSection === 'response' && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                        <div>
                          <span className="tag-pill" style={{ textTransform: 'uppercase' }}>Server Response</span>
                          <h4 style={{ margin: '6px 0 0 0', fontSize: '14px', color: 'var(--text-primary)' }}>
                            Execution Summary
                          </h4>
                        </div>
                        {selectedEntry.response && (
                          <span style={{ fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '4px', ...getStatusStyle(selectedEntry.response.status) }}>
                            {selectedEntry.response.status}
                          </span>
                        )}
                      </div>
                      {selectedEntry.response ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                          <div>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>Headers</div>
                            <pre style={{ margin: 0, fontSize: '11px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto', background: 'var(--bg-primary)', border: '1px solid var(--border)', padding: '10px', borderRadius: 'var(--radius-sm)' }}>
                              {JSON.stringify(selectedEntry.response.headers, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>Body</div>
                            <pre style={{ margin: 0, fontSize: '11px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto', background: 'var(--bg-primary)', border: '1px solid var(--border)', padding: '10px', borderRadius: 'var(--radius-sm)' }}>
                              {selectedEntry.response.body ? (typeof selectedEntry.response.body === 'object' ? JSON.stringify(selectedEntry.response.body, null, 2) : String(selectedEntry.response.body)) : 'Empty Response Body'}
                            </pre>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '20px' }}>
                          Response has not been captured yet or transaction is incomplete.
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px' }}>Select a transaction from the list.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
