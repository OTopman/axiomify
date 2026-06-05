import React, { useState, useEffect } from 'react';
import { apiFetch, getToken } from '../utils/api';

interface RecorderProps {}

export const Recorder: React.FC<RecorderProps> = () => {
  const [sessionData, setSessionData] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<'requests' | 'responses' | 'errors' | 'events' | 'queries'>('requests');

  useEffect(() => {
    fetchSession();
    const interval = setInterval(fetchSession, 3000);
    return () => clearInterval(interval);
  }, []);

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

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'requests', label: 'Requests' },
    { key: 'responses', label: 'Responses' },
    { key: 'errors', label: 'Errors' },
    { key: 'events', label: 'Events' },
    { key: 'queries', label: 'Queries' },
  ];

  const cols = {
    requests: ['timestamp', 'method', 'path', 'headers', 'body'],
    responses: ['timestamp', 'status', 'durationMs', 'body'],
    errors: ['timestamp', 'name', 'message', 'path'],
    events: ['timestamp', 'type', 'payload'],
    queries: ['timestamp', 'query', 'durationMs', 'failed'],
  };

  const data = sessionData ? sessionData[activeTab] || [] : [];
  const headers = cols[activeTab] || [];

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

      <div className="filter-pills" id="recorder-tabs">
        {tabs.map(t => (
          <div
            key={t.key}
            className={`filter-pill ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: '16px', margin: 0, overflowX: 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
        {!sessionData || data.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: '40px', textAlign: 'center' }}>
            No {activeTab} recorded yet. Fire some requests via the Request Tester or host API.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                {headers.map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'capitalize' }}>
                    {h === 'durationMs' ? 'Duration' : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row: any, i: number) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  {headers.map(h => {
                    let val = row[h];
                    if (val === undefined || val === null) {
                      val = '—';
                    } else if (typeof val === 'object') {
                      val = JSON.stringify(val);
                    } else {
                      val = String(val);
                    }

                    // Format timestamp
                    if (h === 'timestamp') {
                      try {
                        val = new Date(val).toLocaleTimeString();
                      } catch {}
                    }

                    // Format durations
                    if (h === 'durationMs') {
                      val = `${parseFloat(val).toFixed(1)} ms`;
                    }

                    const isStatus = h === 'status';
                    let statusColor = 'var(--text-primary)';
                    if (isStatus) {
                      const num = Number(row[h]);
                      statusColor = num >= 400 ? 'var(--error)' : num >= 300 ? 'var(--warning)' : 'var(--success)';
                    }

                    const isMethod = h === 'method';
                    let methodColor = 'var(--text-primary)';
                    if (isMethod) {
                      methodColor = `var(--method-${val.toUpperCase()}, var(--text-primary))`;
                    }

                    return (
                      <td
                        key={h}
                        style={{
                          padding: '8px 10px',
                          color: isStatus ? statusColor : isMethod ? methodColor : 'var(--text-primary)',
                          maxWidth: '300px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '11px',
                          textAlign: 'left',
                        }}
                        title={val}
                      >
                        {val}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
