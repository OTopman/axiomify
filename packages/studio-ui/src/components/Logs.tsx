import React, { useState, useEffect } from 'react';
import { apiFetch, getToken } from '../utils/api';

interface LogItem {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  stack?: string;
  isInternal?: boolean;
  source?: string;
  requestId?: string;
}

interface LogsProps {
  onOpenSourceViewer: (file: string, line: number) => void;
  filterRequestId: string | null;
  onClearRequestIdFilter: () => void;
}

export const Logs: React.FC<LogsProps> = ({
  onOpenSourceViewer,
  filterRequestId,
  onClearRequestIdFilter,
}) => {
  const [logsList, setLogsList] = useState<LogItem[]>([]);
  const [logFilterLevel, setLogFilterLevel] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [showInternal, setShowInternal] = useState(false);
  const [expandedStacks, setExpandedStacks] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await apiFetch('/__studio/api/logs');
      if (res.ok) {
        const data = await res.json();
        const logs = data.logs || [];
        setLogsList(logs);

        // Update badge in document header if present
        const badge = document.getElementById('badge-logs');
        if (badge) badge.textContent = String(logs.length);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  };

  const handleClearLogs = async () => {
    if (!confirm('Are you sure you want to clear logs?')) return;
    try {
      const res = await apiFetch('/__studio/api/logs', { method: 'DELETE' });
      if (res.ok) {
        setLogsList([]);
      }
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  };

  const handleExportLogs = () => {
    const token = getToken();
    window.location.href = `/__studio/api/logs/export?token=${encodeURIComponent(token)}`;
  };

  const formatStack = (stack: string) => {
    if (!stack) return '';
    const lines = stack.split('\n');
    return lines.map((line, i) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      const match = /(at\s+(?:[^\s()]+?\s+\()?)?([^\s()]+?):(\d+)(?::(\d+))?(\)?)/.exec(trimmed);
      if (match) {
        const prefix = match[1] || 'at ';
        const filePath = match[2];
        const lineNum = Number(match[3]);
        const colNum = match[4] || '';
        const suffix = match[5] || '';

        if (filePath.includes('node:internal') || filePath.includes('node_modules')) {
          return <div key={i}>{line}</div>;
        }

        const cleanPath = filePath.replace(/\\/g, '/');
        return (
          <div key={i}>
            &nbsp;&nbsp;&nbsp;&nbsp;{prefix}
            <span
              onClick={() => onOpenSourceViewer(cleanPath, lineNum)}
              style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', fontWeight: 500 }}
            >
              {filePath}:{lineNum}
            </span>
            {colNum ? `:${colNum}` : ''}
            {suffix}
          </div>
        );
      }
      return <div key={i}>{line}</div>;
    });
  };

  const formatLogMessage = (msg: string) => {
    if (typeof msg !== 'string') return String(msg);
    const trimmed = msg.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        return <StructuredJsonViewer data={parsed} />;
      } catch (e) {}
    }
    return msg;
  };

  // Filter list
  const filteredLogs = logsList.filter(log => {
    const matchesLevel = logFilterLevel === 'ALL' || log.level.toUpperCase() === logFilterLevel;
    
    const cleanSearch = searchTerm.toLowerCase().trim();
    const matchesSearch = !cleanSearch || 
      log.message.toLowerCase().includes(cleanSearch) || 
      (log.stack && log.stack.toLowerCase().includes(cleanSearch));
    
    const matchesInternal = showInternal || !log.isInternal;
    const matchesRequestId = !filterRequestId || log.requestId === filterRequestId;

    return matchesLevel && matchesSearch && matchesInternal && matchesRequestId;
  });

  return (
    <div>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div className="panel-title">Logs Observatory</div>
          <div className="panel-subtitle">Real-time application console logs and framework diagnostics</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={handleClearLogs}>
            Clear Logs
          </button>
          <button className="btn" onClick={handleExportLogs}>
            📥 Export Logs
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '12px 16px', margin: 0 }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginRight: '6px' }}>Filter Level:</span>
            {['ALL', 'TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].map(level => (
              <button
                key={level}
                className={`btn btn-secondary ${logFilterLevel === level ? 'active' : ''}`}
                style={{ margin: 0, padding: '4px 8px', fontSize: '11px' }}
                onClick={() => setLogFilterLevel(level)}
              >
                {level === 'ALL' ? 'All' : level.charAt(0) + level.slice(1).toLowerCase()}
              </button>
            ))}

            {filterRequestId && (
              <span
                style={{ background: 'rgba(239, 68, 68, 0.08)', color: 'var(--error)', fontSize: '11px', padding: '4px 8px', borderRadius: 'var(--radius-sm)', fontWeight: 600, cursor: 'pointer', marginLeft: '6px' }}
                onClick={onClearRequestIdFilter}
              >
                Clear Request ID Filter ({filterRequestId.substring(0, 10)}...) ✕
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexGrow: 1, justifyContent: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', userSelect: 'none', color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={showInternal}
                onChange={e => setShowInternal(e.target.checked)}
              />
              Show Framework Logs
            </label>
            <div style={{ width: '220px', margin: 0 }}>
              <input
                type="text"
                className="text-input"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{ width: '100%', margin: 0, padding: '8px 10px' }}
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filteredLogs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '24px', border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)' }}>
              No logs match search/filters
            </div>
          ) : (
            // Output latest logs at the bottom
            filteredLogs.map(log => {
              let levelBadgeClass = 'method-GET';
              if (log.level === 'warn') levelBadgeClass = 'method-PUT';
              else if (log.level === 'error' || log.level === 'fatal') levelBadgeClass = 'method-DELETE';
              else if (log.level === 'info') levelBadgeClass = 'method-POST';
              else if (log.level === 'debug' || log.level === 'trace') levelBadgeClass = 'method-OPTIONS';

              const hasStack = log.stack && log.stack.trim().length > 0;
              const isStackOpen = !!expandedStacks[log.id];

              let sourceBadge = null;
              if (log.source && log.source !== 'unknown') {
                const parts = log.source.split(':');
                const pathStr = parts[0].replace(/\\/g, '/');
                const lineNum = Number(parts[1]) || 1;
                sourceBadge = (
                  <span
                    style={{ background: 'rgba(79, 70, 229, 0.08)', color: 'var(--accent)', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontFamily: 'var(--font-mono)', fontWeight: 500, cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => onOpenSourceViewer(pathStr, lineNum)}
                  >
                    📍 {log.source}
                  </span>
                );
              }

              let requestIdBadge = null;
              if (log.requestId) {
                // If clicked, we filter by this correlation request ID
                requestIdBadge = (
                  <span
                    style={{ background: 'rgba(16, 185, 129, 0.08)', color: 'var(--success)', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontFamily: 'var(--font-mono)', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => {
                      const event = new CustomEvent('axiomify-filter-request-id', { detail: log.requestId });
                      window.dispatchEvent(event);
                    }}
                  >
                    🆔 {log.requestId.substring(0, 8)}...
                  </span>
                );
              }

              return (
                <div key={log.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 16px', margin: 0, textAlign: 'left', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span className={`method-badge ${levelBadgeClass}`} style={{ fontSize: '10px', padding: '2px 6px' }}>
                        {log.level.toUpperCase()}
                      </span>
                      {log.isInternal && (
                        <span style={{ background: 'rgba(245, 158, 11, 0.08)', color: 'var(--warning)', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 500 }}>
                          Framework
                        </span>
                      )}
                      {sourceBadge}
                      {requestIdBadge}
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                        {formatLogMessage(log.message)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      {hasStack && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: '10px', borderRadius: 'var(--radius-sm)', margin: 0 }}
                          onClick={() => setExpandedStacks(prev => ({ ...prev, [log.id]: !isStackOpen }))}
                        >
                          Toggle Stack
                        </button>
                      )}
                    </div>
                  </div>

                  {hasStack && isStackOpen && (
                    <pre
                      style={{ fontSize: '11px', marginTop: '8px', padding: '10px', background: 'var(--bg-primary)', border: '1px solid var(--border)', maxHeight: '250px', overflowY: 'auto', overflowX: 'auto', fontFamily: 'var(--font-mono)', textAlign: 'left', lineHeight: 1.5 }}
                    >
                      {formatStack(log.stack || '')}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

// Sub-component: Collapsible JSON Viewer for Logs
const StructuredJsonViewer: React.FC<{ data: any }> = ({ data }) => {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', marginTop: '4px' }}>
      <div
        style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 600, textDecoration: 'underline' }}
        onClick={() => setOpen(!open)}
      >
        📦 Structured JSON Payload (click to toggle)
      </div>
      {open && (
        <pre
          style={{ marginTop: '4px', padding: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '300px', overflowY: 'auto', color: 'var(--text-primary)' }}
        >
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
};
