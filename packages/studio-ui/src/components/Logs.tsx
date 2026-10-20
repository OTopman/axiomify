import {
  Code2,
  Download,
  Hash,
  MapPin,
  Pause,
  Play,
  Search,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
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
  onOpenSourceViewer?: (file: string, line: number) => void;
  filterRequestId: string | null;
  onClearFilter?: () => void;
  onClearRequestIdFilter?: () => void;
}

export const Logs: React.FC<LogsProps> = ({
  onOpenSourceViewer,
  filterRequestId,
  onClearFilter,
  onClearRequestIdFilter,
}) => {
  const [logsList, setLogsList] = useState<LogItem[]>([]);
  const [logFilterLevel, setLogFilterLevel] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [showInternal, setShowInternal] = useState(false);
  const [expandedStacks, setExpandedStacks] = useState<Record<string, boolean>>(
    {},
  );
  const [isRegexSearch, setIsRegexSearch] = useState(false);
  const [timeFilterRange, setTimeFilterRange] = useState('ALL');
  const [isLiveStreaming, setIsLiveStreaming] = useState(true);

  const handleClearFilter = () => {
    onClearRequestIdFilter?.();
    onClearFilter?.();
  };

  useEffect(() => {
    fetchLogs();
    if (!isLiveStreaming) return;
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [isLiveStreaming]);

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
      const match =
        /(at\s+(?:[^\s()]+?\s+\()?)?([^\s()]+?):(\d+)(?::(\d+))?(\)?)/.exec(
          trimmed,
        );
      if (match) {
        const prefix = match[1] || 'at ';
        const filePath = match[2];
        const lineNum = Number(match[3]);
        const colNum = match[4] || '';
        const suffix = match[5] || '';

        if (
          filePath.includes('node:internal') ||
          filePath.includes('node_modules')
        ) {
          return <div key={i}>{line}</div>;
        }

        const cleanPath = filePath.replace(/\\/g, '/');
        return (
          <div key={i}>
            &nbsp;&nbsp;&nbsp;&nbsp;{prefix}
            <span
              onClick={() => onOpenSourceViewer?.(cleanPath, lineNum)}
              style={{
                color: 'var(--accent)',
                cursor: 'pointer',
                textDecoration: 'underline',
                fontWeight: 500,
              }}
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
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return <StructuredJsonViewer data={parsed} />;
      } catch (e) {}
    }
    return msg;
  };

  // Filter list and reverse so that the newly added entry is at the top
  const filteredLogs = logsList
    .filter((log) => {
      const matchesLevel =
        logFilterLevel === 'ALL' || log.level.toUpperCase() === logFilterLevel;

      let matchesSearch = true;
      if (searchTerm.trim()) {
        if (isRegexSearch) {
          try {
            const regex = new RegExp(searchTerm, 'i');
            matchesSearch =
              regex.test(log.message) || !!(log.stack && regex.test(log.stack));
          } catch {
            const cleanSearch = searchTerm.toLowerCase().trim();
            matchesSearch =
              log.message.toLowerCase().includes(cleanSearch) ||
              !!(log.stack && log.stack.toLowerCase().includes(cleanSearch));
          }
        } else {
          const cleanSearch = searchTerm.toLowerCase().trim();
          matchesSearch =
            log.message.toLowerCase().includes(cleanSearch) ||
            !!(log.stack && log.stack.toLowerCase().includes(cleanSearch));
        }
      }

      const matchesInternal = showInternal || !log.isInternal;
      const matchesRequestId =
        !filterRequestId || log.requestId === filterRequestId;

      let matchesTime = true;
      if (timeFilterRange !== 'ALL') {
        const logTime = new Date(log.timestamp).getTime();
        const diffMs = Date.now() - logTime;
        if (timeFilterRange === '1M') matchesTime = diffMs <= 60 * 1000;
        else if (timeFilterRange === '5M')
          matchesTime = diffMs <= 5 * 60 * 1000;
        else if (timeFilterRange === '15M')
          matchesTime = diffMs <= 15 * 60 * 1000;
        else if (timeFilterRange === '1H')
          matchesTime = diffMs <= 60 * 60 * 1000;
      }

      return (
        matchesLevel &&
        matchesSearch &&
        matchesInternal &&
        matchesRequestId &&
        matchesTime
      );
    })
    .slice()
    .reverse();

  return (
    <div className="log-observatory">
      {/* ── Top Toolbar / Command Header ─────────────────────── */}
      <div className="log-toolbar">
        {/* Left: Title + Streaming Status Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Terminal size={15} style={{ color: 'var(--accent)' }} />
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: 'var(--text-primary)',
              }}
            >
              Logs Observatory
            </span>
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              background: isLiveStreaming
                ? 'rgba(16, 185, 129, 0.1)'
                : 'var(--bg-tertiary)',
              border: `1px solid ${isLiveStreaming ? 'rgba(16, 185, 129, 0.25)' : 'var(--border)'}`,
              color: isLiveStreaming ? 'var(--success)' : 'var(--text-muted)',
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: isLiveStreaming
                  ? 'var(--success)'
                  : 'var(--text-muted)',
                boxShadow: isLiveStreaming
                  ? '0 0 8px rgba(16, 185, 129, 0.5)'
                  : 'none',
              }}
            />
            <span>{isLiveStreaming ? 'Live' : 'Paused'}</span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
              • {filteredLogs.length} events
            </span>
          </div>

          {filterRequestId && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '10.5px',
                fontFamily: 'var(--font-mono)',
                background: 'rgba(99, 102, 241, 0.12)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                color: 'var(--accent-text)',
                cursor: 'pointer',
              }}
              onClick={handleClearFilter}
              title="Click to clear request filter"
            >
              <Hash size={10} />
              <span>req:{filterRequestId.substring(0, 8)}...</span>
              <X size={10} />
            </div>
          )}
        </div>

        {/* Right: Actions (Pause/Resume, Clear, Export) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              gap: '5px',
              color: 'var(--text-secondary)',
            }}
            onClick={() => setIsLiveStreaming(!isLiveStreaming)}
            title={isLiveStreaming ? 'Pause log stream' : 'Resume live stream'}
          >
            {isLiveStreaming ? <Pause size={12} /> : <Play size={12} />}
            <span>{isLiveStreaming ? 'Pause' : 'Resume'}</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '4px 10px', fontSize: '11px', gap: '5px' }}
            onClick={handleClearLogs}
            title="Clear all logs"
          >
            <Trash2 size={12} />
            <span>Clear</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '4px 10px', fontSize: '11px', gap: '5px' }}
            onClick={handleExportLogs}
            title="Export logs as JSON"
          >
            <Download size={12} />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* ── Filter Bar ────────────────────────────────────────── */}
      <div
        style={{
          padding: '8px 16px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        {/* Level Filters */}
        <div className="log-filters-group">
          {(['ALL', 'INFO', 'WARN', 'ERROR', 'DEBUG', 'TRACE'] as const).map(
            (level) => {
              const isActive = logFilterLevel === level;
              const levelClass = level.toLowerCase();
              return (
                <button
                  key={level}
                  type="button"
                  className={`log-level-pill ${isActive ? `active level-${levelClass}` : ''}`}
                  onClick={() => setLogFilterLevel(level)}
                >
                  {level === 'ALL' ? 'All' : level}
                </button>
              );
            },
          )}
        </div>

        {/* Search & Modifiers */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          {/* Time Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Window:
            </span>
            <select
              value={timeFilterRange}
              onChange={(e) => setTimeFilterRange(e.target.value)}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-xs)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <option value="ALL">All Time</option>
              <option value="1M">Last 1m</option>
              <option value="5M">Last 5m</option>
              <option value="15M">Last 15m</option>
              <option value="1H">Last 1h</option>
            </select>
          </div>

          {/* Framework Logs Checkbox */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={showInternal}
              onChange={(e) => setShowInternal(e.target.checked)}
            />
            Framework
          </label>

          {/* Search Input */}
          <div style={{ position: 'relative', width: '220px' }}>
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
              placeholder={isRegexSearch ? 'Regex filter...' : 'Search logs...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '4px 24px 4px 26px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-xs)',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                style={{
                  position: 'absolute',
                  right: '6px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  display: 'flex',
                }}
              >
                <X size={11} />
              </button>
            )}
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={isRegexSearch}
              onChange={(e) => setIsRegexSearch(e.target.checked)}
            />
            Regex
          </label>
        </div>
      </div>

      {/* ── Log Stream Table ──────────────────────────────────── */}
      <div className="log-stream-table">
        {filteredLogs.length === 0 ? (
          <div
            style={{
              padding: '60px 20px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <Terminal size={32} style={{ opacity: 0.3 }} />
            <div
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
              }}
            >
              No log events captured
            </div>
            <div style={{ fontSize: '11px', maxWidth: '360px' }}>
              {searchTerm || logFilterLevel !== 'ALL' || filterRequestId
                ? 'No logs match current filters. Try resetting search or level filters.'
                : 'Send requests or trigger backend operations to stream live application telemetry here.'}
            </div>
            {(searchTerm || logFilterLevel !== 'ALL' || filterRequestId) && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  marginTop: '6px',
                }}
                onClick={() => {
                  setSearchTerm('');
                  setLogFilterLevel('ALL');
                  handleClearFilter();
                }}
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          filteredLogs.map((log) => {
            const levelClass = log.level.toLowerCase();
            const dateObj = new Date(log.timestamp);
            const timeStr =
              dateObj.toLocaleTimeString() +
              '.' +
              String(dateObj.getMilliseconds()).padStart(3, '0');
            const hasStack = log.stack && log.stack.trim().length > 0;
            const isStackOpen = !!expandedStacks[log.id];

            return (
              <div
                key={log.id}
                className={`log-row ${levelClass === 'error' || levelClass === 'fatal' ? 'is-error' : levelClass === 'warn' ? 'is-warn' : ''}`}
              >
                {/* Timestamp */}
                <span className="log-timestamp">{timeStr}</span>

                {/* Level Badge */}
                <span className={`log-badge level-${levelClass}`}>
                  {log.level.toUpperCase()}
                </span>

                {/* Framework pill */}
                {log.isInternal && (
                  <span
                    style={{
                      fontSize: '9px',
                      fontFamily: 'var(--font-mono)',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      background: 'rgba(245, 158, 11, 0.1)',
                      color: 'var(--warning)',
                      border: '1px solid rgba(245, 158, 11, 0.25)',
                      flexShrink: 0,
                    }}
                  >
                    FRAMEWORK
                  </span>
                )}

                {/* Correlation Request ID */}
                {log.requestId && (
                  <span
                    onClick={() => {
                      const event = new CustomEvent(
                        'axiomify-filter-request-id',
                        {
                          detail: log.requestId,
                        },
                      );
                      window.dispatchEvent(event);
                    }}
                    title="Click to isolate logs for this request ID"
                    style={{
                      fontSize: '9.5px',
                      fontFamily: 'var(--font-mono)',
                      padding: '1px 6px',
                      borderRadius: '3px',
                      background: 'rgba(16, 185, 129, 0.08)',
                      color: 'var(--success)',
                      border: '1px solid rgba(16, 185, 129, 0.2)',
                      cursor: 'pointer',
                      flexShrink: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                  >
                    <Hash size={9} />
                    {log.requestId.substring(0, 8)}
                  </span>
                )}

                {/* Source location */}
                {log.source && log.source !== 'unknown' && (
                  <span
                    onClick={() => {
                      const parts = log.source!.split(':');
                      const pathStr = parts[0].replace(/\\/g, '/');
                      const lineNum = Number(parts[1]) || 1;
                      onOpenSourceViewer?.(pathStr, lineNum);
                    }}
                    title="Inspect source file"
                    style={{
                      fontSize: '9.5px',
                      fontFamily: 'var(--font-mono)',
                      padding: '1px 6px',
                      borderRadius: '3px',
                      background: 'rgba(99, 102, 241, 0.08)',
                      color: 'var(--accent-text)',
                      border: '1px solid rgba(99, 102, 241, 0.2)',
                      cursor: 'pointer',
                      flexShrink: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                  >
                    <MapPin size={9} />
                    {log.source}
                  </span>
                )}

                {/* Main Message Content */}
                <div className="log-message-content">
                  {formatLogMessage(log.message)}

                  {/* Stack Trace Toggle */}
                  {hasStack && (
                    <div style={{ marginTop: '4px' }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{
                          padding: '1px 6px',
                          fontSize: '10px',
                          height: 'auto',
                          color: 'var(--accent-text)',
                        }}
                        onClick={() =>
                          setExpandedStacks((prev) => ({
                            ...prev,
                            [log.id]: !isStackOpen,
                          }))
                        }
                      >
                        {isStackOpen
                          ? '▾ Hide Stack Trace'
                          : '▸ Show Stack Trace'}
                      </button>
                      {isStackOpen && (
                        <pre
                          style={{
                            margin: '4px 0 0 0',
                            padding: '8px 10px',
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-xs)',
                            fontSize: '11px',
                            color: 'var(--text-secondary)',
                            lineHeight: 1.5,
                            overflowX: 'auto',
                          }}
                        >
                          {formatStack(log.stack || '')}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// Sub-component: Collapsible JSON Viewer for Logs
const StructuredJsonViewer: React.FC<{ data: any }> = ({ data }) => {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        marginTop: '4px',
      }}
    >
      <div
        style={{
          cursor: 'pointer',
          color: 'var(--accent)',
          fontWeight: 600,
          textDecoration: 'underline',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
        }}
        onClick={() => setOpen(!open)}
      >
        <Code2 size={13} /> Structured JSON Payload (click to toggle)
      </div>
      {open && (
        <pre
          style={{
            marginTop: '4px',
            padding: '8px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: '300px',
            overflowY: 'auto',
            color: 'var(--text-primary)',
          }}
        >
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
};
