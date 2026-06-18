import React, { useEffect, useRef, useState } from 'react';
import { DiscoveryData, FindingItem } from './types';
import { apiFetch, getToken, removeToken, setToken } from './utils/api';

// Components
import { Dashboard } from './components/Dashboard';
import { Logs } from './components/Logs';
import {
  AiAssistantPanel,
  AnalyticsPanel,
  ArchitecturePanel,
  ConfigPanel,
  ContractsPanel,
  EventsPanel,
  HealthPanel,
  HooksPanel,
  MiddlewaresPanel,
  OpenApiPanel,
  PerformancePanel,
  QualityPanel,
  SchemasPanel,
  SdkImpactPanel,
  ServicesPanel
} from './components/OtherPanels';
import { Playground } from './components/Playground';
import { Recorder } from './components/Recorder';
import { RequestBuilder } from './components/RequestBuilder';
import { WebSocketTester } from './components/WebSocketTester';
import { ProfilerPanel } from './components/ProfilerPanel';
import { TracingPanel } from './components/Tracing';
import { JobsPanel } from './components/JobsPanel';

function App() {
  const [token, setTokenState] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      setToken(urlToken);
      const nextParams = new URLSearchParams(window.location.search);
      nextParams.delete('token');
      const searchStr = nextParams.toString();
      const newUrl = window.location.pathname + (searchStr ? `?${searchStr}` : '') + window.location.hash;
      window.history.replaceState({}, document.title, newUrl);
      return urlToken;
    }
    return getToken();
  });
  const [loginInput, setLoginInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  
  const [loadingDiscovery, setLoadingDiscovery] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryData | null>(null);
  const [activePanel, setActivePanel] = useState('routes');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // WebSocket Live Sync
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  // Prefill references for quick tests
  const [prefilledMethod, setPrefilledMethod] = useState('');
  const [prefilledPath, setPrefilledPath] = useState('');
  const [prefilledWsPath, setPrefilledWsPath] = useState('');

  // Logs tracing
  const [filterRequestId, setFilterRequestId] = useState<string | null>(null);

  // Errors banners
  const [buildError, setBuildError] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);

  // Source Viewer Modal
  const [sourceViewerFile, setSourceViewerFile] = useState<string | null>(null);
  const [sourceViewerLine, setSourceViewerLine] = useState<number>(0);
  const [sourceViewerLines, setSourceViewerLines] = useState<{ num: number; text: string; isTarget: boolean }[]>([]);

  // Export report dropdown
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Sync token-level events and theme setting
  useEffect(() => {
    // Check URL query parameter for token
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      setToken(urlToken);
      setTokenState(urlToken);
      const nextParams = new URLSearchParams(window.location.search);
      nextParams.delete('token');
      const searchStr = nextParams.toString();
      const newUrl = window.location.pathname + (searchStr ? `?${searchStr}` : '') + window.location.hash;
      window.history.replaceState({}, document.title, newUrl);
    }

    // Read theme from localStorage or document
    const savedTheme = localStorage.getItem('axiomify_studio_theme') as 'light' | 'dark' | null;
    const initialTheme = savedTheme || 'light';
    setTheme(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);

    const handleUnauthorized = () => {
      handleLogout();
    };

    const handleFilterRequestId = (e: Event) => {
      const rid = (e as CustomEvent).detail;
      setFilterRequestId(rid);
      setActivePanel('logs');
    };

    window.addEventListener('axiomify-unauthorized', handleUnauthorized);
    window.addEventListener('axiomify-filter-request-id', handleFilterRequestId);

    // Initial load
    if (token || urlToken) {
      loadDiscovery();
    }

    return () => {
      window.removeEventListener('axiomify-unauthorized', handleUnauthorized);
      window.removeEventListener('axiomify-filter-request-id', handleFilterRequestId);
      closeWs();
    };
  }, [token]);

  // Load discovery data
  const loadDiscovery = async () => {
    setLoadingDiscovery(true);
    try {
      const res = await apiFetch('/__studio/api/discovery');
      if (res.status === 401) {
        handleLogout();
        setLoginError('Invalid Access Token. Please check the terminal.');
        setLoadingDiscovery(false);
        return;
      }
      if (!res.ok) {
        throw new Error('Failed to load discovery metadata');
      }
      const data = await res.json();
      setDiscovery(data);
      setLoginError(null);

      // Successfully authenticated -> bootstrap socket sync
      connectWs();
    } catch (err: any) {
      console.error('Failed to load discovery:', err);
    } finally {
      setLoadingDiscovery(false);
    }
  };

  // WebSocket Live-Sync Bootstrap
  const connectWs = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const currentToken = getToken();
    const wsProto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = `${wsProto}${window.location.host}/__studio/ws${currentToken ? `?token=${encodeURIComponent(currentToken)}` : ''}`;

    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      console.log('Studio Live Sync connected');
      clearTimeout(reconnectTimeoutRef.current);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'reload') {
          setBuildError(null);
          setReloadError(null);
          loadDiscovery();
        } else if (data.type === 'build-error') {
          const errMsg = data.errors.map((e: any) => e.text).join('\n');
          setBuildError(errMsg);
        } else if (data.type === 'reload-error') {
          setReloadError(data.message);
        } else if (data.type === 'replays-updated') {
          window.dispatchEvent(new CustomEvent('axiomify-replays-updated'));
        } else if (data.type === 'recorder-updated') {
          // recorder component automatically polls or updates badge
          apiFetch('/__studio/api/session').then(r => r.json()).then(d => {
            const badge = document.getElementById('badge-recorder');
            if (badge) badge.textContent = String(d.summary?.requestCount || 0);
          }).catch(() => {});
        } else if (data.type === 'sdk-impact') {
          const badge = document.getElementById('badge-sdk-impact');
          if (badge) {
            badge.textContent = String(data.count || 0);
            badge.style.display = data.count > 0 ? 'inline-block' : 'none';
          }
        } else if (data.type === 'contracts-updated') {
          apiFetch('/__studio/api/contracts').then(r => r.json()).then(d => {
            const failedCount = d.results ? d.results.filter((c: any) => !c.passed && c.status === 'failed').length : 0;
            const badge = document.getElementById('badge-contracts');
            if (badge) {
              badge.textContent = String(failedCount);
              badge.style.display = failedCount > 0 ? 'inline-flex' : 'none';
            }
          }).catch(() => {});
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    socket.onclose = () => {
      console.log('Studio Live Sync disconnected, reconnecting...');
      reconnectTimeoutRef.current = setTimeout(connectWs, 2000);
    };

    socket.onerror = () => {
      socket.close();
    };
  };

  const closeWs = () => {
    clearTimeout(reconnectTimeoutRef.current);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const handleLogin = () => {
    const trimmed = loginInput.trim();
    if (!trimmed) {
      setLoginError('Token cannot be empty');
      return;
    }
    setToken(trimmed);
    setTokenState(trimmed);
  };

  const handleLogout = () => {
    removeToken();
    setTokenState('');
    setDiscovery(null);
    closeWs();
  };

  const handleThemeToggle = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('axiomify_studio_theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  const triggerExportReport = (format: string) => {
    setExportMenuOpen(false);
    const currentToken = getToken();
    window.location.href = `/__studio/api/export/${format}?token=${encodeURIComponent(currentToken)}`;
  };

  const handleQuickTest = (m: string, p: string) => {
    setPrefilledMethod(m);
    setPrefilledPath(p);
    setActivePanel('tester');
  };

  const handleOpenWsTester = (p: string) => {
    setPrefilledWsPath(p);
    setActivePanel('ws-tester');
  };

  // Open Source code context viewer
  const handleOpenSourceViewer = async (filePath: string, lineNumber: number) => {
    try {
      const res = await apiFetch('/__studio/api/debug/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: filePath, line: lineNumber, context: 10 }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to read source file');
        return;
      }
      const data = await res.json();
      setSourceViewerFile(filePath);
      setSourceViewerLine(lineNumber);
      setSourceViewerLines(data.lines || []);
    } catch (err) {
      console.error('Source viewer error:', err);
      alert('Failed to load source viewer');
    }
  };

  const handleCloseSourceViewer = () => {
    setSourceViewerFile(null);
    setSourceViewerLines([]);
  };

  const handleAiDebugClick = () => {
    if (!sourceViewerFile) return;
    const codeLines = sourceViewerLines.map(l => l.text).join('\n');
    const prompt = `I got an error in the file ${sourceViewerFile} around line ${sourceViewerLine}.\nHere is the code context:\n\`\`\`typescript\n${codeLines}\n\`\`\`\n\nCan you analyze this code and tell me what is causing the error and how to fix it?`;
    
    handleCloseSourceViewer();
    setActivePanel('ai');

    // Focus and fill the prompt in textarea if present
    setTimeout(() => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        textarea.value = prompt;
        // Trigger dispatch/change
        const event = new Event('input', { bubbles: true });
        textarea.dispatchEvent(event);
      }
    }, 100);
  };

  // Render Panel content
  const renderPanelContent = () => {
    if (!discovery) return null;

    switch (activePanel) {
      case 'routes':
        return <Dashboard discovery={discovery} onQuickTest={handleQuickTest} onOpenWsTester={handleOpenWsTester} />;
      case 'schemas':
        return <SchemasPanel discovery={discovery} />;
      case 'openapi':
        return <OpenApiPanel discovery={discovery} onRefresh={loadDiscovery} />;
      case 'services':
        return <ServicesPanel discovery={discovery} />;
      case 'middlewares':
        return <MiddlewaresPanel discovery={discovery} onNavigateToRoute={handleQuickTest} />;
      case 'events':
        return <EventsPanel discovery={discovery} />;
      case 'architecture':
        return <ArchitecturePanel discovery={discovery} />;
      case 'hooks':
        return <HooksPanel discovery={discovery} />;
      case 'logs':
        return (
          <Logs
            onOpenSourceViewer={handleOpenSourceViewer}
            filterRequestId={filterRequestId}
            onClearRequestIdFilter={() => setFilterRequestId(null)}
          />
        );
      case 'analytics':
        return <AnalyticsPanel />;
      case 'recorder':
        return <Recorder />;
      case 'profiler':
        return <ProfilerPanel />;
      case 'performance':
        return <PerformancePanel />;
      case 'tracing':
        return <TracingPanel />;
      case 'jobs':
        return <JobsPanel />;
      case 'sdk-impact':
        return <SdkImpactPanel />;
      case 'health':
        return <HealthPanel discovery={discovery} />;
      case 'security':
        return <SecurityPanel discovery={discovery} />;
      case 'contracts':
        return <ContractsPanel />;
      case 'quality':
        return <QualityPanel />;
      case 'ai':
        return <AiAssistantPanel isDark={theme === 'dark'} />;
      case 'config':
        return <ConfigPanel discovery={discovery} />;
      case 'tester':
        return (
          <RequestBuilder
            discovery={discovery}
            prefilledMethod={prefilledMethod}
            prefilledPath={prefilledPath}
            onClearPrefill={() => {
              setPrefilledMethod('');
              setPrefilledPath('');
            }}
          />
        );
      case 'ws-tester':
        return (
          <WebSocketTester
            discovery={discovery}
            prefilledPath={prefilledWsPath}
            onClearPrefill={() => setPrefilledWsPath('')}
          />
        );
      case 'playground':
        return <Playground discovery={discovery} isDark={theme === 'dark'} />;
      default:
        return <div>Panel "{activePanel}" not implemented.</div>;
    }
  };

  if (!token) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-logo">A</div>
          <h2 className="login-title">Axiomify Studio</h2>
          <p className="login-subtitle">Enter the access token printed in your terminal to log in to the explorer.</p>
          <input
            type="password"
            className="login-input"
            placeholder="Paste access token..."
            value={loginInput}
            onChange={e => setLoginInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
          />
          <button className="login-button" onClick={handleLogin}>Access Studio</button>
          {loginError && <div className="login-error" style={{ display: 'block' }}>{loginError}</div>}
        </div>
      </div>
    );
  }

  const hookTotal = discovery?.hooks?.reduce((s, h) => s + h.count, 0) || 0;

  return (
    <div className="app-layout">
      {/* Header */}
      <header className="header">
        <div className="header-title" id="header-title">
          {activePanel.charAt(0).toUpperCase() + activePanel.slice(1).replace('-', ' ')}
        </div>
        
        {discovery && (
          <div className="header-stats" id="header-stats" style={{ display: 'flex', gap: '16px' }}>
            <span>
              <span className="header-stat-value">{discovery.routes?.filter(r => !r.isWs).length || 0}</span> HTTP
            </span>
            <span>
              <span className="header-stat-value">{discovery.routes?.filter(r => r.isWs).length || 0}</span> WS
            </span>
            <span>
              <span className="header-stat-value">{hookTotal}</span> Hooks
            </span>
          </div>
        )}

        {/* Export Report Dropdown */}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <button
            className="btn btn-secondary"
            style={{ margin: 0, padding: '6px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => setExportMenuOpen(!exportMenuOpen)}
          >
            <span>📤</span> Export Report <span style={{ fontSize: '10px' }}>▼</span>
          </button>
          {exportMenuOpen && (
            <div style={{ position: 'absolute', right: 0, top: '110%', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-md)', zIndex: 100, minWidth: '160px', overflow: 'hidden' }}>
              <a href="#" style={{ display: 'block', padding: '10px 14px', color: 'var(--text-primary)', textDecoration: 'none', fontSize: '13px', textAlign: 'left' }} onClick={() => triggerExportReport('html')}>HTML Report (.html)</a>
              <a href="#" style={{ display: 'block', padding: '10px 14px', color: 'var(--text-primary)', textDecoration: 'none', fontSize: '13px', textAlign: 'left', borderTop: '1px solid var(--border)' }} onClick={() => triggerExportReport('pdf')}>PDF Report (.pdf)</a>
              <a href="#" style={{ display: 'block', padding: '10px 14px', color: 'var(--text-primary)', textDecoration: 'none', fontSize: '13px', textAlign: 'left', borderTop: '1px solid var(--border)' }} onClick={() => triggerExportReport('markdown')}>Markdown Report (.md)</a>
            </div>
          )}
        </div>

        <button className="theme-toggle-btn" onClick={handleThemeToggle} title="Toggle Light/Dark Mode">
          {theme === 'light' ? '☀️' : '🌙'}
        </button>
      </header>

      {/* Sidebar Navigation */}
      <nav className="sidebar">
        <div className="sidebar-brand">
          <div className="header-logo-icon">A</div>
          <span>Axiomify Studio</span>
          <span className="header-badge">v1</span>
        </div>

        <div className="sidebar-section">Inspect</div>
        <a className={`nav-item ${activePanel === 'routes' ? 'active' : ''}`} href="#routes" onClick={(e) => { e.preventDefault(); setActivePanel('routes'); }}>
          <span className="nav-icon">🧭</span>
          <span>Routes</span>
          {discovery && <span className="nav-badge">{discovery.routes?.length || 0}</span>}
        </a>
        <a className={`nav-item ${activePanel === 'schemas' ? 'active' : ''}`} href="#schemas" onClick={(e) => { e.preventDefault(); setActivePanel('schemas'); }}>
          <span className="nav-icon">📐</span>
          <span>Schemas</span>
          {discovery && <span className="nav-badge">{discovery.schemas?.length || 0}</span>}
        </a>
        <a className={`nav-item ${activePanel === 'openapi' ? 'active' : ''}`} href="#openapi" onClick={(e) => { e.preventDefault(); setActivePanel('openapi'); }}>
          <span className="nav-icon">📄</span>
          <span>OpenAPI</span>
        </a>
        <a className={`nav-item ${activePanel === 'services' ? 'active' : ''}`} href="#services" onClick={(e) => { e.preventDefault(); setActivePanel('services'); }}>
          <span className="nav-icon">🧩</span>
          <span>Services</span>
          {discovery && <span className="nav-badge">{discovery.services?.length || 0}</span>}
        </a>
        <a className={`nav-item ${activePanel === 'middlewares' ? 'active' : ''}`} href="#middlewares" onClick={(e) => { e.preventDefault(); setActivePanel('middlewares'); }}>
          <span className="nav-icon">🧱</span>
          <span>Middlewares</span>
          {discovery && (
            <span className="nav-badge">
              {Array.from(new Set(discovery.routes?.flatMap(r => r.plugins || []) || [])).length}
            </span>
          )}
        </a>
        <a className={`nav-item ${activePanel === 'events' ? 'active' : ''}`} href="#events" onClick={(e) => { e.preventDefault(); setActivePanel('events'); }}>
          <span className="nav-icon">📣</span>
          <span>Events</span>
        </a>
        <a className={`nav-item ${activePanel === 'architecture' ? 'active' : ''}`} href="#architecture" onClick={(e) => { e.preventDefault(); setActivePanel('architecture'); }}>
          <span className="nav-icon">🗺️</span>
          <span>Architecture</span>
        </a>

        <div className="sidebar-section">Observe</div>
        <a className={`nav-item ${activePanel === 'hooks' ? 'active' : ''}`} href="#hooks" onClick={(e) => { e.preventDefault(); setActivePanel('hooks'); }}>
          <span className="nav-icon">🪝</span>
          <span>Hooks</span>
          {discovery && <span className="nav-badge">{hookTotal}</span>}
        </a>
        <a className={`nav-item ${activePanel === 'logs' ? 'active' : ''}`} href="#logs" onClick={(e) => { e.preventDefault(); setActivePanel('logs'); }}>
          <span className="nav-icon">📜</span>
          <span>Logs</span>
          <span className="nav-badge" id="badge-logs">0</span>
        </a>
        <a className={`nav-item ${activePanel === 'analytics' ? 'active' : ''}`} href="#analytics" onClick={(e) => { e.preventDefault(); setActivePanel('analytics'); }}>
          <span className="nav-icon">📊</span>
          <span>Analytics</span>
        </a>
        <a className={`nav-item ${activePanel === 'recorder' ? 'active' : ''}`} href="#recorder" onClick={(e) => { e.preventDefault(); setActivePanel('recorder'); }}>
          <span className="nav-icon">🔴</span>
          <span>Recorder</span>
          <span className="nav-badge" id="badge-recorder">0</span>
        </a>
        <a className={`nav-item ${activePanel === 'performance' ? 'active' : ''}`} href="#performance" onClick={(e) => { e.preventDefault(); setActivePanel('performance'); }}>
          <span className="nav-icon">⚡</span>
          <span>Performance</span>
        </a>
        <a className={`nav-item ${activePanel === 'tracing' ? 'active' : ''}`} href="#tracing" onClick={(e) => { e.preventDefault(); setActivePanel('tracing'); }}>
          <span className="nav-icon">🧭</span>
          <span>Tracing</span>
        </a>
        <a className={`nav-item ${activePanel === 'jobs' ? 'active' : ''}`} href="#jobs" onClick={(e) => { e.preventDefault(); setActivePanel('jobs'); }}>
          <span className="nav-icon">💼</span>
          <span>Jobs & Workers</span>
        </a>
        <a className={`nav-item ${activePanel === 'sdk-impact' ? 'active' : ''}`} href="#sdk-impact" onClick={(e) => { e.preventDefault(); setActivePanel('sdk-impact'); }}>
          <span className="nav-icon">📦</span>
          <span>SDK Impact</span>
          <span className="nav-badge" id="badge-sdk-impact" style={{ display: 'none' }}>0</span>
        </a>
        <a className={`nav-item ${activePanel === 'health' ? 'active' : ''}`} href="#health" onClick={(e) => { e.preventDefault(); setActivePanel('health'); }}>
          <span className="nav-icon">❤️</span>
          <span>Health</span>
          {discovery?.health && (
            <span
              className="nav-badge"
              id="badge-health"
              style={{
                background: (discovery.health.summary.failures > 0) ? 'rgba(255,107,107,0.2)' : (discovery.health.summary.warnings > 0) ? 'rgba(255,193,7,0.2)' : 'var(--bg-tertiary)',
                color: (discovery.health.summary.failures > 0) ? 'var(--error)' : (discovery.health.summary.warnings > 0) ? 'var(--warning)' : 'var(--text-muted)'
              }}
            >
              {discovery.health.summary.failures + discovery.health.summary.warnings}
            </span>
          )}
        </a>
        <a className={`nav-item ${activePanel === 'security' ? 'active' : ''}`} href="#security" onClick={(e) => { e.preventDefault(); setActivePanel('security'); }}>
          <span className="nav-icon">🛡️</span>
          <span>Security</span>
          <span className="nav-badge" id="badge-security" style={{ display: 'none' }}>0</span>
        </a>
        <a className={`nav-item ${activePanel === 'contracts' ? 'active' : ''}`} href="#contracts" onClick={(e) => { e.preventDefault(); setActivePanel('contracts'); }}>
          <span className="nav-icon">📋</span>
          <span>Contracts</span>
          <span className="nav-badge" id="badge-contracts" style={{ display: 'none' }}>0</span>
        </a>
        <a className={`nav-item ${activePanel === 'quality' ? 'active' : ''}`} href="#quality" onClick={(e) => { e.preventDefault(); setActivePanel('quality'); }}>
          <span className="nav-icon">🏆</span>
          <span>Quality</span>
          <span className="nav-badge" id="badge-quality" style={{ background: 'var(--accent)', color: '#fff', fontWeight: 700 }}>100</span>
        </a>
        <a className={`nav-item ${activePanel === 'ai' ? 'active' : ''}`} href="#ai" onClick={(e) => { e.preventDefault(); setActivePanel('ai'); }}>
          <span className="nav-icon">✨</span>
          <span>AI Assistant</span>
        </a>
        <a className={`nav-item ${activePanel === 'config' ? 'active' : ''}`} href="#config" onClick={(e) => { e.preventDefault(); setActivePanel('config'); }}>
          <span className="nav-icon">⚙️</span>
          <span>Config</span>
        </a>

        <div className="sidebar-section">Playground</div>
        <a className={`nav-item ${activePanel === 'tester' ? 'active' : ''}`} href="#tester" onClick={(e) => { e.preventDefault(); setActivePanel('tester'); }}>
          <span className="nav-icon">⚡</span>
          <span>Request Tester</span>
        </a>
        <a className={`nav-item ${activePanel === 'ws-tester' ? 'active' : ''}`} href="#ws-tester" onClick={(e) => { e.preventDefault(); setActivePanel('ws-tester'); }}>
          <span className="nav-icon">🔌</span>
          <span>WebSocket Tester</span>
        </a>
        <a className={`nav-item ${activePanel === 'playground' ? 'active' : ''}`} href="#playground" onClick={(e) => { e.preventDefault(); setActivePanel('playground'); }}>
          <span className="nav-icon">🧪</span>
          <span>SDK Playground</span>
        </a>

        <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
          <button onClick={handleLogout} className="nav-item" style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', justifyContent: 'flex-start' }}>
            <span className="nav-icon">🚪</span>
            <span>Logout</span>
          </button>
        </div>
      </nav>

      {/* Main Panel Content */}
      <main className="main" id="main-content">
        {loadingDiscovery && !discovery ? (
          <div className="loading" id="loading-state">
            <div className="spinner"></div>
            <span>Loading discovery data...</span>
          </div>
        ) : (
          <>
            {buildError && (
              <div className="error-banner" style={{ textAlign: 'left', whiteSpace: 'pre-wrap' }}>
                <strong>Build Failure:</strong><br />{buildError}
              </div>
            )}
            {reloadError && (
              <div className="error-banner" style={{ textAlign: 'left' }}>
                <strong>Reload Failure:</strong> {reloadError}
              </div>
            )}
            {renderPanelContent()}
          </>
        )}
      </main>

      {/* Source Code Debugger / Inspector Overlay Modal */}
      {sourceViewerFile && (
        <div id="source-viewer-overlay" className="modal-overlay active">
          <div className="card" style={{ width: '100%', maxWidth: '850px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', margin: 0, boxShadow: 'var(--shadow-md)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', padding: '16px 20px', textAlign: 'left' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div id="source-viewer-title" style={{ fontWeight: 700, fontSize: '16px', color: 'var(--text-primary)' }}>Source Code Inspector</div>
                <div id="source-viewer-filepath" style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {sourceViewerFile}:{sourceViewerLine}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button className="btn btn-secondary" id="ai-debug-btn" onClick={handleAiDebugClick} style={{ padding: '6px 12px', fontSize: '12px', margin: 0, display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(108, 92, 231, 0.08)', color: 'var(--accent)', borderColor: 'rgba(108, 92, 231, 0.2)' }}>
                  <span>✨</span> Debug with AI
                </button>
                <button className="btn btn-secondary" onClick={handleCloseSourceViewer} style={{ padding: '6px 12px', fontSize: '12px', margin: 0 }}>Close</button>
              </div>
            </div>
            <div id="source-viewer-content" style={{ flex: 1, overflow: 'auto', padding: '20px', fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: 1.5, background: 'var(--bg-primary)', borderBottomLeftRadius: 'var(--radius-lg)', borderBottomRightRadius: 'var(--radius-lg)' }}>
              {sourceViewerLines.map((line, i) => (
                <div key={i} className={`source-viewer-line ${line.isTarget ? 'target' : ''}`} style={{ display: 'flex', gap: '16px', padding: '2px 4px', textAlign: 'left' }}>
                  <div className="source-viewer-num" style={{ width: '40px', textAlign: 'right', color: 'var(--text-muted)', userSelect: 'none' }}>{line.num}</div>
                  <div className="source-viewer-text" style={{ flex: 1, whiteSpace: 'pre', overflowX: 'auto' }}>{line.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// SECURITY PANEL WIDGET
// ==========================================
interface SecurityPanelProps {
  discovery: DiscoveryData;
}
const SecurityPanel: React.FC<SecurityPanelProps> = ({ discovery }) => {
  const [data, setData] = useState<any | null>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    fetchSecurity();
  }, []);

  const fetchSecurity = async () => {
    try {
      const res = await apiFetch('/__studio/api/security');
      if (res.ok) {
        const payload = await res.json();
        setData(payload);
        if (payload.isProbing) {
          setTimeout(fetchSecurity, 1000);
        }
      }
    } catch {}
  };

  const handleProbe = async () => {
    setProbing(true);
    try {
      const res = await apiFetch('/__studio/api/security/probe', { method: 'POST' });
      if (res.ok) {
        setTimeout(fetchSecurity, 500);
      }
    } catch {
    } finally {
      setProbing(false);
    }
  };

  if (!data) {
    return (
      <div>
        <div className="panel-header">
          <div className="panel-title">Security Center</div>
          <div className="panel-subtitle">Static and dynamic security validation tests</div>
        </div>
        <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '12px' }}>Security data loading...</div>
      </div>
    );
  }

  const staticChecks = data.static || [];
  const dynamicChecks = data.dynamic || [];
  const totalFindings = staticChecks.length + dynamicChecks.length;

  return (
    <div>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div className="panel-title">Security Center</div>
          <div className="panel-subtitle">Static and dynamic security validation tests</div>
        </div>
        <button className="btn" onClick={handleProbe} disabled={probing || data.isProbing}>
          {probing || data.isProbing ? `Probing (${data.progress || 0}%)...` : 'Run Dynamic Probe'}
        </button>
      </div>

      {data.isProbing && (
        <div style={{ marginBottom: '20px', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px', color: 'var(--text-secondary)' }}>
            <span>Dynamic Vulnerability Scanning...</span>
            <span>{data.progress || 0}%</span>
          </div>
          <div className="metric-progress-container">
            <div className="metric-progress-bar success" style={{ width: `${data.progress || 0}%`, transition: 'width 0.3s ease' }} />
          </div>
        </div>
      )}

      <div className="info-grid" style={{ marginBottom: '24px' }}>
        <div className="info-card" style={{ margin: 0 }}>
          <div className="info-card-label">Static Rule Violations</div>
          <div className="info-card-value">{staticChecks.length}</div>
        </div>
        <div className="info-card" style={{ margin: 0 }}>
          <div className="info-card-label">Dynamic Probe Violations</div>
          <div className="info-card-value">{dynamicChecks.length}</div>
        </div>
        <div className="info-card" style={{ margin: 0 }}>
          <div className="info-card-label">Overall Security Grade</div>
          <div className="info-card-value" style={{ color: totalFindings > 2 ? 'var(--error)' : totalFindings > 0 ? 'var(--warning)' : 'var(--success)' }}>
            {totalFindings > 4 ? 'F' : totalFindings > 2 ? 'D' : totalFindings > 0 ? 'B' : 'A'}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', textAlign: 'left', flexWrap: 'wrap' }}>
        {/* Static audits */}
        <div className="tester-section">
          <div className="tester-section-title">🛡️ Static Rule Warnings</div>
          {staticChecks.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '12px' }}>No static violations detected. Excellent!</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {staticChecks.map((f: FindingItem) => (
                <div key={f.id} className={`finding-card severity-${f.severity} open`} style={{ margin: 0 }}>
                  <div className="finding-card-header" style={{ cursor: 'default' }}>
                    <span className="finding-card-status-icon">⚠️</span>
                    <span className="finding-card-title">{f.title}</span>
                  </div>
                  <div className="finding-card-body" style={{ display: 'block' }}>
                    {f.cwe && <div style={{ fontSize: '10px', color: 'var(--accent)', fontWeight: 700 }}>CWE: {f.cwe}</div>}
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{f.description}</div>
                    <div style={{ fontSize: '11px', marginTop: '6px', background: 'var(--bg-secondary)', padding: '6px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                      <strong>Fix:</strong> {f.remediation}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dynamic audits */}
        <div className="tester-section">
          <div className="tester-section-title">🕵️ Dynamic Attack Probe findings</div>
          {dynamicChecks.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '12px' }}>No dynamic probe vulnerabilities detected. Run a probe to check injection leaks.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {dynamicChecks.map((f: FindingItem) => (
                <div key={f.id} className="finding-card severity-fail open" style={{ margin: 0 }}>
                  <div className="finding-card-header" style={{ cursor: 'default' }}>
                    <span className="finding-card-status-icon">❌</span>
                    <span className="finding-card-title">{f.title}</span>
                  </div>
                  <div className="finding-card-body" style={{ display: 'block' }}>
                    {f.cwe && <div style={{ fontSize: '10px', color: 'var(--accent)', fontWeight: 700 }}>CWE: {f.cwe}</div>}
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{f.description}</div>
                    <div style={{ fontSize: '11px', marginTop: '6px', background: 'var(--bg-secondary)', padding: '6px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                      <strong>Fix:</strong> {f.remediation}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
