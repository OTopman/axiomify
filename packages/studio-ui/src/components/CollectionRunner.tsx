import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DiscoveryData } from '../types';
import {
  generateRunnerMarkdownSummary,
  runCollectionBatch,
  RunnerItemResult,
  RunnerReport,
} from '../utils/collection-runner';
import {
  RequestCollection,
  RequestEnvironment,
} from '../utils/request-collections';

import {
  Activity,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Folder,
  Play,
  Sliders,
  Square,
  X,
  XCircle,
} from 'lucide-react';

interface CollectionRunnerProps {
  discovery: DiscoveryData;
  collections: RequestCollection[];
  initialCollectionId?: string;
  environments: RequestEnvironment[];
  initialEnvironmentId?: string;
  isOpen: boolean;
  onClose: () => void;
}

export const CollectionRunner: React.FC<CollectionRunnerProps> = ({
  discovery,
  collections,
  initialCollectionId = '',
  environments,
  initialEnvironmentId = '',
  isOpen,
  onClose,
}) => {
  const [selectedCollectionId, setSelectedCollectionId] = useState(
    initialCollectionId || (collections.length > 0 ? collections[0].id : ''),
  );
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState(
    initialEnvironmentId || (environments.length > 0 ? environments[0].id : ''),
  );

  // Configuration options
  const [delayMs, setDelayMs] = useState(0);
  const [maxLatencyMs, setMaxLatencyMs] = useState(2000);
  const [stopOnError, setStopOnError] = useState(false);
  const [autoExtractTokens, setAutoExtractTokens] = useState(true);

  // Execution state
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });
  const [report, setReport] = useState<RunnerReport | null>(null);
  const [liveResults, setLiveResults] = useState<RunnerItemResult[]>([]);
  const [filterMode, setFilterMode] = useState<'all' | 'passed' | 'failed'>(
    'all',
  );
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>(
    {},
  );
  const [copiedSummary, setCopiedSummary] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Update selected IDs when props change
  useEffect(() => {
    if (initialCollectionId) {
      setSelectedCollectionId(initialCollectionId);
    }
  }, [initialCollectionId]);

  useEffect(() => {
    if (initialEnvironmentId) {
      setSelectedEnvironmentId(initialEnvironmentId);
    }
  }, [initialEnvironmentId]);

  const activeCollection = useMemo(() => {
    return (
      collections.find((c) => c.id === selectedCollectionId) ||
      (collections.length > 0 ? collections[0] : null)
    );
  }, [collections, selectedCollectionId]);

  const activeEnvironment = useMemo(() => {
    return (
      environments.find((e) => e.id === selectedEnvironmentId) ||
      (environments.length > 0 ? environments[0] : null)
    );
  }, [environments, selectedEnvironmentId]);

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleStartRun = async () => {
    if (!activeCollection || activeCollection.requests.length === 0) {
      alert('Selected collection has no requests to run.');
      return;
    }

    setIsRunning(true);
    setReport(null);
    setLiveResults([]);
    setProgress({ current: 0, total: activeCollection.requests.length });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const finalReport = await runCollectionBatch({
        collection: activeCollection,
        environment: activeEnvironment,
        globalEnvVars: {},
        delayMs,
        maxLatencyMs,
        stopOnError,
        autoExtractTokens,
        discovery,
        signal: controller.signal,
        onProgress: (index, total, result) => {
          setProgress({ current: index, total });
          setLiveResults((prev) => [...prev, result]);
        },
      });

      setReport(finalReport);
    } catch (err: any) {
      console.error('Collection run error:', err);
    } finally {
      setIsRunning(false);
      abortControllerRef.current = null;
    }
  };

  const handleStopRun = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsRunning(false);
  };

  const handleExportJson = () => {
    if (!report) return;
    const jsonStr = JSON.stringify(report, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `run-report-${activeCollection?.name.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyMarkdown = () => {
    if (!report) return;
    const md = generateRunnerMarkdownSummary(report);
    navigator.clipboard.writeText(md);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  if (!isOpen) return null;

  const currentDisplayResults = report ? report.results : liveResults;
  const filteredResults = currentDisplayResults.filter((r) => {
    if (filterMode === 'passed') return r.passed;
    if (filterMode === 'failed') return !r.passed;
    return true;
  });

  const passedCount = currentDisplayResults.filter((r) => r.passed).length;
  const failedCount = currentDisplayResults.filter((r) => !r.passed).length;
  const progressPercent =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '860px', width: '92vw', maxHeight: '88vh' }}
      >
        {/* Modal Header */}
        <div className="pane-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={15} style={{ color: 'var(--accent)' }} />
            <div>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>
                Collection Runner & Automated Batch Tester
              </span>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Execute collection test suites sequentially with automated
                schema validation and token chaining
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '4px' }}
            onClick={onClose}
            disabled={isRunning}
          >
            <X size={14} />
          </button>
        </div>

        {/* Modal Body */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flex: 1,
          }}
        >
          {/* Top Configuration & Control Bar */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                flexWrap: 'wrap',
              }}
            >
              {/* Collection Dropdown */}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Folder size={13} style={{ color: 'var(--accent)' }} />
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                  }}
                >
                  Collection:
                </span>
                <select
                  className="select-input"
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    minWidth: '150px',
                  }}
                  value={selectedCollectionId}
                  onChange={(e) => setSelectedCollectionId(e.target.value)}
                  disabled={isRunning}
                >
                  {collections.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name} ({col.requests.length} requests)
                    </option>
                  ))}
                </select>
              </div>

              {/* Environment Dropdown */}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Sliders size={13} style={{ color: 'var(--text-muted)' }} />
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                  }}
                >
                  Environment:
                </span>
                <select
                  className="select-input"
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    minWidth: '130px',
                  }}
                  value={selectedEnvironmentId}
                  onChange={(e) => setSelectedEnvironmentId(e.target.value)}
                  disabled={isRunning}
                >
                  <option value="">No Environment</option>
                  {environments.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name} ({env.variables?.length || 0} vars)
                    </option>
                  ))}
                </select>
              </div>

              {/* Delay & Max Latency inputs */}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Clock size={12} style={{ color: 'var(--text-muted)' }} />
                <span
                  style={{ fontSize: '11px', color: 'var(--text-secondary)' }}
                >
                  Delay:
                </span>
                <input
                  type="number"
                  min="0"
                  max="10000"
                  step="50"
                  style={{
                    width: '60px',
                    padding: '3px 6px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-xs)',
                    color: 'var(--text-primary)',
                  }}
                  value={delayMs}
                  onChange={(e) =>
                    setDelayMs(Math.max(0, parseInt(e.target.value, 10) || 0))
                  }
                  disabled={isRunning}
                />
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  ms
                </span>
              </div>

              {/* Action Button: Run / Stop */}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                {isRunning ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{
                      padding: '5px 14px',
                      fontSize: '11px',
                      background: 'rgba(239, 68, 68, 0.15)',
                      color: 'var(--error)',
                      borderColor: 'var(--error)',
                    }}
                    onClick={handleStopRun}
                  >
                    <Square size={12} />
                    <span>Stop Run</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '5px 16px', fontSize: '11px' }}
                    onClick={handleStartRun}
                    disabled={
                      !activeCollection ||
                      activeCollection.requests.length === 0
                    }
                  >
                    <Play size={12} />
                    <span>
                      {report ? 'Re-run Collection' : 'Start Collection Run'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Execution Toggles & Options */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                fontSize: '11px',
                color: 'var(--text-secondary)',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={autoExtractTokens}
                  onChange={(e) => setAutoExtractTokens(e.target.checked)}
                  disabled={isRunning}
                />
                <span>
                  Auto-Extract Auth Tokens & IDs into downstream requests
                </span>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={stopOnError}
                  onChange={(e) => setStopOnError(e.target.checked)}
                  disabled={isRunning}
                />
                <span>Stop run immediately on first failure</span>
              </label>
            </div>
          </div>

          {/* Progress Bar (when running or run complete) */}
          {(isRunning || report) && (
            <div
              style={{
                background: 'var(--bg-tertiary)',
                height: '4px',
                width: '100%',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progressPercent}%`,
                  background:
                    failedCount > 0 ? 'var(--warning)' : 'var(--accent)',
                  transition: 'width 200ms ease-out',
                }}
              />
            </div>
          )}

          {/* Summary Metric Ribbon & Filter Pills */}
          {(isRunning || report || currentDisplayResults.length > 0) && (
            <div
              style={{
                padding: '8px 16px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              {/* Metric Chips */}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span className="metric-chip">
                  <span>Executed:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>
                    {currentDisplayResults.length} /{' '}
                    {activeCollection?.requests.length || 0}
                  </strong>
                </span>

                <span
                  className="metric-chip"
                  style={{
                    color: passedCount > 0 ? 'var(--success)' : 'inherit',
                  }}
                >
                  <CheckCircle2 size={12} />
                  <span>Passed:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>
                    {passedCount}
                  </strong>
                </span>

                <span
                  className="metric-chip"
                  style={{
                    color: failedCount > 0 ? 'var(--error)' : 'inherit',
                  }}
                >
                  <XCircle size={12} />
                  <span>Failed:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>
                    {failedCount}
                  </strong>
                </span>

                {report && (
                  <span className="metric-chip">
                    <Clock size={12} />
                    <span>Avg Latency:</span>
                    <strong style={{ fontFamily: 'var(--font-mono)' }}>
                      {report.avgDurationMs.toFixed(0)} ms
                    </strong>
                  </span>
                )}
              </div>

              {/* Filter Pills */}
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  className={`method-filter-pill ${filterMode === 'all' ? 'active' : ''}`}
                  onClick={() => setFilterMode('all')}
                  style={{ padding: '3px 8px' }}
                >
                  All ({currentDisplayResults.length})
                </button>
                <button
                  type="button"
                  className={`method-filter-pill ${filterMode === 'passed' ? 'active' : ''}`}
                  onClick={() => setFilterMode('passed')}
                  style={{ padding: '3px 8px' }}
                >
                  Passed ({passedCount})
                </button>
                <button
                  type="button"
                  className={`method-filter-pill ${filterMode === 'failed' ? 'active' : ''}`}
                  onClick={() => setFilterMode('failed')}
                  style={{ padding: '3px 8px' }}
                >
                  Failed ({failedCount})
                </button>
              </div>
            </div>
          )}

          {/* Results Stream Area */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px 16px',
              background: 'var(--bg-primary)',
            }}
          >
            {currentDisplayResults.length === 0 ? (
              <div
                className="empty-state"
                style={{ padding: '40px 16px', textAlign: 'center' }}
              >
                <Activity
                  size={24}
                  style={{ margin: '0 auto 10px', opacity: 0.5 }}
                />
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    marginBottom: '4px',
                  }}
                >
                  Ready to Run "{activeCollection?.name || 'Collection'}"
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    maxWidth: '400px',
                    lineHeight: 1.5,
                    marginBottom: '16px',
                  }}
                >
                  Click "Start Collection Run" to execute all{' '}
                  {activeCollection?.requests.length || 0} saved requests in
                  sequence, evaluate schema compliance, and generate a test
                  report.
                </span>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '6px 16px', fontSize: '12px' }}
                  onClick={handleStartRun}
                  disabled={
                    !activeCollection || activeCollection.requests.length === 0
                  }
                >
                  <Play size={13} />
                  <span>Start Test Run</span>
                </button>
              </div>
            ) : (
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
              >
                {filteredResults.map((r, idx) => {
                  const isExpanded =
                    !!expandedItems[r.requestId || String(idx)];
                  return (
                    <div
                      key={r.requestId || idx}
                      style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        overflow: 'hidden',
                        transition: 'border-color var(--transition)',
                      }}
                    >
                      {/* Item Summary Header */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleExpand(r.requestId || String(idx))}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          cursor: 'pointer',
                          userSelect: 'none',
                          gap: '10px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          {r.passed ? (
                            <CheckCircle2
                              size={14}
                              style={{ color: 'var(--success)', flexShrink: 0 }}
                            />
                          ) : (
                            <XCircle
                              size={14}
                              style={{ color: 'var(--error)', flexShrink: 0 }}
                            />
                          )}
                          <span
                            className={`method-badge method-${r.method}`}
                            style={{
                              fontSize: '9px',
                              padding: '1px 5px',
                              minWidth: '38px',
                              textAlign: 'center',
                            }}
                          >
                            {r.method}
                          </span>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              color: 'var(--text-primary)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {r.requestName}
                          </span>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '11px',
                              color: 'var(--text-secondary)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {r.path}
                          </span>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            flexShrink: 0,
                          }}
                        >
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: r.passed
                                ? 'var(--success)'
                                : 'var(--error)',
                            }}
                          >
                            {r.status}
                          </span>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '10px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {r.duration.toFixed(0)} ms
                          </span>
                          {isExpanded ? (
                            <ChevronDown size={12} />
                          ) : (
                            <ChevronRight size={12} />
                          )}
                        </div>
                      </div>

                      {/* Expandable Details: Assertions & Payload Preview */}
                      {isExpanded && (
                        <div
                          style={{
                            padding: '10px 14px',
                            borderTop: '1px solid var(--border)',
                            background: 'var(--bg-primary)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                          }}
                        >
                          {/* Assertion Checklist */}
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                color: 'var(--text-muted)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                              }}
                            >
                              Evaluated Assertions ({r.assertions.length})
                            </span>
                            {r.assertions.map((a, aIdx) => (
                              <div
                                key={aIdx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  fontSize: '11px',
                                  fontFamily: 'var(--font-mono)',
                                  color: a.passed
                                    ? 'var(--text-secondary)'
                                    : 'var(--error)',
                                }}
                              >
                                {a.passed ? (
                                  <Check
                                    size={12}
                                    style={{ color: 'var(--success)' }}
                                  />
                                ) : (
                                  <X
                                    size={12}
                                    style={{ color: 'var(--error)' }}
                                  />
                                )}
                                <span>{a.name}</span>
                                {a.message && (
                                  <span
                                    style={{
                                      fontSize: '10px',
                                      color: 'var(--text-muted)',
                                    }}
                                  >
                                    — {a.message}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Response Payload Preview */}
                          {r.responseBody !== undefined && (
                            <div style={{ marginTop: '6px' }}>
                              <span
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  color: 'var(--text-muted)',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.05em',
                                }}
                              >
                                Response Payload
                              </span>
                              <pre
                                style={{
                                  margin: '4px 0 0 0',
                                  padding: '8px 10px',
                                  background: 'var(--bg-secondary)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 'var(--radius-xs)',
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '11px',
                                  maxHeight: '140px',
                                  overflowY: 'auto',
                                  color: 'var(--text-primary)',
                                  whiteSpace: 'pre-wrap',
                                }}
                              >
                                {typeof r.responseBody === 'object'
                                  ? JSON.stringify(r.responseBody, null, 2)
                                  : String(r.responseBody)}
                              </pre>
                            </div>
                          )}

                          {/* Script Console Logs */}
                          {r.scriptLogs && r.scriptLogs.length > 0 && (
                            <div style={{ marginTop: '6px' }}>
                              <span
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  color: 'var(--text-muted)',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.05em',
                                }}
                              >
                                Script Console Logs ({r.scriptLogs.length})
                              </span>
                              <pre
                                style={{
                                  margin: '4px 0 0 0',
                                  padding: '6px 10px',
                                  background: 'var(--bg-secondary)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 'var(--radius-xs)',
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '10px',
                                  maxHeight: '90px',
                                  overflowY: 'auto',
                                  color: 'var(--accent)',
                                  whiteSpace: 'pre-wrap',
                                }}
                              >
                                {r.scriptLogs.join('\n')}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div
            style={{
              padding: '10px 16px',
              borderTop: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            {report && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '11px' }}
                  onClick={handleExportJson}
                  title="Download test results as JSON"
                >
                  <Download size={12} />
                  <span>Download JSON Report</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '11px' }}
                  onClick={handleCopyMarkdown}
                  title="Copy GitHub-flavored Markdown summary to clipboard"
                >
                  {copiedSummary ? (
                    <Check size={12} style={{ color: 'var(--success)' }} />
                  ) : (
                    <Copy size={12} />
                  )}
                  <span>{copiedSummary ? 'Copied' : 'Copy Markdown'}</span>
                </button>
              </div>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '5px 14px', fontSize: '11px' }}
                onClick={onClose}
                disabled={isRunning}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CollectionRunner;
