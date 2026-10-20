import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Download,
  FileJson,
  Radio,
  Search,
  Shield,
  Terminal,
  Trash2,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch, getToken } from '../utils/api';

interface RecorderProps {
  onReplay?: (method: string, path: string) => void;
  onInspectCode?: (
    filePath: string,
    lineNumber: number,
  ) => Promise<void> | void;
}

export const Recorder: React.FC<RecorderProps> = ({ onReplay }) => {
  const [sessionData, setSessionData] = useState<any | null>(null);
  const [recordBodies, setRecordBodies] = useState(true);
  const [sensitiveKeysText, setSensitiveKeysText] = useState('');
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string>('');
  const [filterText, setFilterText] = useState('');
  const [activeDetailSection, setActiveDetailSection] = useState<
    'request' | 'middlewares' | 'queries' | 'response'
  >('request');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    fetchSession();
    fetchPrivacy();
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

  const fetchPrivacy = async () => {
    try {
      const res = await apiFetch('/__studio/api/privacy');
      if (res.ok) {
        const privacy = await res.json();
        setRecordBodies(privacy.includeBodies !== false);
        setSensitiveKeysText((privacy.sensitiveKeys || []).join(', '));
      }
    } catch (err) {
      console.error('Failed to fetch recorder privacy settings:', err);
    }
  };

  const handleRecordBodiesChange = async (includeBodies: boolean) => {
    setRecordBodies(includeBodies);
    try {
      const res = await apiFetch('/__studio/api/privacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeBodies }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setRecordBodies(!includeBodies);
      console.error('Failed to update recorder privacy settings:', err);
    }
  };

  const handleSaveSensitiveKeys = async () => {
    const sensitiveKeys = sensitiveKeysText
      .split(/[\n,]/)
      .map((key) => key.trim())
      .filter(Boolean);
    setSavingPrivacy(true);
    try {
      const res = await apiFetch('/__studio/api/privacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sensitiveKeys }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const privacy = await res.json();
      setSensitiveKeysText((privacy.sensitiveKeys || []).join(', '));
    } catch (err) {
      console.error('Failed to update sensitive field settings:', err);
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleClearSession = async () => {
    if (!confirm('Are you sure you want to clear session recording data?'))
      return;
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

  const handleExport = (format: 'har' | 'json') => {
    const token = getToken();
    const endpoint = format === 'har' ? 'har' : 'export';
    window.location.href = `/__studio/api/session/${endpoint}?token=${encodeURIComponent(token)}`;
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const entries: any[] = sessionData?.entries || [];

  const filteredEntries = useMemo(() => {
    if (!filterText.trim()) return entries;
    const lower = filterText.toLowerCase();
    return entries.filter(
      (e) =>
        e.request?.path?.toLowerCase().includes(lower) ||
        e.request?.method?.toLowerCase().includes(lower) ||
        String(e.response?.status || '').includes(lower) ||
        e.requestId?.toLowerCase().includes(lower),
    );
  }, [entries, filterText]);

  const selectedEntry =
    filteredEntries.find((e) => e.requestId === selectedRequestId) ||
    entries.find((e) => e.requestId === selectedRequestId) ||
    filteredEntries[0] ||
    entries[0];

  const getStatusBadge = (code: number) => {
    if (code >= 200 && code < 300) {
      return {
        bg: 'rgba(34, 197, 94, 0.12)',
        color: '#4ade80',
        border: '1px solid rgba(34, 197, 94, 0.25)',
      };
    }
    if (code >= 300 && code < 400) {
      return {
        bg: 'rgba(234, 179, 8, 0.12)',
        color: '#facc15',
        border: '1px solid rgba(234, 179, 8, 0.25)',
      };
    }
    if (code >= 400) {
      return {
        bg: 'rgba(239, 68, 68, 0.12)',
        color: '#f87171',
        border: '1px solid rgba(239, 68, 68, 0.25)',
      };
    }
    return {
      bg: 'rgba(255, 255, 255, 0.05)',
      color: 'var(--text-muted)',
      border: '1px solid var(--border)',
    };
  };

  return (
    <div
      className="panel-modern-layout"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        animation: 'fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Modern Top Header */}
      <div
        className="panel-header-modern"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 100%)',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#f87171',
            }}
          >
            <Radio size={18} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: '15px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.01em',
                }}
              >
                Session Recorder
              </h2>
              {entries.length > 0 && (
                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: 'rgba(59, 130, 246, 0.12)',
                    color: 'var(--accent)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                  }}
                >
                  {entries.length} recorded
                </span>
              )}
            </div>
            <p
              style={{
                margin: '2px 0 0',
                fontSize: '12px',
                color: 'var(--text-muted)',
              }}
            >
              Capture, inspect, and export live HTTP & WebSocket transactions
              with lifecycle telemetry
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            className="btn btn-secondary"
            onClick={handleClearSession}
            disabled={!sessionData || entries.length === 0}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              padding: '6px 12px',
            }}
          >
            <Trash2 size={13} />
            Clear
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleExport('json')}
            disabled={entries.length === 0}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              padding: '6px 12px',
            }}
          >
            <FileJson size={13} />
            Export JSON
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleExport('har')}
            disabled={entries.length === 0}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              padding: '6px 12px',
            }}
          >
            <Download size={13} />
            Export HAR
          </button>
        </div>
      </div>

      {/* Privacy Subheader Strip */}
      <div
        style={{
          padding: '10px 20px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          fontSize: '12px',
        }}
      >
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
          }}
        >
          <input
            type="checkbox"
            checked={recordBodies}
            onChange={(e) => handleRecordBodiesChange(e.target.checked)}
            style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
          <span>Record request & response payloads</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            (headers & sensitive keys auto-redacted)
          </span>
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--text-muted)',
              fontSize: '11px',
            }}
          >
            <Shield size={12} />
            <span>Sensitive keys:</span>
          </div>
          <input
            className="text-input"
            value={sensitiveKeysText}
            onChange={(e) => setSensitiveKeysText(e.target.value)}
            placeholder="customerId, password, token"
            aria-label="Additional sensitive field names"
            style={{
              width: '200px',
              padding: '4px 8px',
              fontSize: '11px',
              height: '28px',
            }}
          />
          <button
            className="btn btn-secondary"
            onClick={handleSaveSensitiveKeys}
            disabled={savingPrivacy}
            style={{ fontSize: '11px', padding: '4px 10px', height: '28px' }}
          >
            {savingPrivacy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {entries.length === 0 ? (
        <div
          className="empty-state"
          style={{ padding: '64px 20px', textAlign: 'center' }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              color: 'var(--text-muted)',
            }}
          >
            <Radio size={22} />
          </div>
          <div
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '6px',
            }}
          >
            No Recorded Transactions
          </div>
          <div
            className="empty-state-message"
            style={{
              maxWidth: '380px',
              margin: '0 auto',
              fontSize: '12px',
              color: 'var(--text-muted)',
              lineHeight: '1.5',
            }}
          >
            Fire some requests via the Request Tester or host API to inspect
            transaction lifecycles, database queries, and middleware traces.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '320px 1fr',
            flex: 1,
            overflow: 'hidden',
          }}
        >
          {/* Left Panel: Stream of Transactions */}
          <div
            style={{
              borderRight: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Search Filter Header */}
            <div
              style={{
                padding: '12px 14px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Search
                  size={13}
                  style={{
                    position: 'absolute',
                    left: '8px',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  type="text"
                  placeholder="Filter transactions…"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px 6px 28px',
                    fontSize: '12px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* List */}
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
              {filteredEntries.map((e: any) => {
                const isSelected =
                  selectedEntry && e.requestId === selectedEntry.requestId;
                const status = e.response?.status || 0;
                const duration = e.response?.durationMs;
                const statusTheme = getStatusBadge(status);

                return (
                  <div
                    key={e.requestId}
                    onClick={() => setSelectedRequestId(e.requestId)}
                    style={{
                      background: isSelected
                        ? 'rgba(59, 130, 246, 0.08)'
                        : 'var(--bg-primary)',
                      border: isSelected
                        ? '1px solid rgba(59, 130, 246, 0.35)'
                        : '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 12px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '6px',
                      }}
                    >
                      <span
                        className={`method-badge method-${e.request?.method || 'GET'}`}
                        style={{ fontSize: '10px', padding: '1px 6px' }}
                      >
                        {e.request?.method || 'GET'}
                      </span>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        {status > 0 && (
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              fontFamily: 'var(--font-mono)',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              background: statusTheme.bg,
                              color: statusTheme.color,
                              border: statusTheme.border,
                            }}
                          >
                            {status}
                          </span>
                        )}
                        {duration !== undefined && (
                          <span
                            style={{
                              fontSize: '11px',
                              color: 'var(--text-muted)',
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            {duration.toFixed(1)}ms
                          </span>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={e.request?.path}
                    >
                      {e.request?.path || '/'}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        marginTop: '6px',
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)' }}>
                        {e.requestId.slice(0, 8)}
                      </span>
                      <span>
                        {new Date(
                          e.request?.timestamp || Date.now(),
                        ).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Panel: Flowchart + Inspection Tabs */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-primary)',
              overflowY: 'auto',
            }}
          >
            {selectedEntry ? (
              <div
                style={{
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                }}
              >
                {/* Visual Flowchart Lifecycle */}
                <div
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '18px 20px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--text-muted)',
                      marginBottom: '14px',
                    }}
                  >
                    Transaction Lifecycle Flowchart
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      overflowX: 'auto',
                      paddingBottom: '4px',
                    }}
                  >
                    {/* Node 1: Client Request */}
                    <button
                      onClick={() => setActiveDetailSection('request')}
                      style={{
                        flex: '1 1 0',
                        minWidth: '140px',
                        background:
                          activeDetailSection === 'request'
                            ? 'rgba(59, 130, 246, 0.1)'
                            : 'var(--bg-primary)',
                        border:
                          activeDetailSection === 'request'
                            ? '1px solid var(--accent)'
                            : '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          marginBottom: '4px',
                          color:
                            activeDetailSection === 'request'
                              ? 'var(--accent)'
                              : 'var(--text-muted)',
                        }}
                      >
                        <Terminal size={14} />
                        <span style={{ fontSize: '12px', fontWeight: 600 }}>
                          1. Request
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {selectedEntry.request?.method}{' '}
                        {selectedEntry.request?.path}
                      </div>
                    </button>

                    <ArrowRight
                      size={14}
                      style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                    />

                    {/* Node 2: Middlewares */}
                    <button
                      onClick={() => setActiveDetailSection('middlewares')}
                      style={{
                        flex: '1 1 0',
                        minWidth: '140px',
                        background:
                          activeDetailSection === 'middlewares'
                            ? 'rgba(59, 130, 246, 0.1)'
                            : 'var(--bg-primary)',
                        border:
                          activeDetailSection === 'middlewares'
                            ? '1px solid var(--accent)'
                            : '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          marginBottom: '4px',
                          color:
                            activeDetailSection === 'middlewares'
                              ? 'var(--accent)'
                              : 'var(--text-muted)',
                        }}
                      >
                        <Shield size={14} />
                        <span style={{ fontSize: '12px', fontWeight: 600 }}>
                          2. Pipeline
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {selectedEntry.timeline?.length || 0} stages recorded
                      </div>
                    </button>

                    <ArrowRight
                      size={14}
                      style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                    />

                    {/* Node 3: Database Queries */}
                    <button
                      onClick={() => setActiveDetailSection('queries')}
                      style={{
                        flex: '1 1 0',
                        minWidth: '140px',
                        background:
                          activeDetailSection === 'queries'
                            ? 'rgba(59, 130, 246, 0.1)'
                            : 'var(--bg-primary)',
                        border:
                          activeDetailSection === 'queries'
                            ? '1px solid var(--accent)'
                            : '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          marginBottom: '4px',
                          color:
                            activeDetailSection === 'queries'
                              ? 'var(--accent)'
                              : 'var(--text-muted)',
                        }}
                      >
                        <Database size={14} />
                        <span style={{ fontSize: '12px', fontWeight: 600 }}>
                          3. Queries
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {selectedEntry.queries?.length || 0} executed
                      </div>
                    </button>

                    <ArrowRight
                      size={14}
                      style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                    />

                    {/* Node 4: Server Response */}
                    <button
                      onClick={() => setActiveDetailSection('response')}
                      style={{
                        flex: '1 1 0',
                        minWidth: '140px',
                        background:
                          activeDetailSection === 'response'
                            ? 'rgba(59, 130, 246, 0.1)'
                            : 'var(--bg-primary)',
                        border:
                          activeDetailSection === 'response'
                            ? '1px solid var(--accent)'
                            : '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          marginBottom: '4px',
                          color:
                            activeDetailSection === 'response'
                              ? 'var(--accent)'
                              : 'var(--text-muted)',
                        }}
                      >
                        <Download size={14} />
                        <span style={{ fontSize: '12px', fontWeight: 600 }}>
                          4. Response
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          fontFamily: 'var(--font-mono)',
                          color: selectedEntry.response
                            ? getStatusBadge(selectedEntry.response.status)
                                .color
                            : 'var(--text-muted)',
                        }}
                      >
                        {selectedEntry.response
                          ? `${selectedEntry.response.status} OK`
                          : 'Pending'}
                      </div>
                    </button>
                  </div>
                </div>

                {/* Tabbed Inspection Container */}
                <div
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                  }}
                >
                  {/* Request Section */}
                  {activeDetailSection === 'request' && (
                    <div style={{ padding: '20px' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '16px',
                        }}
                      >
                        <div>
                          <span
                            className="tag-pill"
                            style={{
                              textTransform: 'uppercase',
                              fontSize: '10px',
                            }}
                          >
                            Inbound Payload
                          </span>
                          <h4
                            style={{
                              margin: '6px 0 0',
                              fontSize: '14px',
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--text-primary)',
                            }}
                          >
                            {selectedEntry.request?.method}{' '}
                            {selectedEntry.request?.path}
                          </h4>
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns:
                            'repeat(auto-fit, minmax(300px, 1fr))',
                          gap: '16px',
                        }}
                      >
                        {/* Headers */}
                        <div
                          style={{
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '14px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '8px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                color: 'var(--text-muted)',
                              }}
                            >
                              Headers
                            </span>
                            <button
                              className="btn btn-secondary"
                              onClick={() =>
                                handleCopy(
                                  JSON.stringify(
                                    selectedEntry.request?.headers,
                                    null,
                                    2,
                                  ),
                                  'req-headers',
                                )
                              }
                              style={{
                                padding: '2px 8px',
                                fontSize: '10px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              {copiedKey === 'req-headers' ? (
                                <Check size={11} color="var(--success)" />
                              ) : (
                                <Copy size={11} />
                              )}
                              Copy
                            </button>
                          </div>
                          <pre
                            style={{
                              margin: 0,
                              fontSize: '11px',
                              fontFamily: 'var(--font-mono)',
                              whiteSpace: 'pre-wrap',
                              maxHeight: '220px',
                              overflowY: 'auto',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {JSON.stringify(
                              selectedEntry.request?.headers || {},
                              null,
                              2,
                            )}
                          </pre>
                        </div>

                        {/* Body / Query Params */}
                        <div
                          style={{
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '14px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '8px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                color: 'var(--text-muted)',
                              }}
                            >
                              Body / Query Parameters
                            </span>
                            <button
                              className="btn btn-secondary"
                              onClick={() =>
                                handleCopy(
                                  JSON.stringify(
                                    selectedEntry.request?.body ||
                                      selectedEntry.request?.query ||
                                      {},
                                    null,
                                    2,
                                  ),
                                  'req-body',
                                )
                              }
                              style={{
                                padding: '2px 8px',
                                fontSize: '10px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              {copiedKey === 'req-body' ? (
                                <Check size={11} color="var(--success)" />
                              ) : (
                                <Copy size={11} />
                              )}
                              Copy
                            </button>
                          </div>
                          <pre
                            style={{
                              margin: 0,
                              fontSize: '11px',
                              fontFamily: 'var(--font-mono)',
                              whiteSpace: 'pre-wrap',
                              maxHeight: '220px',
                              overflowY: 'auto',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {selectedEntry.request?.body
                              ? JSON.stringify(
                                  selectedEntry.request.body,
                                  null,
                                  2,
                                )
                              : selectedEntry.request?.query &&
                                  Object.keys(selectedEntry.request.query)
                                    .length > 0
                                ? JSON.stringify(
                                    selectedEntry.request.query,
                                    null,
                                    2,
                                  )
                                : 'No payload or query parameters'}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Middlewares Section */}
                  {activeDetailSection === 'middlewares' && (
                    <div style={{ padding: '20px' }}>
                      <div
                        style={{
                          borderBottom: '1px solid var(--border)',
                          paddingBottom: '12px',
                          marginBottom: '16px',
                        }}
                      >
                        <span
                          className="tag-pill"
                          style={{
                            textTransform: 'uppercase',
                            fontSize: '10px',
                          }}
                        >
                          Pipeline Breakdown
                        </span>
                        <h4
                          style={{
                            margin: '6px 0 0',
                            fontSize: '14px',
                            color: 'var(--text-primary)',
                          }}
                        >
                          Execution Middleware Pipeline
                        </h4>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        {selectedEntry.timeline &&
                        selectedEntry.timeline.length > 0 ? (
                          selectedEntry.timeline.map(
                            (step: any, idx: number) => (
                              <div
                                key={idx}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  background: 'var(--bg-primary)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 'var(--radius-sm)',
                                  padding: '10px 14px',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                  }}
                                >
                                  <CheckCircle2
                                    size={13}
                                    style={{ color: 'var(--success)' }}
                                  />
                                  <span
                                    style={{
                                      fontSize: '12px',
                                      fontWeight: 500,
                                      color: 'var(--text-primary)',
                                    }}
                                  >
                                    {step.name}
                                  </span>
                                </div>
                                <span
                                  style={{
                                    fontSize: '11px',
                                    color: 'var(--accent)',
                                    fontFamily: 'var(--font-mono)',
                                  }}
                                >
                                  {step.duration.toFixed(2)} ms
                                </span>
                              </div>
                            ),
                          )
                        ) : (
                          <div
                            style={{
                              fontStyle: 'italic',
                              color: 'var(--text-muted)',
                              fontSize: '12px',
                              textAlign: 'center',
                              padding: '24px',
                            }}
                          >
                            No custom middleware timing markers captured for
                            this transaction.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Database Queries Section */}
                  {activeDetailSection === 'queries' && (
                    <div style={{ padding: '20px' }}>
                      <div
                        style={{
                          borderBottom: '1px solid var(--border)',
                          paddingBottom: '12px',
                          marginBottom: '16px',
                        }}
                      >
                        <span
                          className="tag-pill"
                          style={{
                            textTransform: 'uppercase',
                            fontSize: '10px',
                          }}
                        >
                          Database Operations
                        </span>
                        <h4
                          style={{
                            margin: '6px 0 0',
                            fontSize: '14px',
                            color: 'var(--text-primary)',
                          }}
                        >
                          SQL & ORM Operations (
                          {selectedEntry.queries?.length || 0})
                        </h4>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '10px',
                          maxHeight: '340px',
                          overflowY: 'auto',
                        }}
                      >
                        {!selectedEntry.queries ||
                        selectedEntry.queries.length === 0 ? (
                          <div
                            style={{
                              fontStyle: 'italic',
                              color: 'var(--text-muted)',
                              fontSize: '12px',
                              textAlign: 'center',
                              padding: '28px',
                            }}
                          >
                            No database queries were executed during this
                            transaction.
                          </div>
                        ) : (
                          selectedEntry.queries.map((q: any, idx: number) => (
                            <div
                              key={idx}
                              style={{
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-sm)',
                                padding: '12px',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  marginBottom: '8px',
                                }}
                              >
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    color: q.failed ? '#f87171' : '#4ade80',
                                  }}
                                >
                                  {q.failed ? (
                                    <>
                                      <AlertTriangle size={12} /> FAILED
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle2 size={12} /> SUCCESS
                                    </>
                                  )}
                                </span>
                                <span
                                  style={{
                                    fontSize: '11px',
                                    fontFamily: 'var(--font-mono)',
                                    color: 'var(--text-muted)',
                                  }}
                                >
                                  {q.durationMs.toFixed(1)} ms
                                </span>
                              </div>
                              <pre
                                style={{
                                  margin: 0,
                                  fontSize: '11px',
                                  fontFamily: 'var(--font-mono)',
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-all',
                                  color: 'var(--text-primary)',
                                }}
                              >
                                {q.query}
                              </pre>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* Response Section */}
                  {activeDetailSection === 'response' && (
                    <div style={{ padding: '20px' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          borderBottom: '1px solid var(--border)',
                          paddingBottom: '12px',
                          marginBottom: '16px',
                        }}
                      >
                        <div>
                          <span
                            className="tag-pill"
                            style={{
                              textTransform: 'uppercase',
                              fontSize: '10px',
                            }}
                          >
                            Outbound Payload
                          </span>
                          <h4
                            style={{
                              margin: '6px 0 0',
                              fontSize: '14px',
                              color: 'var(--text-primary)',
                            }}
                          >
                            Execution Response
                          </h4>
                        </div>
                        {selectedEntry.response && (
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              fontFamily: 'var(--font-mono)',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              ...getStatusBadge(selectedEntry.response.status),
                            }}
                          >
                            {selectedEntry.response.status}
                          </span>
                        )}
                      </div>

                      {selectedEntry.response ? (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns:
                              'repeat(auto-fit, minmax(300px, 1fr))',
                            gap: '16px',
                          }}
                        >
                          {/* Response Headers */}
                          <div
                            style={{
                              background: 'var(--bg-primary)',
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '14px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '8px',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  textTransform: 'uppercase',
                                  color: 'var(--text-muted)',
                                }}
                              >
                                Headers
                              </span>
                              <button
                                className="btn btn-secondary"
                                onClick={() =>
                                  handleCopy(
                                    JSON.stringify(
                                      selectedEntry.response.headers,
                                      null,
                                      2,
                                    ),
                                    'res-headers',
                                  )
                                }
                                style={{
                                  padding: '2px 8px',
                                  fontSize: '10px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                {copiedKey === 'res-headers' ? (
                                  <Check size={11} color="var(--success)" />
                                ) : (
                                  <Copy size={11} />
                                )}
                                Copy
                              </button>
                            </div>
                            <pre
                              style={{
                                margin: 0,
                                fontSize: '11px',
                                fontFamily: 'var(--font-mono)',
                                whiteSpace: 'pre-wrap',
                                maxHeight: '220px',
                                overflowY: 'auto',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              {JSON.stringify(
                                selectedEntry.response.headers || {},
                                null,
                                2,
                              )}
                            </pre>
                          </div>

                          {/* Response Body */}
                          <div
                            style={{
                              background: 'var(--bg-primary)',
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '14px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '8px',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  textTransform: 'uppercase',
                                  color: 'var(--text-muted)',
                                }}
                              >
                                Response Body
                              </span>
                              <button
                                className="btn btn-secondary"
                                onClick={() =>
                                  handleCopy(
                                    typeof selectedEntry.response.body ===
                                      'object'
                                      ? JSON.stringify(
                                          selectedEntry.response.body,
                                          null,
                                          2,
                                        )
                                      : String(
                                          selectedEntry.response.body || '',
                                        ),
                                    'res-body',
                                  )
                                }
                                style={{
                                  padding: '2px 8px',
                                  fontSize: '10px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                {copiedKey === 'res-body' ? (
                                  <Check size={11} color="var(--success)" />
                                ) : (
                                  <Copy size={11} />
                                )}
                                Copy
                              </button>
                            </div>
                            <pre
                              style={{
                                margin: 0,
                                fontSize: '11px',
                                fontFamily: 'var(--font-mono)',
                                whiteSpace: 'pre-wrap',
                                maxHeight: '220px',
                                overflowY: 'auto',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              {selectedEntry.response.body
                                ? typeof selectedEntry.response.body ===
                                  'object'
                                  ? JSON.stringify(
                                      selectedEntry.response.body,
                                      null,
                                      2,
                                    )
                                  : String(selectedEntry.response.body)
                                : 'Empty Response Body'}
                            </pre>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            fontStyle: 'italic',
                            color: 'var(--text-muted)',
                            fontSize: '12px',
                            textAlign: 'center',
                            padding: '24px',
                          }}
                        >
                          Response has not been captured yet or transaction is
                          incomplete.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div
                style={{
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                  padding: '48px',
                  fontSize: '13px',
                }}
              >
                Select a transaction from the left list.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
