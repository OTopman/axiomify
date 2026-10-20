import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  CircleDot,
  Copy,
  Play,
  Radio,
  Search,
  Send,
  Square,
  Trash2,
  Wifi,
  WifiOff,
  Zap
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { AssertionRule, DiscoveryData, WsLogItem } from '../types';
import { apiFetch } from '../utils/api';

interface WebSocketTesterProps {
  discovery: DiscoveryData;
  prefilledPath?: string;
  onClearPrefill?: () => void;
}

interface WsRoute {
  path: string;
  schema?: {
    message?: any;
    [key: string]: any;
  };
}

interface RecordedMessage {
  type: 'sent' | 'received';
  delay: number;
  content: string;
  event?: string | null;
  payload?: any;
}

export const WebSocketTester: React.FC<WebSocketTesterProps> = ({
  discovery,
  prefilledPath = '',
  onClearPrefill,
}) => {
  const [wsRoutes, setWsRoutes] = useState<WsRoute[]>([]);
  const [appBaseUrl, setAppBaseUrl] = useState('http://localhost:3000');
  const [selectedRoutePath, setSelectedRoutePath] = useState('');
  const [protocol, setProtocol] = useState<'ws' | 'socketio'>('ws');
  const [connStatus, setConnStatus] = useState<
    'disconnected' | 'connecting' | 'connected' | 'error'
  >('disconnected');
  const [logs, setLogs] = useState<WsLogItem[]>([]);
  const [frameFilter, setFrameFilter] = useState<'all' | 'in' | 'out' | 'assertion'>('all');
  const [searchWsQuery, setSearchWsQuery] = useState('');
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [mobileWsPane, setMobileWsPane] = useState<'routes' | 'composer' | 'traffic'>('composer');

  // Message Sending
  const [eventName, setEventName] = useState('message');
  const [messagePayload, setMessagePayload] = useState('');

  // Socket Rooms
  const [roomName, setRoomName] = useState('');

  // Assertion Rules
  const [rules, setRules] = useState<AssertionRule[]>([]);

  // Session Recording
  const [recording, setRecording] = useState(false);
  const [recordedMessages, setRecordedMessages] = useState<RecordedMessage[]>(
    [],
  );
  const recordStartTimeRef = useRef<number>(0);

  const [selectedFrame, setSelectedFrame] = useState<WsLogItem | null>(null);

  const clientRef = useRef<any>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop =
        logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Load WS routes
  useEffect(() => {
    fetchWsRoutes();
  }, []);

  // Pre-fill path from navigation click
  useEffect(() => {
    if (prefilledPath && wsRoutes.length > 0) {
      setSelectedRoutePath(prefilledPath);
      handleRouteSelect(prefilledPath);
      if (onClearPrefill) onClearPrefill();
    }
  }, [prefilledPath, wsRoutes]);

  const fetchWsRoutes = async () => {
    try {
      const res = await apiFetch('/__studio/api/ws/routes');
      if (res.ok) {
        const data = await res.json();
        setAppBaseUrl(data.appBaseUrl || 'http://localhost:3000');
        setWsRoutes(data.routes || []);
      }
    } catch (err) {
      console.error('Failed to load WS routes:', err);
    }
  };

  const handleRouteSelect = (pathVal: string) => {
    setSelectedRoutePath(pathVal);
    setMobileWsPane('composer');
    const route = wsRoutes.find((r) => r.path === pathVal);
    if (!route) return;

    // Auto-detect protocol using parsed/normalized path (avoid raw URL substring matching)
    let normalizedPath = pathVal;
    try {
      if (/^https?:\/\//i.test(pathVal)) {
        normalizedPath = new URL(pathVal).pathname;
      }
    } catch {
      normalizedPath = pathVal;
    }
    const lowerPath = normalizedPath.toLowerCase();
    const isSocketIoPath =
      lowerPath.startsWith('/socket.io') ||
      lowerPath.includes('/socket.io/') ||
      lowerPath === '/socket.io';
    const isSocketPath =
      lowerPath === '/socket' ||
      lowerPath.startsWith('/socket/') ||
      lowerPath.includes('/socket/');
    const autoProtocol = isSocketIoPath || isSocketPath ? 'socketio' : 'ws';
    setProtocol(autoProtocol);

    // Pre-fill payload placeholder
    if (route.schema && route.schema.message) {
      setMessagePayload(JSON.stringify(route.schema.message, null, 2));
    } else {
      setMessagePayload('{\n  "event": "message",\n  "data": {}\n}');
    }
  };

  const appendWsLog = (
    type: 'sent' | 'received' | 'info' | 'error',
    content: string,
  ) => {
    const timeStr = new Date().toLocaleTimeString();

    // If recording is active, capture sent/received frames
    if (recording && (type === 'sent' || type === 'received')) {
      const delay = Date.now() - recordStartTimeRef.current;
      let ev: string | null = null;
      let pay: any = null;

      if (content.startsWith('Event: ')) {
        const parts = content.split(' | Payload: ');
        ev = parts[0].substring(7);
        try {
          pay = JSON.parse(parts[1]);
        } catch {
          pay = parts[1];
        }
      }

      setRecordedMessages((prev) => [
        ...prev,
        {
          type,
          delay,
          content,
          event: ev,
          payload: pay,
        },
      ]);
    }

    setLogs((prev) => [
      ...prev,
      {
        type,
        time: timeStr,
        payload: content,
      },
    ]);
  };

  const disconnectWs = () => {
    if (clientRef.current) {
      if (typeof clientRef.current.close === 'function') {
        clientRef.current.close();
      } else if (typeof clientRef.current.disconnect === 'function') {
        clientRef.current.disconnect();
      }
      clientRef.current = null;
    }
    setConnStatus('disconnected');
  };

  const connectWs = () => {
    if (!selectedRoutePath) {
      alert('Please select a WebSocket route first');
      return;
    }

    disconnectWs();
    setConnStatus('connecting');
    appendWsLog(
      'info',
      `Connecting to ${selectedRoutePath} using ${protocol === 'socketio' ? 'Socket.IO' : 'Raw WebSocket'}...`,
    );

    try {
      if (protocol === 'socketio') {
        const socket = io(appBaseUrl, {
          path: selectedRoutePath,
          transports: ['websocket'],
          forceNew: true,
        });

        clientRef.current = socket;

        socket.on('connect', () => {
          setConnStatus('connected');
          appendWsLog('info', `Socket.IO Connected (ID: ${socket.id})`);
        });

        socket.on('connect_error', (err) => {
          setConnStatus('error');
          appendWsLog('error', `Connection error: ${String(err)}`);
        });

        socket.on('disconnect', (reason) => {
          setConnStatus('disconnected');
          appendWsLog('info', `Socket.IO Disconnected. Reason: ${reason}`);
        });

        socket.onAny((event, ...args) => {
          const contentStr = `Event: ${event} | Payload: ${JSON.stringify(args)}`;
          appendWsLog('received', contentStr);
          checkWsAssertions(event, JSON.stringify(args));
        });
      } else {
        const urlObj = new URL(appBaseUrl);
        const wsProto = urlObj.protocol === 'https:' ? 'wss://' : 'ws://';
        const wsUrl = `${wsProto}${urlObj.host}${selectedRoutePath}`;

        const socket = new WebSocket(wsUrl);
        clientRef.current = socket;

        socket.onopen = () => {
          setConnStatus('connected');
          appendWsLog('info', 'WebSocket Connection Established');
        };

        socket.onerror = () => {
          setConnStatus('error');
          appendWsLog('error', 'WebSocket error event received');
        };

        socket.onclose = (e) => {
          setConnStatus('disconnected');
          appendWsLog(
            'info',
            `WebSocket Closed (Code: ${e.code}, Reason: ${e.reason || 'none'})`,
          );
        };

        socket.onmessage = (e) => {
          appendWsLog('received', String(e.data));
          let eventNameMatch: string | null = null;
          try {
            const parsed = JSON.parse(e.data);
            eventNameMatch =
              parsed.event || parsed.type || parsed.action || null;
          } catch { }
          checkWsAssertions(eventNameMatch, String(e.data));
        };
      }
    } catch (err: any) {
      setConnStatus('error');
      appendWsLog('error', `Failed to connect: ${String(err)}`);
    }
  };

  const handleSendMessage = () => {
    if (!clientRef.current) return;
    const isConnected =
      protocol === 'socketio'
        ? clientRef.current.connected
        : clientRef.current.readyState === WebSocket.OPEN;

    if (!isConnected) {
      alert('WebSocket is not connected');
      return;
    }

    let payloadObj: any = messagePayload.trim();
    if (payloadObj.startsWith('{') || payloadObj.startsWith('[')) {
      try {
        payloadObj = JSON.parse(payloadObj);
      } catch (err: any) {
        alert('Invalid JSON payload: ' + err.message);
        return;
      }
    }

    if (protocol === 'socketio') {
      clientRef.current.emit(eventName, payloadObj);
      appendWsLog(
        'sent',
        `Event: ${eventName} | Payload: ${JSON.stringify(payloadObj)}`,
      );
    } else {
      const msgStr =
        typeof payloadObj === 'object'
          ? JSON.stringify(payloadObj)
          : String(payloadObj);
      clientRef.current.send(msgStr);
      appendWsLog('sent', msgStr);
    }
  };

  const handleJoinRoom = () => {
    if (!roomName.trim() || !clientRef.current || protocol !== 'socketio')
      return;
    clientRef.current.emit('join', roomName.trim());
    appendWsLog('sent', `Emitted "join" to room: ${roomName.trim()}`);
  };

  const handleLeaveRoom = () => {
    if (!roomName.trim() || !clientRef.current || protocol !== 'socketio')
      return;
    clientRef.current.emit('leave', roomName.trim());
    appendWsLog('sent', `Emitted "leave" to room: ${roomName.trim()}`);
  };

  // Recording
  const toggleRecording = () => {
    if (!recording) {
      setRecording(true);
      setRecordedMessages([]);
      recordStartTimeRef.current = Date.now();
      appendWsLog(
        'info',
        '[RECORD] Recording session started. Outbound and inbound messages will be captured.',
      );
    } else {
      setRecording(false);
      appendWsLog(
        'info',
        `[RECORD] Recording stopped. ${recordedMessages.length} messages saved.`,
      );
    }
  };

  const handleReplaySession = async () => {
    if (recordedMessages.length === 0) return;

    appendWsLog(
      'info',
      '[REPLAY] Starting auto-replay of recorded session...',
    );
    appendWsLog('info', '[REPLAY] Reconnecting WebSocket...');
    disconnectWs();
    connectWs();

    // Wait for connection
    let retries = 50;
    let connected = false;
    while (retries > 0) {
      if (clientRef.current) {
        const open =
          protocol === 'socketio'
            ? clientRef.current.connected
            : clientRef.current.readyState === WebSocket.OPEN;
        if (open) {
          connected = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 100));
      retries--;
    }

    if (!connected || !clientRef.current) {
      appendWsLog('error', '[REPLAY] Failed to connect for replay.');
      return;
    }

    appendWsLog(
      'info',
      '[REPLAY] WebSocket connected. Sending outbound events with delays...',
    );

    const outbounds = recordedMessages.filter((m) => m.type === 'sent');
    for (const msg of outbounds) {
      await new Promise((r) => setTimeout(r, msg.delay));
      appendWsLog(
        'info',
        `[REPLAY] Replaying outbound message after ${msg.delay}ms`,
      );

      if (protocol === 'socketio') {
        if (msg.event) {
          clientRef.current.emit(msg.event, msg.payload);
          appendWsLog(
            'sent',
            `Event: ${msg.event} | Payload: ${JSON.stringify(msg.payload)}`,
          );
        } else {
          clientRef.current.send(msg.content);
          appendWsLog('sent', msg.content);
        }
      } else {
        clientRef.current.send(msg.content);
        appendWsLog('sent', msg.content);
      }
    }

    appendWsLog('info', '[REPLAY] Completed sending all outbound messages.');
  };

  // Assertions
  const addAssertionRule = () => {
    const newRule: AssertionRule = {
      id: 'rule-' + Date.now(),
      type: 'contains',
      target: 'event',
      value: '',
    };
    setRules((prev) => [...prev, newRule]);
  };

  const removeAssertionRule = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const updateAssertionRule = (
    id: string,
    field: keyof AssertionRule,
    value: string,
  ) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );
  };

  const partialDeepMatch = (actual: any, expected: any): boolean => {
    if (actual === expected) return true;
    if (typeof expected !== 'object' || expected === null) return false;
    if (typeof actual !== 'object' || actual === null) return false;

    for (const key of Object.keys(expected)) {
      if (!(key in actual)) return false;
      if (!partialDeepMatch(actual[key], expected[key])) return false;
    }
    return true;
  };

  const checkWsAssertions = (
    eventNameMatch: string | null,
    messageContent: string,
  ) => {
    if (rules.length === 0) return;

    appendWsLog('info', '[ASSERTION] Checking assertions for message...');

    let parsedPayload: any = null;
    try {
      parsedPayload = JSON.parse(messageContent);
    } catch { }

    rules.forEach((rule) => {
      if (!rule.value.trim()) return;

      let matched = false;
      const targetVal =
        rule.target === 'event'
          ? eventNameMatch || messageContent
          : messageContent;

      if (rule.type === 'equals') {
        matched = targetVal === rule.value;
      } else if (rule.type === 'contains') {
        matched = targetVal.includes(rule.value);
      } else if (rule.type === 'regex') {
        try {
          const reg = new RegExp(rule.value);
          matched = reg.test(targetVal);
        } catch { }
      }

      // If target is payload and is valid JSON, we can do deep subset match as fallback
      if (
        rule.target === 'payload' &&
        parsedPayload &&
        rule.type === 'contains'
      ) {
        try {
          const expected = JSON.parse(rule.value);
          matched = partialDeepMatch(parsedPayload, expected);
        } catch {
          matched = messageContent.includes(rule.value);
        }
      }

      if (matched) {
        appendWsLog(
          'info',
          `[ASSERTION PASSED] Matches rule: Target: ${rule.target} | Match: ${rule.type} | Value: "${rule.value}"`,
        );
      } else {
        appendWsLog(
          'error',
          `[ASSERTION FAILED] Target: ${rule.target} | Expected Match: "${rule.value}" | Actual: ${targetVal}`,
        );
      }
    });
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const getStatusBadgeClass = () => {
    if (connStatus === 'connected') return 'ws-badge connected';
    if (connStatus === 'connecting') return 'ws-badge connecting';
    return 'ws-badge disconnected';
  };

  return (
    <div className={`ws-tester-layout mobile-pane-${mobileWsPane}`}>
      {/* Mobile Top Segmented Switcher (Routes | Composer | Traffic) */}
      <div className="mobile-ws-nav">
        <button
          type="button"
          className={`mobile-ws-nav-btn ${mobileWsPane === 'routes' ? 'active' : ''}`}
          onClick={() => setMobileWsPane('routes')}
        >
          <Radio size={13} />
          <span>Routes</span>
          <span className="mobile-tester-badge">{wsRoutes.length}</span>
        </button>
        <button
          type="button"
          className={`mobile-ws-nav-btn ${mobileWsPane === 'composer' ? 'active' : ''}`}
          onClick={() => setMobileWsPane('composer')}
        >
          <Zap size={13} />
          <span>Composer</span>
          <span
            className="status-dot"
            style={{
              width: '6px',
              height: '6px',
              background:
                connStatus === 'connected'
                  ? 'var(--success)'
                  : connStatus === 'connecting'
                    ? 'var(--warning)'
                    : 'var(--text-muted)',
            }}
          />
        </button>
        <button
          type="button"
          className={`mobile-ws-nav-btn ${mobileWsPane === 'traffic' ? 'active' : ''}`}
          onClick={() => setMobileWsPane('traffic')}
        >
          <Activity size={13} />
          <span>Traffic</span>
          {logs.length > 0 && (
            <span className="mobile-tester-badge">{logs.length}</span>
          )}
        </button>
      </div>

      {/* ── Pane 1: Left Sub-Sidebar (WS Routes, Rooms, Rules, Recorder) ── */}
      <aside className="ws-sidebar">
        {/* Section: Discovered WebSocket Routes */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Radio size={13} style={{ color: 'var(--accent)' }} /> WS Routes
            </span>
            <span className="route-count-badge">{wsRoutes.length}</span>
          </div>

          {wsRoutes.length > 3 && (
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="filter-search-input"
                placeholder="Filter routes..."
                style={{ paddingLeft: '26px', fontSize: '11px', height: '28px' }}
                value={searchWsQuery}
                onChange={(e) => setSearchWsQuery(e.target.value)}
              />
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {wsRoutes.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', fontStyle: 'italic' }}>
              No WebSocket routes detected. Connect to custom URL or define a WS handler.
            </div>
          ) : (
            wsRoutes
              .filter((r) => !searchWsQuery || r.path.toLowerCase().includes(searchWsQuery.toLowerCase()))
              .map((r) => {
                const isActive = selectedRoutePath === r.path;
                return (
                  <button
                    key={r.path}
                    className={`ws-route-card ${isActive ? 'active' : ''}`}
                    onClick={() => handleRouteSelect(r.path)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, overflow: 'hidden' }}>
                      <span className="method-badge method-WS" style={{ fontSize: '9px', padding: '1px 5px' }}>WS</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={r.path}>
                        {r.path}
                      </span>
                    </div>
                    {isActive && <ChevronRight size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                  </button>
                );
              })
          )}

          {/* Custom Route Input if user wants manual path */}
          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
            <label className="form-label" style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Custom Path</label>
            <input
              type="text"
              className="text-input"
              style={{ fontSize: '11px', padding: '5px 8px', fontFamily: 'var(--font-mono)' }}
              placeholder="/ws/custom"
              value={selectedRoutePath}
              onChange={(e) => handleRouteSelect(e.target.value)}
            />
          </div>

          {/* Socket.IO Rooms (Conditional) */}
          {protocol === 'socketio' && (
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Socket.IO Rooms
              </div>
              <input
                className="text-input"
                type="text"
                placeholder="Room identifier"
                style={{ fontSize: '11px', padding: '5px 8px', marginBottom: '6px' }}
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1, padding: '4px 6px', fontSize: '10px', margin: 0 }}
                  onClick={handleJoinRoom}
                  disabled={connStatus !== 'connected'}
                >
                  Join
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1, padding: '4px 6px', fontSize: '10px', margin: 0 }}
                  onClick={handleLeaveRoom}
                  disabled={connStatus !== 'connected'}
                >
                  Leave
                </button>
              </div>
            </div>
          )}

          {/* Assertion Rules Box */}
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <CheckSquare size={12} /> Assertions ({rules.length})
              </span>
              <button
                className="btn btn-secondary"
                style={{ padding: '2px 6px', fontSize: '10px', margin: 0 }}
                onClick={addAssertionRule}
              >
                + Add
              </button>
            </div>
            {rules.length === 0 ? (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                No active assertions.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {rules.map((rule, idx) => (
                  <div
                    key={rule.id}
                    style={{
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '6px 8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      fontSize: '11px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: '10px' }}>#{idx + 1}</span>
                      <button
                        onClick={() => removeAssertionRule(rule.id)}
                        style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer', padding: '0 2px' }}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <select
                        className="select-input"
                        style={{ fontSize: '10px', padding: '2px 4px', height: '24px', flex: 1 }}
                        value={rule.target}
                        onChange={(e) => updateAssertionRule(rule.id, 'target', e.target.value)}
                      >
                        <option value="event">Event</option>
                        <option value="payload">Payload</option>
                      </select>
                      <select
                        className="select-input"
                        style={{ fontSize: '10px', padding: '2px 4px', height: '24px', flex: 1 }}
                        value={rule.type}
                        onChange={(e) => updateAssertionRule(rule.id, 'type', e.target.value)}
                      >
                        <option value="contains">contains</option>
                        <option value="equals">equals</option>
                        <option value="regex">regex</option>
                      </select>
                    </div>
                    <input
                      className="text-input"
                      type="text"
                      placeholder="Expected string"
                      style={{ fontSize: '10px', padding: '3px 6px', height: '24px' }}
                      value={rule.value}
                      onChange={(e) => updateAssertionRule(rule.id, 'value', e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Traffic Recording */}
          <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Traffic Recording
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button
                className="btn"
                style={{
                  background: recording ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.05)',
                  color: 'var(--error)',
                  borderColor: recording ? 'var(--error)' : 'rgba(239, 68, 68, 0.25)',
                  padding: '6px 10px',
                  fontSize: '11px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  margin: 0,
                }}
                onClick={toggleRecording}
              >
                {recording ? (
                  <>
                    <Square size={12} /> Stop ({recordedMessages.length})
                  </>
                ) : (
                  <>
                    <CircleDot size={12} /> Record Frames
                  </>
                )}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleReplaySession}
                disabled={recordedMessages.length === 0 || recording}
                style={{ padding: '6px 10px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', margin: 0 }}
              >
                <Play size={12} /> Replay ({recordedMessages.length})
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Pane 2: Center Omnibar & Message Composer ───────────────── */}
      <main className="ws-main-composer">
        {/* Omnibar Header */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Protocol segmented toggle */}
          <div style={{ display: 'flex', background: 'var(--bg-primary)', padding: '2px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
            <button
              className={`pill-btn ${protocol === 'ws' ? 'active' : ''}`}
              style={{ fontSize: '11px', padding: '3px 8px', background: protocol === 'ws' ? 'var(--bg-secondary)' : 'transparent', border: 'none', color: protocol === 'ws' ? 'var(--accent)' : 'var(--text-secondary)', cursor: 'pointer', borderRadius: '3px', fontWeight: protocol === 'ws' ? 600 : 400 }}
              onClick={() => setProtocol('ws')}
            >
              Raw WS
            </button>
            <button
              className={`pill-btn ${protocol === 'socketio' ? 'active' : ''}`}
              style={{ fontSize: '11px', padding: '3px 8px', background: protocol === 'socketio' ? 'var(--bg-secondary)' : 'transparent', border: 'none', color: protocol === 'socketio' ? 'var(--accent)' : 'var(--text-secondary)', cursor: 'pointer', borderRadius: '3px', fontWeight: protocol === 'socketio' ? 600 : 400 }}
              onClick={() => setProtocol('socketio')}
            >
              Socket.IO
            </button>
          </div>

          {/* URL bar */}
          <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: '10px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              {protocol === 'socketio' ? 'http://' : 'ws://'}
            </span>
            <input
              type="text"
              className="text-input"
              style={{ paddingLeft: protocol === 'socketio' ? '60px' : '52px', fontFamily: 'var(--font-mono)', fontSize: '12px', height: '32px' }}
              value={selectedRoutePath ? (appBaseUrl.replace(/^https?:\/\//, '') + selectedRoutePath) : ''}
              onChange={(e) => {
                const val = e.target.value;
                const pathIdx = val.indexOf('/');
                if (pathIdx !== -1) {
                  setSelectedRoutePath(val.substring(pathIdx));
                } else {
                  setSelectedRoutePath('/' + val);
                }
              }}
              placeholder="localhost:3000/ws"
            />
          </div>

          {/* Status Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)', border: '1px solid var(--border)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
            <span
              className="status-dot"
              style={{
                background: connStatus === 'connected' ? 'var(--success)' : connStatus === 'connecting' ? 'var(--warning)' : 'var(--text-muted)',
                boxShadow: connStatus === 'connected' ? '0 0 8px rgba(16, 185, 129, 0.4)' : 'none',
              }}
            />
            <span style={{ fontWeight: 600, color: connStatus === 'connected' ? 'var(--success)' : connStatus === 'connecting' ? 'var(--warning)' : 'var(--text-muted)' }}>
              {connStatus.toUpperCase()}
            </span>
          </div>

          {/* Connect / Disconnect Action Button */}
          {connStatus === 'connected' ? (
            <button
              className="btn btn-secondary"
              style={{ padding: '6px 14px', fontSize: '12px', color: 'var(--error)', borderColor: 'rgba(239, 68, 68, 0.3)', margin: 0, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              onClick={disconnectWs}
            >
              <WifiOff size={13} /> Disconnect
            </button>
          ) : (
            <button
              className="btn"
              style={{ padding: '6px 14px', fontSize: '12px', margin: 0, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              onClick={connectWs}
              disabled={connStatus === 'connecting' || !selectedRoutePath}
            >
              <Wifi size={13} /> {connStatus === 'connecting' ? 'Connecting...' : 'Connect'}
            </button>
          )}
        </div>

        {/* Message Composer Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 20px', gap: '14px', overflowY: 'auto' }}>
          {protocol === 'socketio' && (
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: '11px', fontWeight: 600 }}>Event Name</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  className="text-input"
                  placeholder="e.g. chat:message"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                />
                {['message', 'chat', 'ping'].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '4px 8px', fontSize: '11px', margin: 0 }}
                    onClick={() => setEventName(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message Payload Editor */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="form-label" style={{ fontSize: '11px', fontWeight: 600, margin: 0 }}>
                Message Payload
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '2px 8px', fontSize: '10px', margin: 0 }}
                  onClick={() => setMessagePayload('{\n  "event": "ping",\n  "timestamp": ' + Date.now() + '\n}')}
                >
                  Ping Template
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '2px 8px', fontSize: '10px', margin: 0 }}
                  onClick={() => {
                    try {
                      const p = JSON.parse(messagePayload);
                      setMessagePayload(JSON.stringify(p, null, 2));
                    } catch { }
                  }}
                >
                  Prettify JSON
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '2px 8px', fontSize: '10px', margin: 0 }}
                  onClick={() => setMessagePayload('')}
                >
                  Clear
                </button>
              </div>
            </div>

            <textarea
              className="textarea-input"
              style={{
                flex: 1,
                minHeight: '220px',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                lineHeight: '1.5',
                resize: 'none',
                background: 'var(--bg-secondary)',
              }}
              placeholder={protocol === 'socketio' ? '{\n  "text": "Hello Socket.IO"\n}' : '{\n  "type": "hello"\n}'}
              value={messagePayload}
              onChange={(e) => setMessagePayload(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  if (connStatus === 'connected') handleSendMessage();
                }
              }}
            />
          </div>

          {/* Send Action Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Press <kbd style={{ background: 'var(--bg-secondary)', padding: '2px 5px', borderRadius: '3px', border: '1px solid var(--border)', fontSize: '10px' }}>⌘ + Enter</kbd> to send
            </span>
            <button
              className="btn"
              onClick={handleSendMessage}
              disabled={connStatus !== 'connected'}
              style={{ padding: '7px 18px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px', margin: 0 }}
            >
              <Send size={13} /> Send Frame
            </button>
          </div>
        </div>
      </main>

      {/* ── Pane 3: Right Traffic Inspector ─────────────────────────── */}
      <section className="ws-traffic-inspector">
        {/* Stream Toolbar */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-primary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={13} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
              Live Traffic ({logs.length})
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ display: 'flex', background: 'var(--bg-secondary)', padding: '2px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              {(['all', 'in', 'out', 'assertion'] as const).map((mode) => (
                <button
                  key={mode}
                  style={{
                    fontSize: '10px',
                    padding: '2px 6px',
                    border: 'none',
                    background: frameFilter === mode ? 'var(--bg-primary)' : 'transparent',
                    color: frameFilter === mode ? 'var(--accent)' : 'var(--text-muted)',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontWeight: frameFilter === mode ? 600 : 400,
                  }}
                  onClick={() => setFrameFilter(mode)}
                >
                  {mode === 'all' ? 'All' : mode === 'in' ? '↓ IN' : mode === 'out' ? '↑ OUT' : 'Rules'}
                </button>
              ))}
            </div>

            <button
              className="btn btn-secondary"
              style={{ padding: '3px 8px', fontSize: '10px', margin: 0, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              onClick={clearLogs}
              title="Clear traffic stream"
            >
              <Trash2 size={11} /> Clear
            </button>
          </div>
        </div>

        {/* Traffic Frame Stream */}
        <div
          ref={logsContainerRef}
          style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
        >
          {logs.length === 0 ? (
            <div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              <Activity size={24} style={{ opacity: 0.3, marginBottom: '8px' }} />
              <div>No frames recorded yet.</div>
              <div style={{ fontSize: '11px', marginTop: '4px', color: 'var(--text-secondary)' }}>
                Connect to a WebSocket route to monitor live traffic.
              </div>
            </div>
          ) : (
            logs
              .filter((log) => {
                if (frameFilter === 'in') return log.type === 'received';
                if (frameFilter === 'out') return log.type === 'sent';
                if (frameFilter === 'assertion') return log.payload.includes('[ASSERTION');
                return true;
              })
              .map((log, i) => {
                const isSent = log.type === 'sent';
                const isReceived = log.type === 'received';
                const isAssertion = log.payload.includes('[ASSERTION');
                const isSelected = selectedFrame === log;

                return (
                  <div
                    key={i}
                    className={`ws-frame-row ${isSent ? 'is-sent' : isReceived ? 'is-recv' : ''}`}
                    style={{
                      cursor: 'pointer',
                      background: isSelected ? 'var(--bg-tertiary)' : undefined,
                    }}
                    onClick={() => setSelectedFrame(log)}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                      {isSent ? (
                        <span className="ws-dir-badge sent">↑ OUT</span>
                      ) : isReceived ? (
                        <span className="ws-dir-badge recv">↓ IN</span>
                      ) : isAssertion ? (
                        <span className="ws-dir-badge" style={{ background: log.payload.includes('PASSED') ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)', color: log.payload.includes('PASSED') ? 'var(--success)' : 'var(--error)' }}>
                          {log.payload.includes('PASSED') ? '✓ PASS' : '✗ FAIL'}
                        </span>
                      ) : (
                        <span className="ws-dir-badge" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
                          INFO
                        </span>
                      )}
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{log.time}</span>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <pre style={{ margin: 0, fontSize: '11.5px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)', maxHeight: isSelected ? 'none' : '65px', overflow: 'hidden' }}>
                        {log.payload}
                      </pre>
                    </div>
                  </div>
                );
              })
          )}
        </div>

        {/* Docked Frame Inspector Panel (When a frame is selected) */}
        {selectedFrame && (() => {
          const activeRoute = wsRoutes.find((r) => r.path === selectedRoutePath);
          const activeMessageSchema = activeRoute?.schema?.message;

          let frameJsonPayload: any = null;
          let parseError: string | null = null;
          let rawJson = selectedFrame.payload;

          if (selectedFrame.payload.startsWith('Event: ')) {
            const parts = selectedFrame.payload.split(' | Payload: ');
            if (parts.length > 1) {
              rawJson = parts[1];
            }
          }

          try {
            frameJsonPayload = JSON.parse(rawJson);
          } catch (e: any) {
            parseError = e.message;
          }

          const validationErrors =
            activeMessageSchema && frameJsonPayload && !parseError
              ? validateJsonSchema(frameJsonPayload, activeMessageSchema)
              : [];

          return (
            <div style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-primary)', padding: '12px 14px', maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Search size={12} /> Frame Inspector
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '2px 8px', fontSize: '10px', margin: 0, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    onClick={() => {
                      navigator.clipboard.writeText(rawJson);
                      setCopiedPayload(true);
                      setTimeout(() => setCopiedPayload(false), 1500);
                    }}
                  >
                    {copiedPayload ? <Check size={10} style={{ color: 'var(--success)' }} /> : <Copy size={10} />}
                    {copiedPayload ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '2px 6px', fontSize: '10px', margin: 0 }}
                    onClick={() => setSelectedFrame(null)}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Schema Validation Status */}
              {selectedFrame.type !== 'sent' && selectedFrame.type !== 'received' ? (
                <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                  System event frames do not have payload schemas.
                </div>
              ) : !activeMessageSchema ? (
                <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '6px 8px', borderRadius: 'var(--radius-sm)' }}>
                  No Zod schema registered for messages on this route.
                </div>
              ) : parseError ? (
                <div style={{ fontSize: '10.5px', color: 'var(--error)', background: 'rgba(239, 68, 68, 0.08)', padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  Failed to parse JSON: {parseError}
                </div>
              ) : validationErrors.length > 0 ? (
                <div style={{ fontSize: '10.5px', color: 'var(--error)', background: 'rgba(239, 68, 68, 0.08)', padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <AlertTriangle size={11} /> Schema Validation Failed ({validationErrors.length} errors)
                  </div>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {validationErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div style={{ fontSize: '10.5px', color: 'var(--success)', background: 'rgba(16, 185, 129, 0.08)', padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}>
                  <CheckCircle2 size={11} /> Valid according to registered Zod schema
                </div>
              )}

              {/* Formatted JSON Payload */}
              <pre style={{ margin: 0, padding: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: '11px', whiteSpace: 'pre-wrap', maxHeight: '140px', overflowY: 'auto' }}>
                {parseError ? rawJson : JSON.stringify(frameJsonPayload, null, 2)}
              </pre>
            </div>
          );
        })()}
      </section>
    </div>
  );
};

function validateJsonSchema(data: any, schema: any, path = ''): string[] {
  if (!schema) return [];
  const errors: string[] = [];

  const expectedType = schema.type;
  if (expectedType) {
    const actualType = typeof data;
    if (expectedType === 'array') {
      if (!Array.isArray(data)) {
        errors.push(`Field '${path || 'root'}' should be an array`);
        return errors;
      }
    } else if (expectedType === 'integer') {
      if (!Number.isInteger(data)) {
        errors.push(`Field '${path || 'root'}' should be an integer`);
        return errors;
      }
    } else if (expectedType === 'number') {
      if (typeof data !== 'number') {
        errors.push(`Field '${path || 'root'}' should be a number`);
        return errors;
      }
    } else if (expectedType === 'object') {
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        errors.push(`Field '${path || 'root'}' should be an object`);
        return errors;
      }
    } else if (actualType !== expectedType) {
      errors.push(
        `Field '${path || 'root'}' should be a ${expectedType}, got ${actualType}`,
      );
      return errors;
    }
  }

  if (schema.properties && typeof data === 'object' && data !== null) {
    if (Array.isArray(schema.required)) {
      for (const reqKey of schema.required) {
        if (!(reqKey in data) || data[reqKey] === undefined) {
          errors.push(
            `Field '${path ? `${path}.${reqKey}` : reqKey}' is required`,
          );
        }
      }
    }

    for (const [key, value] of Object.entries(data)) {
      if (schema.properties[key]) {
        errors.push(
          ...validateJsonSchema(
            value,
            schema.properties[key],
            path ? `${path}.${key}` : key,
          ),
        );
      }
    }
  }

  if (schema.items && Array.isArray(data)) {
    data.forEach((item, idx) => {
      errors.push(
        ...validateJsonSchema(item, schema.items, `${path || 'root'}[${idx}]`),
      );
    });
  }

  return errors;
}
