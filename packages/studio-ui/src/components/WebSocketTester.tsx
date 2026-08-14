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
          } catch {}
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
        '🔴 [RECORD] Recording session started. Outbound and inbound messages will be captured.',
      );
    } else {
      setRecording(false);
      appendWsLog(
        'info',
        `⏹ [RECORD] Recording stopped. ${recordedMessages.length} messages saved.`,
      );
    }
  };

  const handleReplaySession = async () => {
    if (recordedMessages.length === 0) return;

    appendWsLog(
      'info',
      '🎬 [REPLAY] Starting auto-replay of recorded session...',
    );
    appendWsLog('info', '🎬 [REPLAY] Reconnecting WebSocket...');
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
      appendWsLog('error', '❌ [REPLAY] Failed to connect for replay.');
      return;
    }

    appendWsLog(
      'info',
      '🎬 [REPLAY] WebSocket connected. Sending outbound events with delays...',
    );

    const outbounds = recordedMessages.filter((m) => m.type === 'sent');
    for (const msg of outbounds) {
      await new Promise((r) => setTimeout(r, msg.delay));
      appendWsLog(
        'info',
        `🎬 [REPLAY] Replaying outbound message after ${msg.delay}ms`,
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

    appendWsLog('info', '🎬 [REPLAY] Completed sending all outbound messages.');
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
    } catch {}

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
        } catch {}
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
          `✅ [ASSERTION PASSED] Matches rule: Target: ${rule.target} | Match: ${rule.type} | Value: "${rule.value}"`,
        );
      } else {
        appendWsLog(
          'error',
          `❌ [ASSERTION FAILED] Target: ${rule.target} | Expected Match: "${rule.value}" | Actual: ${targetVal}`,
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
    <div>
      <div className="panel-header">
        <div className="panel-title">WebSocket Route Tester</div>
        <div className="panel-subtitle">
          Connect, join rooms, send events, and analyze bidirectional messaging
          traffic in real-time
        </div>
      </div>

      <div className="tester-container">
        {/* Column 1: Connection & Control */}
        <div
          className="tester-section"
          style={{ height: '700px', overflowY: 'auto' }}
        >
          <div className="tester-section-title">
            <span>🔌</span> WS Connection
          </div>

          <div className="form-group">
            <label className="form-label">Discovered Route</label>
            <select
              className="select-input"
              value={selectedRoutePath}
              onChange={(e) => handleRouteSelect(e.target.value)}
            >
              <option value="">-- Choose Route --</option>
              {wsRoutes.map((r) => (
                <option key={r.path} value={r.path}>
                  WS {r.path}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Protocol Type</label>
            <select
              className="select-input"
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as 'ws' | 'socketio')}
            >
              <option value="ws">Raw WebSocket</option>
              <option value="socketio">Socket.IO</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Connection Status</label>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              <div
                className={getStatusBadgeClass()}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {connStatus.toUpperCase()}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  className="btn"
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '12px',
                    margin: 0,
                  }}
                  onClick={connectWs}
                  disabled={
                    connStatus === 'connected' || connStatus === 'connecting'
                  }
                >
                  Connect
                </button>
                <button
                  className="btn btn-secondary"
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '12px',
                    margin: 0,
                  }}
                  onClick={disconnectWs}
                  disabled={connStatus === 'disconnected'}
                >
                  Disconnect
                </button>
              </div>
            </div>
          </div>

          {protocol === 'socketio' && (
            <div
              className="form-group"
              style={{
                borderTop: '1px solid var(--border)',
                paddingTop: '12px',
              }}
            >
              <label className="form-label">Socket.IO Rooms</label>
              <input
                className="text-input"
                type="text"
                placeholder="Room name"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-secondary"
                  style={{
                    flex: 1,
                    padding: '6px',
                    fontSize: '11px',
                    margin: 0,
                  }}
                  onClick={handleJoinRoom}
                  disabled={connStatus !== 'connected'}
                >
                  Join
                </button>
                <button
                  className="btn btn-secondary"
                  style={{
                    flex: 1,
                    padding: '6px',
                    fontSize: '11px',
                    margin: 0,
                  }}
                  onClick={handleLeaveRoom}
                  disabled={connStatus !== 'connected'}
                >
                  Leave
                </button>
              </div>
            </div>
          )}

          {/* Session Recorder controls */}
          <div
            className="form-group"
            style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}
          >
            <label className="form-label">Replay & Recorder</label>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
            >
              <button
                className="btn"
                style={{
                  background: recording
                    ? 'rgba(239, 68, 68, 0.2)'
                    : 'rgba(239, 68, 68, 0.05)',
                  color: 'var(--error)',
                  borderColor: recording
                    ? 'var(--error)'
                    : 'rgba(239, 68, 68, 0.2)',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  margin: 0,
                }}
                onClick={toggleRecording}
              >
                {recording ? '⏹ Stop' : '🔴 Record Session'}
              </button>
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  textAlign: 'center',
                }}
              >
                {recording
                  ? `Recording... (${recordedMessages.length} captured)`
                  : recordedMessages.length > 0
                    ? `Captured ${recordedMessages.length} messages`
                    : 'No messages captured'}
              </div>
              <button
                className="btn btn-secondary"
                onClick={handleReplaySession}
                disabled={recordedMessages.length === 0 || recording}
                style={{ margin: 0 }}
              >
                🎬 Playback Replay
              </button>
            </div>
          </div>
        </div>

        {/* Column 2: Composer & Rules */}
        <div
          className="tester-section"
          style={{
            height: '700px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            overflowY: 'auto',
          }}
        >
          <div className="tester-section-title" style={{ flexShrink: 0 }}>
            <span>📝</span> Message Composer
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              flexShrink: 0,
            }}
          >
            {protocol === 'socketio' && (
              <div className="form-group">
                <label className="form-label">Event Name</label>
                <input
                  className="text-input"
                  type="text"
                  placeholder="Event name"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                />
              </div>
            )}
            <div
              className="form-group"
              style={{ display: 'flex', flexDirection: 'column' }}
            >
              <label className="form-label">
                Message Payload (String or JSON)
              </label>
              <textarea
                className="textarea-input"
                style={{ minHeight: '120px', resize: 'none' }}
                placeholder={
                  protocol === 'socketio'
                    ? '{\n  "key": "value"\n}'
                    : 'Hello WebSocket'
                }
                value={messagePayload}
                onChange={(e) => setMessagePayload(e.target.value)}
              />
            </div>
            <button
              className="btn"
              onClick={handleSendMessage}
              disabled={connStatus !== 'connected'}
              style={{ width: '100%', margin: 0 }}
            >
              ⚡ Send Message
            </button>
          </div>

          {/* Assertion Rules Box */}
          <div
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: '12px',
              display: 'flex',
              flexDirection: 'column',
              height: '240px',
              flexShrink: 0,
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
              <span className="form-label" style={{ fontWeight: 600 }}>
                📐 Assertion Rules
              </span>
              <button
                className="btn btn-secondary"
                style={{ padding: '2px 8px', fontSize: '10px', margin: 0 }}
                onClick={addAssertionRule}
              >
                + Add Rule
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                paddingRight: '4px',
              }}
            >
              {rules.length === 0 ? (
                <div
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '11px',
                    textAlign: 'center',
                    fontStyle: 'italic',
                    paddingTop: '20px',
                  }}
                >
                  No assertions defined. Add rules to validate traffic.
                </div>
              ) : (
                rules.map((rule, idx) => (
                  <div
                    key={rule.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      padding: '10px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-secondary)',
                      textAlign: 'left',
                      position: 'relative',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Rule #{idx + 1}
                      </span>
                      <button
                        className="btn btn-secondary"
                        style={{
                          padding: '2px 6px',
                          fontSize: '9px',
                          margin: 0,
                          color: 'var(--error)',
                          borderColor: 'transparent',
                          background: 'transparent',
                        }}
                        onClick={() => removeAssertionRule(rule.id)}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <select
                        className="select-input"
                        style={{
                          fontSize: '11px',
                          padding: '4px 6px',
                          height: 'auto',
                          flex: 1,
                        }}
                        value={rule.target}
                        onChange={(e) =>
                          updateAssertionRule(rule.id, 'target', e.target.value)
                        }
                      >
                        <option value="event">Event Match</option>
                        <option value="payload">Payload Subset</option>
                      </select>
                      <select
                        className="select-input"
                        style={{
                          fontSize: '11px',
                          padding: '4px 6px',
                          height: 'auto',
                          flex: 1,
                        }}
                        value={rule.type}
                        onChange={(e) =>
                          updateAssertionRule(rule.id, 'type', e.target.value)
                        }
                      >
                        <option value="contains">Contains</option>
                        <option value="equals">Equals</option>
                        <option value="regex">RegExp</option>
                      </select>
                    </div>
                    <input
                      className="text-input"
                      type="text"
                      placeholder="Expected value/JSON"
                      style={{
                        fontSize: '11px',
                        padding: '6px 8px',
                        height: 'auto',
                        marginTop: '4px',
                      }}
                      value={rule.value}
                      onChange={(e) =>
                        updateAssertionRule(rule.id, 'value', e.target.value)
                      }
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Column 3: Live Traffic Stream */}
        <div
          className="tester-section"
          style={{
            height: '700px',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
          }}
        >
          <div
            className="tester-section-title"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <span>💬 Live Traffic Stream</span>
            <button
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: '11px', margin: 0 }}
              onClick={clearLogs}
            >
              Clear Stream
            </button>
          </div>

          <div style={{ display: 'flex', flex: 1, gap: '12px', minHeight: 0 }}>
            <div
              ref={logsContainerRef}
              className="console-terminal"
              style={{
                flex: 1,
                overflowY: 'auto',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                padding: '16px',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {logs.length === 0 ? (
                <div
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '13px',
                    textAlign: 'center',
                    paddingTop: '80px',
                  }}
                >
                  Select a route and connect to begin capturing WebSocket
                  traffic.
                </div>
              ) : (
                logs.map((log, i) => {
                  const isSent = log.type === 'sent';
                  const isReceived = log.type === 'received';
                  const isAssertion = log.payload.includes('[ASSERTION');

                  let dirLabel = 'ℹ️ System';
                  let labelColor = 'var(--text-secondary)';

                  if (isSent) {
                    dirLabel = '⬆️ Outbound';
                    labelColor = 'var(--accent)';
                  } else if (isReceived) {
                    dirLabel = '⬇️ Inbound';
                    labelColor = 'var(--success)';
                  } else if (isAssertion) {
                    const passed = log.payload.includes('PASSED');
                    dirLabel = passed
                      ? '✅ Assertion Passed'
                      : '❌ Assertion Failed';
                    labelColor = passed ? 'var(--success)' : 'var(--error)';
                  }

                  // Try to pretty print JSON payloads for easier readability
                  let formattedPayload = log.payload;
                  if (isReceived || isSent) {
                    let rawJson = log.payload;
                    if (log.payload.startsWith('Event: ')) {
                      const parts = log.payload.split(' | Payload: ');
                      if (parts.length > 1) {
                        rawJson = parts[1];
                      }
                    }
                    try {
                      const parsed = JSON.parse(rawJson);
                      const pretty = JSON.stringify(parsed, null, 2);
                      if (log.payload.startsWith('Event: ')) {
                        formattedPayload = `Event: ${log.payload.split(' | Payload: ')[0].substring(7)}\nPayload:\n${pretty}`;
                      } else {
                        formattedPayload = pretty;
                      }
                    } catch {}
                  }

                  const isSelected = selectedFrame === log;

                  return (
                    <div
                      key={i}
                      className={`ws-log-item ${log.type}`}
                      style={{
                        textAlign: 'left',
                        margin: 0,
                        padding: '10px 14px',
                        cursor: 'pointer',
                        border: isSelected
                          ? '1px solid var(--accent)'
                          : '1px solid transparent',
                        background: isSelected
                          ? 'var(--bg-tertiary)'
                          : undefined,
                        borderRadius: 'var(--radius-sm)',
                      }}
                      onClick={() => setSelectedFrame(log)}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: labelColor,
                        }}
                      >
                        <span>{dirLabel}</span>
                        <span
                          style={{
                            color: 'var(--text-muted)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {log.time}
                        </span>
                      </div>
                      <pre
                        style={{
                          marginTop: '6px',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '12px',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          color: 'var(--text-primary)',
                          margin: 0,
                        }}
                      >
                        {formattedPayload}
                      </pre>
                    </div>
                  );
                })
              )}
            </div>

            {selectedFrame &&
              (() => {
                const activeRoute = wsRoutes.find(
                  (r) => r.path === selectedRoutePath,
                );
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
                  <div
                    style={{
                      width: '280px',
                      borderLeft: '1px solid var(--border)',
                      paddingLeft: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                      overflowY: 'auto',
                      background: 'var(--bg-secondary)',
                      borderRadius: 'var(--radius-sm)',
                      textAlign: 'left',
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderBottom: '1px solid var(--border)',
                        paddingBottom: '8px',
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                        }}
                      >
                        🔍 Frame Inspector
                      </span>
                      <button
                        className="btn btn-secondary"
                        style={{
                          padding: '2px 6px',
                          fontSize: '10px',
                          margin: 0,
                        }}
                        onClick={() => setSelectedFrame(null)}
                      >
                        ✕ Close
                      </button>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        gap: '6px',
                        flexWrap: 'wrap',
                        flexShrink: 0,
                      }}
                    >
                      <span
                        className={`method-badge ${selectedFrame.type === 'sent' ? 'method-POST' : selectedFrame.type === 'received' ? 'method-GET' : 'method-OPTIONS'}`}
                        style={{ fontSize: '9px', padding: '2px 6px' }}
                      >
                        {selectedFrame.type.toUpperCase()}
                      </span>
                      <span
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: '10px',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {selectedFrame.time}
                      </span>
                    </div>

                    {/* Validation Status Block */}
                    {selectedFrame.type !== 'sent' &&
                    selectedFrame.type !== 'received' ? (
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          background: 'var(--bg-tertiary)',
                          padding: '8px',
                          borderRadius: '4px',
                        }}
                      >
                        System event frames do not have payload schemas.
                      </div>
                    ) : !activeMessageSchema ? (
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          background: 'var(--bg-tertiary)',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border)',
                        }}
                      >
                        ℹ️ No Zod schema registered for messages on this route.
                      </div>
                    ) : parseError ? (
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--error)',
                          background: 'rgba(239, 68, 68, 0.08)',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid rgba(239, 68, 68, 0.15)',
                        }}
                      >
                        ⚠️ Failed to parse frame as JSON: {parseError}
                      </div>
                    ) : validationErrors.length > 0 ? (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: 'var(--error)',
                            background: 'rgba(239, 68, 68, 0.08)',
                            padding: '6px 10px',
                            borderRadius: '4px',
                            border: '1px solid rgba(239, 68, 68, 0.15)',
                          }}
                        >
                          ❌ Schema Validation Failed ({validationErrors.length}{' '}
                          error{validationErrors.length === 1 ? '' : 's'})
                        </div>
                        <ul
                          style={{
                            margin: 0,
                            padding: 0,
                            listStyle: 'none',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                          }}
                        >
                          {validationErrors.map((err, idx) => (
                            <li
                              key={idx}
                              style={{
                                fontSize: '10px',
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--error)',
                                background: 'var(--bg-primary)',
                                padding: '4px 8px',
                                borderRadius: '3px',
                                borderLeft: '2px solid var(--error)',
                              }}
                            >
                              {err}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: 'var(--success)',
                          background: 'rgba(16, 185, 129, 0.08)',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          border: '1px solid rgba(16, 185, 129, 0.15)',
                        }}
                      >
                        ✅ Frame Valid against Zod Schema
                      </div>
                    )}

                    {/* Parsed Payload tree */}
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Parsed Payload:
                      </span>
                      <pre
                        style={{
                          margin: 0,
                          padding: '8px',
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '11px',
                          overflowX: 'auto',
                          whiteSpace: 'pre-wrap',
                          maxHeight: '200px',
                        }}
                      >
                        {parseError
                          ? rawJson
                          : JSON.stringify(frameJsonPayload, null, 2)}
                      </pre>
                    </div>

                    {/* Schema definition */}
                    {activeMessageSchema && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          borderTop: '1px solid var(--border)',
                          paddingTop: '8px',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: 'var(--text-secondary)',
                          }}
                        >
                          Registered JSON Schema:
                        </span>
                        <pre
                          style={{
                            margin: 0,
                            padding: '8px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '10px',
                            overflowX: 'auto',
                            maxHeight: '150px',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {JSON.stringify(activeMessageSchema, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })()}
          </div>
        </div>
      </div>
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
