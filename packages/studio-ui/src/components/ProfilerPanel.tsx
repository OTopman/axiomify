import React, { useEffect, useState, useRef } from 'react';
import { apiFetch, getToken } from '../utils/api';

interface TimelineItem {
  name: string;
  type: string;
  duration: number;
  before?: any;
  after?: any;
}

interface ProfilerRequest {
  requestId: string;
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    query: Record<string, string>;
    body: any;
    timestamp: string;
  };
  response?: {
    status: number;
    headers: Record<string, string>;
    body: any;
    durationMs: number;
    timestamp: string;
  };
  queries: Array<{
    query: string;
    durationMs: number;
    failed: boolean;
    timestamp: string;
  }>;
  timeline: TimelineItem[];
}

export const ProfilerPanel: React.FC = () => {
  const [sessionData, setSessionData] = useState<any | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string>('');
  const [searchPath, setSearchPath] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'success' | 'error'>(
    'ALL',
  );

  // SVG zoom/pan states
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const isDragging = useRef(false);
  const startDragX = useRef(0);
  const startPanX = useRef(0);

  // Side Drawer details
  const [selectedBlock, setSelectedBlock] = useState<any | null>(null);

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
      }
    } catch (err) {
      console.error('Failed to fetch profile session:', err);
    }
  };

  const handleClearProfiler = async () => {
    if (!confirm('Are you sure you want to clear all execution profiles?'))
      return;
    try {
      const res = await apiFetch('/__studio/api/session', { method: 'DELETE' });
      if (res.ok) {
        setSessionData(null);
        setSelectedRequestId('');
        setSelectedBlock(null);
      }
    } catch (err) {
      console.error('Failed to clear profiler data:', err);
    }
  };

  const entries: ProfilerRequest[] = sessionData?.entries || [];

  // Filtering requests
  const filteredEntries = entries.filter((e) => {
    const matchesPath = e.request.path
      .toLowerCase()
      .includes(searchPath.toLowerCase().trim());
    const matchesMethod =
      methodFilter === 'ALL' || e.request.method === methodFilter;

    let matchesStatus = true;
    if (statusFilter === 'success') {
      matchesStatus =
        !!e.response && e.response.status >= 200 && e.response.status < 400;
    } else if (statusFilter === 'error') {
      matchesStatus = !e.response || e.response.status >= 400;
    }

    return matchesPath && matchesMethod && matchesStatus;
  });

  const selectedRequest =
    entries.find((e) => e.requestId === selectedRequestId) ||
    filteredEntries[0];

  const getStatusColor = (code?: number) => {
    if (!code) return 'var(--text-muted)';
    if (code >= 200 && code < 300) return 'var(--success)';
    if (code >= 300 && code < 400) return 'var(--warning)';
    return 'var(--error)';
  };

  const getStatusStyle = (code: number) => {
    if (code >= 200 && code < 300)
      return { background: 'rgba(0, 210, 160, 0.15)', color: 'var(--success)' };
    if (code >= 300 && code < 400)
      return { background: 'rgba(255, 193, 7, 0.15)', color: 'var(--warning)' };
    return { background: 'rgba(255, 107, 107, 0.15)', color: 'var(--error)' };
  };

  // Drag-to-pan handlers
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    isDragging.current = true;
    startDragX.current = e.clientX;
    startPanX.current = panX;
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging.current) return;
    const deltaX = e.clientX - startDragX.current;
    setPanX(startPanX.current + deltaX);
  };

  const handleMouseUpOrLeave = () => {
    isDragging.current = false;
  };

  // Zoom controls
  const handleZoomIn = () => setZoom((z) => Math.min(z * 1.5, 20));
  const handleZoomOut = () => {
    setZoom((z) => {
      const next = z / 1.5;
      if (next <= 1) {
        setPanX(0); // reset pan if zoom is reset
        return 1;
      }
      return next;
    });
  };
  const handleZoomReset = () => {
    setZoom(1);
    setPanX(0);
  };

  // SVG stacked blocks generation algorithm
  const generateFlameBlocks = (req: ProfilerRequest) => {
    if (!req || !req.timeline) return [];

    const totalDuration = req.response?.durationMs || 1;
    const timeline = req.timeline;

    const sequentialTypes = ['hook', 'middleware', 'handler'];
    const sequentialItems = timeline.filter((item) =>
      sequentialTypes.includes(item.type),
    );

    // Calculate sequential offsets for Track 1 (Level 2)
    let currentOffset = 0;
    const track1Blocks: any[] = [];

    // We keep a mapping to help align nested service calls
    const itemDurationsAndOffsets = new Map<
      TimelineItem,
      { start: number; end: number }
    >();

    for (const item of sequentialItems) {
      const blockStart = currentOffset;
      const blockEnd = currentOffset + item.duration;
      track1Blocks.push({
        item,
        name: item.name,
        type: item.type,
        start: blockStart,
        duration: item.duration,
        level: 1,
      });
      itemDurationsAndOffsets.set(item, { start: blockStart, end: blockEnd });
      currentOffset = blockEnd;
    }

    // Process nested Track 2 (Level 3) service calls
    // Find matching parent sequentially
    const track2Blocks: any[] = [];
    const serviceItems = timeline.filter((item) => item.type === 'service');

    for (const serviceItem of serviceItems) {
      const serviceIdxInTimeline = timeline.indexOf(serviceItem);
      // Find the next sequential block pushed to the timeline (parent step)
      let parentItem: TimelineItem | null = null;
      for (let i = serviceIdxInTimeline + 1; i < timeline.length; i++) {
        if (sequentialTypes.includes(timeline[i].type)) {
          parentItem = timeline[i];
          break;
        }
      }

      if (parentItem && itemDurationsAndOffsets.has(parentItem)) {
        const parentMeta = itemDurationsAndOffsets.get(parentItem)!;
        // Place service nested inside the parent block
        // Since we don't have absolute start, sequence nested services within parent span
        const otherServicesInParent = serviceItems.filter((s) => {
          const sIdx = timeline.indexOf(s);
          for (let i = sIdx + 1; i < timeline.length; i++) {
            if (sequentialTypes.includes(timeline[i].type)) {
              return timeline[i] === parentItem;
            }
          }
          return false;
        });

        const serviceIdxInParent = otherServicesInParent.indexOf(serviceItem);
        let nestedOffset = parentMeta.start + 0.1; // pad slightly
        for (let j = 0; j < serviceIdxInParent; j++) {
          nestedOffset += otherServicesInParent[j].duration + 0.1;
        }

        // Cap inside parent boundaries
        const finalDuration = Math.min(
          serviceItem.duration,
          Math.max(0, parentMeta.end - nestedOffset - 0.1),
        );

        track2Blocks.push({
          item: serviceItem,
          name: serviceItem.name,
          type: 'service',
          start: nestedOffset,
          duration: finalDuration,
          level: 2,
        });
      } else {
        // Fallback: place sequentially on level 2
        track2Blocks.push({
          item: serviceItem,
          name: serviceItem.name,
          type: 'service',
          start: 0,
          duration: serviceItem.duration,
          level: 2,
        });
      }
    }

    // Level 0: Root Request Block
    const rootBlock = {
      name: `${req.request.method} ${req.request.path}`,
      type: 'request',
      start: 0,
      duration: totalDuration,
      level: 0,
      item: {
        name: `${req.request.method} ${req.request.path}`,
        type: 'request',
        duration: totalDuration,
      },
    };

    return [rootBlock, ...track1Blocks, ...track2Blocks];
  };

  const getBlockColor = (type: string) => {
    switch (type.toLowerCase()) {
      case 'request':
        return {
          fill: 'var(--bg-tertiary)',
          stroke: 'var(--border)',
          text: 'var(--text-primary)',
        };
      case 'hook':
        return {
          fill: 'rgba(108, 92, 231, 0.85)',
          stroke: 'rgb(108, 92, 231)',
          text: '#fff',
        };
      case 'middleware':
        return {
          fill: 'rgba(255, 159, 67, 0.85)',
          stroke: 'rgb(255, 159, 67)',
          text: '#fff',
        };
      case 'handler':
        return {
          fill: 'rgba(0, 210, 160, 0.85)',
          stroke: 'rgb(0, 210, 160)',
          text: '#fff',
        };
      case 'service':
        return {
          fill: 'rgba(0, 168, 204, 0.85)',
          stroke: 'rgb(0, 168, 204)',
          text: '#fff',
        };
      default:
        return {
          fill: 'var(--bg-tertiary)',
          stroke: 'var(--border)',
          text: 'var(--text-primary)',
        };
    }
  };

  // JSON helper for collapsible objects
  const renderJsonView = (obj: any) => {
    if (!obj || Object.keys(obj).length === 0)
      return (
        <div
          style={{
            color: 'var(--text-muted)',
            fontStyle: 'italic',
            fontSize: '11px',
          }}
        >
          Empty
        </div>
      );
    return (
      <pre
        style={{
          margin: 0,
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          whiteSpace: 'pre-wrap',
          maxHeight: '180px',
          overflowY: 'auto',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          padding: '8px',
          borderRadius: '4px',
        }}
      >
        {JSON.stringify(obj, null, 2)}
      </pre>
    );
  };

  return (
    <div>
      <div
        className="panel-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <div className="panel-title">Execution Profiler</div>
          <div className="panel-subtitle">
            Analyze live request processing hook paths, middleware timing, state
            mutations, and DB latencies
          </div>
        </div>
        <button
          className="btn btn-secondary"
          onClick={handleClearProfiler}
          disabled={!sessionData}
        >
          Clear Profiler
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔥</div>
          <div className="empty-state-message">
            No execution traces captured. Hit the server with requests to
            populate the profiler.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '360px 1fr',
            gap: '24px',
            minHeight: '650px',
            height: 'auto',
            textAlign: 'left',
          }}
        >
          {/* Left Panel: Request list */}
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <input
              className="search-input"
              type="text"
              placeholder="Search request path..."
              value={searchPath}
              onChange={(e) => setSearchPath(e.target.value)}
              style={{
                width: '100%',
                margin: 0,
                padding: '6px 10px',
                fontSize: '12px',
                height: '32px',
              }}
            />

            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {(['ALL', 'GET', 'POST', 'PUT', 'DELETE'] as const).map((m) => (
                <button
                  key={m}
                  className={`filter-pill ${methodFilter === m ? 'active' : ''}`}
                  style={{
                    fontSize: '9px',
                    padding: '3px 8px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setMethodFilter(m)}
                >
                  {m}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              {(['ALL', 'success', 'error'] as const).map((s) => (
                <button
                  key={s}
                  className={`filter-pill ${statusFilter === s ? 'active' : ''}`}
                  style={{
                    fontSize: '9px',
                    padding: '3px 8px',
                    cursor: 'pointer',
                    flex: 1,
                    textTransform: 'capitalize',
                  }}
                  onClick={() => setStatusFilter(s)}
                >
                  {s}
                </button>
              ))}
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                maxHeight: '550px',
              }}
            >
              {filteredEntries.length === 0 ? (
                <div
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '11px',
                    textAlign: 'center',
                    padding: '12px',
                  }}
                >
                  No matching requests.
                </div>
              ) : (
                filteredEntries.map((e) => {
                  const isSelected =
                    selectedRequest &&
                    e.requestId === selectedRequest.requestId;
                  const status = e.response?.status || 0;
                  const duration = e.response?.durationMs || 0;
                  return (
                    <div
                      key={e.requestId}
                      style={{
                        background: isSelected
                          ? 'var(--bg-tertiary)'
                          : 'var(--bg-primary)',
                        border: isSelected
                          ? '1px solid var(--accent)'
                          : '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onClick={() => {
                        setSelectedRequestId(e.requestId);
                        setSelectedBlock(null);
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
                          className={`method-badge method-${e.request.method}`}
                          style={{ fontSize: '9px', padding: '1px 5px' }}
                        >
                          {e.request.method}
                        </span>
                        <div
                          style={{
                            display: 'flex',
                            gap: '6px',
                            alignItems: 'center',
                          }}
                        >
                          {status > 0 && (
                            <span
                              style={{
                                fontSize: '9px',
                                fontWeight: 700,
                                padding: '1px 5px',
                                borderRadius: '3px',
                                ...getStatusStyle(status),
                              }}
                            >
                              {status}
                            </span>
                          )}
                          <span
                            style={{
                              fontSize: '10px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {duration.toFixed(1)}ms
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          wordBreak: 'break-all',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {e.request.path}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '9px',
                          color: 'var(--text-muted)',
                          marginTop: '6px',
                        }}
                      >
                        <span>ID: {e.requestId.slice(0, 8)}</span>
                        <span>
                          {new Date(e.request.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Panel: Flame Chart details */}
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
          >
            {selectedRequest ? (
              <>
                {/* SVG Stacked Flame Chart card */}
                <div
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Request execution trace timeline
                    </div>
                    {/* Zoom controls */}
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        className="btn btn-secondary"
                        onClick={handleZoomOut}
                        style={{
                          padding: '3px 8px',
                          fontSize: '12px',
                          margin: 0,
                        }}
                      >
                        Zoom -
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={handleZoomIn}
                        style={{
                          padding: '3px 8px',
                          fontSize: '12px',
                          margin: 0,
                        }}
                      >
                        Zoom +
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={handleZoomReset}
                        style={{
                          padding: '3px 8px',
                          fontSize: '12px',
                          margin: 0,
                        }}
                      >
                        Reset ↺
                      </button>
                    </div>
                  </div>

                  {/* SVG interactive renderer */}
                  <div
                    style={{
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      overflow: 'hidden',
                      cursor: isDragging.current ? 'grabbing' : 'grab',
                      userSelect: 'none',
                    }}
                  >
                    <svg
                      width="100%"
                      height="200"
                      viewBox="0 0 1000 200"
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUpOrLeave}
                      onMouseLeave={handleMouseUpOrLeave}
                      style={{ outline: 'none' }}
                    >
                      <g transform={`translate(${panX}, 0) scale(${zoom}, 1)`}>
                        {generateFlameBlocks(selectedRequest).map(
                          (block, idx) => {
                            const totalDuration =
                              selectedRequest.response?.durationMs || 1;
                            const widthPercent =
                              (block.duration / totalDuration) * 980;
                            const xOffset =
                              10 + (block.start / totalDuration) * 980;
                            const yOffset = 10 + block.level * 50;
                            const height = 40;
                            const radius = 4;

                            const color = getBlockColor(block.type);
                            const isSelected =
                              selectedBlock &&
                              selectedBlock.name === block.name &&
                              selectedBlock.type === block.type;

                            // Hide text if width is too small to avoid overlapping
                            const showText = widthPercent * zoom > 40;

                            return (
                              <g
                                key={idx}
                                onClick={() => setSelectedBlock(block)}
                                style={{ cursor: 'pointer' }}
                              >
                                <rect
                                  x={xOffset}
                                  y={yOffset}
                                  width={Math.max(widthPercent, 1.5)} // at least 1.5px to remain clickable
                                  height={height}
                                  rx={radius}
                                  ry={radius}
                                  fill={
                                    isSelected ? 'var(--accent)' : color.fill
                                  }
                                  stroke={isSelected ? '#fff' : color.stroke}
                                  strokeWidth={isSelected ? 2 : 1}
                                  style={{
                                    transition: 'fill 0.15s, stroke 0.15s',
                                  }}
                                />
                                {showText && (
                                  <text
                                    x={xOffset + widthPercent / 2}
                                    y={yOffset + 24}
                                    textAnchor="middle"
                                    fill={isSelected ? '#fff' : color.text}
                                    fontSize="10"
                                    fontWeight="bold"
                                    fontFamily="var(--font-mono)"
                                    style={{
                                      pointerEvents: 'none',
                                      userSelect: 'none',
                                    }}
                                  >
                                    {block.name.length >
                                    (widthPercent * zoom) / 5
                                      ? block.name.slice(
                                          0,
                                          Math.floor((widthPercent * zoom) / 5),
                                        ) + '..'
                                      : block.name}
                                  </text>
                                )}
                                {/* Simple standard hover tooltip */}
                                <title>
                                  {block.name}\nDuration:{' '}
                                  {block.duration.toFixed(2)} ms (
                                  {(
                                    (block.duration / totalDuration) *
                                    100
                                  ).toFixed(1)}
                                  %)
                                </title>
                              </g>
                            );
                          },
                        )}
                      </g>
                    </svg>
                  </div>

                  {/* Legend indicator */}
                  <div
                    style={{
                      display: 'flex',
                      gap: '16px',
                      fontSize: '11px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <div
                        style={{
                          width: '12px',
                          height: '12px',
                          background: 'var(--bg-tertiary)',
                          borderRadius: '2px',
                          border: '1px solid var(--border)',
                        }}
                      />
                      <span>Request</span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <div
                        style={{
                          width: '12px',
                          height: '12px',
                          background: 'rgba(108, 92, 231, 0.85)',
                          borderRadius: '2px',
                        }}
                      />
                      <span>Hook</span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <div
                        style={{
                          width: '12px',
                          height: '12px',
                          background: 'rgba(255, 159, 67, 0.85)',
                          borderRadius: '2px',
                        }}
                      />
                      <span>Middleware</span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <div
                        style={{
                          width: '12px',
                          height: '12px',
                          background: 'rgba(0, 210, 160, 0.85)',
                          borderRadius: '2px',
                        }}
                      />
                      <span>Handler</span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <div
                        style={{
                          width: '12px',
                          height: '12px',
                          background: 'rgba(0, 168, 204, 0.85)',
                          borderRadius: '2px',
                        }}
                      />
                      <span>Service / Query</span>
                    </div>
                  </div>
                </div>

                {/* Database logs matching trace timeline */}
                <div
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '24px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                      marginBottom: '14px',
                    }}
                  >
                    Trace database query logs (
                    {selectedRequest.queries?.length || 0})
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      overflowY: 'auto',
                      maxHeight: '200px',
                    }}
                  >
                    {!selectedRequest.queries ||
                    selectedRequest.queries.length === 0 ? (
                      <div
                        style={{
                          fontStyle: 'italic',
                          color: 'var(--text-muted)',
                          fontSize: '11px',
                          textAlign: 'center',
                          padding: '12px',
                        }}
                      >
                        No queries captured during this execution.
                      </div>
                    ) : (
                      selectedRequest.queries.map((q, idx) => (
                        <div
                          key={idx}
                          style={{
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '10px 14px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              fontSize: '9px',
                              color: 'var(--text-muted)',
                              marginBottom: '4px',
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 700,
                                color: q.failed
                                  ? 'var(--error)'
                                  : 'var(--success)',
                              }}
                            >
                              {q.failed ? '❌ FAILED' : '✅ SUCCESS'}
                            </span>
                            <span>{q.durationMs.toFixed(2)} ms</span>
                          </div>
                          <pre
                            style={{
                              margin: 0,
                              fontSize: '11px',
                              fontFamily: 'var(--font-mono)',
                              whiteSpace: 'pre-wrap',
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
              </>
            ) : (
              <div
                style={{
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                  padding: '40px',
                }}
              >
                Select a request.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Slide-out Side Drawer overlay for block click */}
      {selectedBlock && (
        <div
          style={{
            position: 'fixed',
            right: 0,
            top: 0,
            bottom: 0,
            width: '420px',
            background: 'var(--bg-secondary)',
            borderLeft: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideIn 0.2s ease-out',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 20px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-primary)',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  color: 'var(--accent)',
                  textTransform: 'uppercase',
                }}
              >
                {selectedBlock.type} details
              </div>
              <h3
                style={{
                  margin: 0,
                  fontSize: '14px',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  wordBreak: 'break-all',
                }}
              >
                {selectedBlock.name}
              </h3>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => setSelectedBlock(null)}
              style={{ padding: '4px 8px', fontSize: '11px', margin: 0 }}
            >
              Close
            </button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                background: 'var(--bg-primary)',
                padding: '12px',
                borderRadius: '4px',
                border: '1px solid var(--border)',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '9px',
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                  }}
                >
                  Duration
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: 'var(--success)',
                    marginTop: '2px',
                  }}
                >
                  {selectedBlock.duration.toFixed(2)} ms
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: '9px',
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                  }}
                >
                  % of Request
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: 'var(--info)',
                    marginTop: '2px',
                  }}
                >
                  {selectedRequest?.response?.durationMs
                    ? (
                        (selectedBlock.duration /
                          selectedRequest.response.durationMs) *
                        100
                      ).toFixed(1) + '%'
                    : '—'}
                </div>
              </div>
            </div>

            {/* If block contains before / after state snapshots */}
            {selectedBlock.item?.before ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      marginBottom: '4px',
                    }}
                  >
                    Request Body (Before)
                  </div>
                  {renderJsonView(selectedBlock.item.before.body)}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      marginBottom: '4px',
                    }}
                  >
                    Request Body (After)
                  </div>
                  {renderJsonView(selectedBlock.item.after.body)}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      marginBottom: '4px',
                    }}
                  >
                    Route State (Before)
                  </div>
                  {renderJsonView(selectedBlock.item.before.state)}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      marginBottom: '4px',
                    }}
                  >
                    Route State (After)
                  </div>
                  {renderJsonView(selectedBlock.item.after.state)}
                </div>
              </div>
            ) : (
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  fontStyle: 'italic',
                  textAlign: 'center',
                  padding: '16px',
                  border: '1px dashed var(--border)',
                  borderRadius: '4px',
                }}
              >
                No payload state modifications captured for this phase type.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
