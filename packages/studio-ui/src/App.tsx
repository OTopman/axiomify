import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from './store/hooks';
import {
  setDiscoveryData,
  setDiscoveryError,
  setDiscoveryLoading,
} from './store/slices/discoverySlice';
import {
  addVariable,
  createEnvironment,
  deleteEnvironment,
  removeVariable,
  saveCurrentEnvironment,
  selectEnvironment,
  updateVariable,
} from './store/slices/environmentsSlice';
import {
  setActiveTab,
  setCommandPaletteOpen,
  setSidebarCollapsed,
  setTheme,
  toggleSidebar,
  toggleTheme,
} from './store/slices/uiSlice';
import {
  recordReload,
  setBuildError,
  setReloadError,
  setWsConnected,
} from './store/slices/websocketSlice';
import { apiFetch, getToken, removeToken, setToken } from './utils/api';
import { STUDIO_VERSION } from './version';

// Lucide Icons for authentic engineering tool aesthetics
import {
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  Boxes,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Cpu,
  Download,
  FileCode,
  GitFork,
  Globe,
  Heart,
  Layers,
  Lock,
  LogOut,
  Menu,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  Settings,
  Shield,
  Sliders,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
  Webhook,
  Wifi,
  X,
  Zap,
} from 'lucide-react';

// Components
import { Dashboard } from './components/Dashboard';
import { JobsPanel } from './components/JobsPanel';
import { Logs } from './components/Logs';
import {
  AiAssistantPanel,
  AnalyticsPanel,
  ArchitecturePanel,
  ConfigPanel,
  ContractsPanel,
  ErrorsPanel,
  EventsPanel,
  HealthPanel,
  HooksPanel,
  MiddlewaresPanel,
  OpenApiPanel,
  PerformancePanel,
  QualityPanel,
  SchemasPanel,
  SdkImpactPanel,
  ServicesPanel,
} from './components/OtherPanels';
import { Recorder } from './components/Recorder';
import { RouteSelector } from './components/RouteSelector';
import { SecurityPanel } from './components/SecurityPanel';
import { TracingPanel } from './components/Tracing';
import { WebSocketTester } from './components/WebSocketTester';

// Monaco is loaded lazily for fast startup
const Playground = lazy(() =>
  import('./components/Playground').then(({ Playground }) => ({
    default: Playground,
  })),
);
const RequestBuilder = lazy(() =>
  import('./components/RequestBuilder').then(({ RequestBuilder }) => ({
    default: RequestBuilder,
  })),
);

const editorFallback = (
  <div className="empty-state" style={{ minHeight: '300px' }}>
    <div
      className="spinner"
      style={{ width: '20px', height: '20px', borderWidth: '2px' }}
    />
    <span>Loading editor environment…</span>
  </div>
);

export function App() {
  const dispatch = useAppDispatch();
  const { activeTab, isDark, sidebarCollapsed, commandPaletteOpen } =
    useAppSelector((state) => state.ui);
  const discovery = useAppSelector((state) => state.discovery.data);
  const loadingDiscovery = useAppSelector((state) => state.discovery.loading);
  const { environments, selectedEnvironmentId, environmentVariables } =
    useAppSelector((state) => state.environments);
  const [envModalOpen, setEnvModalOpen] = useState(false);
  const [envCopiedKey, setEnvCopiedKey] = useState<string | null>(null);
  const [envSaveSuccess, setEnvSaveSuccess] = useState(false);
  const {
    connected: wsConnected,
    buildError,
    reloadError,
  } = useAppSelector((state) => state.websocket);

  const [token, setTokenState] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      setToken(urlToken);
      const nextParams = new URLSearchParams(window.location.search);
      nextParams.delete('token');
      const searchStr = nextParams.toString();
      const newUrl =
        window.location.pathname +
        (searchStr ? `?${searchStr}` : '') +
        window.location.hash;
      window.history.replaceState({}, document.title, newUrl);
      return urlToken;
    }
    return getToken();
  });

  const [loginInput, setLoginInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  // WebSocket Live Sync state
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  // Quick test prefill references
  const [prefilledMethod, setPrefilledMethod] = useState('');
  const [prefilledPath, setPrefilledPath] = useState('');
  const [prefilledWsPath, setPrefilledWsPath] = useState('');

  // Logs tracing
  const [filterRequestId, setFilterRequestId] = useState<string | null>(null);

  // Source Viewer Modal
  const [sourceViewerFile, setSourceViewerFile] = useState<string | null>(null);
  const [sourceViewerLine, setSourceViewerLine] = useState<number>(0);
  const [sourceViewerLines, setSourceViewerLines] = useState<
    { num: number; text: string; isTarget: boolean }[]
  >([]);

  // Export report dropdown
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Floating tooltip state for collapsed sidebar
  const [sidebarTooltip, setSidebarTooltip] = useState<{
    text: string;
    category?: string;
    badge?: string | number;
    top: number;
  } | null>(null);

  // Clear tooltip when sidebar collapses or expands
  useEffect(() => {
    setSidebarTooltip(null);
  }, [sidebarCollapsed]);

  // Dismiss tooltip on any global scroll or resize
  useEffect(() => {
    if (!sidebarTooltip) return;
    const hide = () => setSidebarTooltip(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [sidebarTooltip]);

  // Sync token and initial state
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      setToken(urlToken);
      setTokenState(urlToken);
      const nextParams = new URLSearchParams(window.location.search);
      nextParams.delete('token');
      const searchStr = nextParams.toString();
      const newUrl =
        window.location.pathname +
        (searchStr ? `?${searchStr}` : '') +
        window.location.hash;
      window.history.replaceState({}, document.title, newUrl);
    }

    const savedTheme = localStorage.getItem('axiomify_studio_theme');
    const initialDark = savedTheme ? savedTheme === 'dark' : true;
    dispatch(setTheme(initialDark));
    document.documentElement.setAttribute(
      'data-theme',
      initialDark ? 'dark' : 'light',
    );

    const handleUnauthorized = () => {
      handleLogout();
    };

    const handleFilterRequestId = (e: Event) => {
      const rid = (e as CustomEvent).detail;
      setFilterRequestId(rid);
      dispatch(setActiveTab('logs'));
    };

    window.addEventListener('axiomify-unauthorized', handleUnauthorized);
    window.addEventListener(
      'axiomify-filter-request-id',
      handleFilterRequestId,
    );

    if (token || urlToken) {
      loadDiscovery();
    }

    return () => {
      window.removeEventListener('axiomify-unauthorized', handleUnauthorized);
      window.removeEventListener(
        'axiomify-filter-request-id',
        handleFilterRequestId,
      );
    };
  }, []);

  // Global Keyboard Shortcuts (⌘K for command palette / route finder)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        dispatch(setCommandPaletteOpen(!commandPaletteOpen));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, dispatch]);

  // Collapse sidebar initially on mobile screens <= 768px
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      dispatch(setSidebarCollapsed(true));
    }
  }, [dispatch]);

  // Connect live reload WebSocket
  useEffect(() => {
    if (typeof window === 'undefined' || !token) return;

    const connectLiveWs = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/__studio/ws?token=${encodeURIComponent(token)}`;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          dispatch(setWsConnected(true));
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'reload') {
              loadDiscovery();
              dispatch(recordReload());
            } else if (msg.type === 'build_error') {
              dispatch(
                setBuildError(msg.error || 'Build failed during reload'),
              );
            } else if (msg.type === 'reload_error') {
              dispatch(
                setReloadError(
                  msg.error || 'Server error restarting application',
                ),
              );
            }
          } catch (err) {
            console.error('Failed to parse WS message:', err);
          }
        };

        ws.onclose = () => {
          dispatch(setWsConnected(false));
          reconnectTimeoutRef.current = setTimeout(connectLiveWs, 2000);
        };

        ws.onerror = () => {
          dispatch(setWsConnected(false));
        };
      } catch (err) {
        console.error('WebSocket connection error:', err);
        reconnectTimeoutRef.current = setTimeout(connectLiveWs, 2000);
      }
    };

    connectLiveWs();

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [token]);

  const loadDiscovery = async () => {
    dispatch(setDiscoveryLoading(true));
    try {
      const res = await apiFetch('/__studio/api/discovery');
      if (res.ok) {
        const data = await res.json();
        dispatch(setDiscoveryData(data));
      } else {
        dispatch(setDiscoveryError('Failed to fetch discovery metadata.'));
      }
    } catch (err) {
      console.error('Discovery fetch error:', err);
      dispatch(setDiscoveryError(String(err)));
    }
  };

  const handleLogin = async () => {
    setLoginError(null);
    if (!loginInput.trim()) {
      setLoginError('Token cannot be empty.');
      return;
    }
    setToken(loginInput.trim());
    try {
      const res = await apiFetch('/__studio/api/discovery');
      if (res.ok) {
        setTokenState(loginInput.trim());
        const data = await res.json();
        dispatch(setDiscoveryData(data));
      } else {
        setLoginError('Invalid access token.');
        removeToken();
      }
    } catch {
      setLoginError('Connection failed. Make sure the server is running.');
      removeToken();
    }
  };

  const handleLogout = () => {
    removeToken();
    setTokenState('');
  };

  const handleThemeToggle = () => {
    const nextDark = !isDark;
    dispatch(toggleTheme());
    localStorage.setItem('axiomify_studio_theme', nextDark ? 'dark' : 'light');
    document.documentElement.setAttribute(
      'data-theme',
      nextDark ? 'dark' : 'light',
    );
  };

  const triggerExportReport = (format: string) => {
    setExportMenuOpen(false);
    const currentToken = getToken();
    window.location.href = `/__studio/api/export/${format}?token=${encodeURIComponent(currentToken)}`;
  };

  const handleQuickTest = (m: string, p: string) => {
    setPrefilledMethod(m);
    setPrefilledPath(p);
    dispatch(setActiveTab('tester'));
  };

  const handleOpenWsTester = (p: string) => {
    setPrefilledWsPath(p);
    dispatch(setActiveTab('ws-tester'));
  };

  const handleOpenSourceViewer = async (
    filePath: string,
    lineNumber: number,
  ) => {
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
    const codeLines = sourceViewerLines.map((l) => l.text).join('\n');
    const prompt = `I got an error in the file ${sourceViewerFile} around line ${sourceViewerLine}.\nHere is the code context:\n\`\`\`typescript\n${codeLines}\n\`\`\`\n\nCan you analyze this code and tell me what is causing the error and how to fix it?`;

    handleCloseSourceViewer();
    dispatch(setActiveTab('ai'));

    setTimeout(() => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        textarea.value = prompt;
        const event = new Event('input', { bubbles: true });
        textarea.dispatchEvent(event);
      }
    }, 100);
  };

  // Render Panel content
  const renderPanelContent = () => {
    if (!discovery) return null;

    switch (activeTab) {
      case 'routes':
        return (
          <Dashboard
            discovery={discovery}
            onQuickTest={handleQuickTest}
            onOpenWsTester={handleOpenWsTester}
            onInspectCode={handleOpenSourceViewer}
          />
        );
      case 'schemas':
        return <SchemasPanel discovery={discovery} />;
      case 'openapi':
        return <OpenApiPanel discovery={discovery} />;
      case 'services':
        return <ServicesPanel discovery={discovery} />;
      case 'middlewares':
        return <MiddlewaresPanel discovery={discovery} />;
      case 'events':
        return <EventsPanel discovery={discovery} />;
      case 'architecture':
        return <ArchitecturePanel discovery={discovery} />;
      case 'hooks':
        return <HooksPanel discovery={discovery} />;
      case 'logs':
        return (
          <Logs
            filterRequestId={filterRequestId}
            onClearFilter={() => setFilterRequestId(null)}
          />
        );
      case 'errors':
        return <ErrorsPanel discovery={discovery} />;
      case 'analytics':
        return <AnalyticsPanel />;
      case 'recorder':
        return (
          <Recorder
            onReplay={(m, p) => handleQuickTest(m, p)}
            onInspectCode={handleOpenSourceViewer}
          />
        );
      case 'performance':
        return <PerformancePanel />;
      case 'tracing':
        return <TracingPanel />;
      case 'jobs':
        return <JobsPanel discovery={discovery} />;
      case 'sdk-impact':
        return <SdkImpactPanel discovery={discovery} />;
      case 'health':
        return <HealthPanel discovery={discovery} />;
      case 'security':
        return <SecurityPanel discovery={discovery} />;
      case 'contracts':
        return <ContractsPanel />;
      case 'quality':
        return <QualityPanel />;
      case 'ai':
        return <AiAssistantPanel isDark={isDark} />;
      case 'config':
        return <ConfigPanel discovery={discovery} />;
      case 'tester':
        return (
          <Suspense fallback={editorFallback}>
            <RequestBuilder
              discovery={discovery}
              isDark={isDark}
              prefilledMethod={prefilledMethod}
              prefilledPath={prefilledPath}
              onClearPrefill={() => {
                setPrefilledMethod('');
                setPrefilledPath('');
              }}
            />
          </Suspense>
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
        return (
          <Suspense fallback={editorFallback}>
            <Playground discovery={discovery} isDark={isDark} />
          </Suspense>
        );
      default:
        return (
          <div className="empty-state">
            <Sliders size={24} />
            <span>Panel "{activeTab}" is active</span>
          </div>
        );
    }
  };

  if (!token) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: 'var(--bg-primary)',
          padding: '20px',
        }}
      >
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
            padding: '32px',
            width: '100%',
            maxWidth: '400px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: '18px',
              margin: '0 auto 16px',
              boxShadow: '0 0 20px rgba(99, 102, 241, 0.35)',
            }}
          >
            A
          </div>
          <h2
            style={{
              fontSize: '18px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '8px',
            }}
          >
            Axiomify Studio
          </h2>
          <p
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '20px',
            }}
          >
            Enter the access token printed in your terminal to unlock the API
            explorer.
          </p>
          <input
            type="password"
            className="text-input"
            style={{ marginBottom: '12px' }}
            placeholder="Paste access token..."
            value={loginInput}
            onChange={(e) => setLoginInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
          <button
            className="btn btn-primary"
            style={{ width: '100%', padding: '8px 16px' }}
            onClick={handleLogin}
          >
            Access Studio
          </button>
          {loginError && (
            <div
              className="error-banner"
              style={{ marginTop: '14px', textAlign: 'left' }}
            >
              {loginError}
            </div>
          )}
        </div>
      </div>
    );
  }

  const hookTotal = discovery?.hooks?.reduce((s, h) => s + h.count, 0) || 0;
  const currentEnv = environments.find((e) => e.id === selectedEnvironmentId);

  // Breadcrumb label mapping
  const TAB_LABELS: Record<string, { group: string; name: string }> = {
    tester: { group: 'API Client', name: 'Request Tester' },
    'ws-tester': { group: 'API Client', name: 'WebSocket Tester' },
    playground: { group: 'API Client', name: 'SDK Playground' },
    routes: { group: 'Discovery & Docs', name: 'Routes & Endpoints' },
    openapi: { group: 'Discovery & Docs', name: 'OpenAPI 3.1 Spec' },
    schemas: { group: 'Discovery & Docs', name: 'Schema Definitions' },
    contracts: { group: 'Discovery & Docs', name: 'API Contracts' },
    services: { group: 'System Architecture', name: 'Registered Services' },
    middlewares: { group: 'System Architecture', name: 'Middleware Pipeline' },
    architecture: { group: 'System Architecture', name: 'Architecture Graph' },
    events: { group: 'System Architecture', name: 'Events & Listeners' },
    hooks: { group: 'System Architecture', name: 'Framework Hooks' },
    logs: { group: 'Observability', name: 'Live Logs' },
    errors: { group: 'Observability', name: 'Errors & Panics' },
    analytics: { group: 'Observability', name: 'Realtime Analytics' },
    performance: { group: 'Observability', name: 'Performance Profiler' },
    tracing: { group: 'Observability', name: 'Distributed Tracing' },
    recorder: { group: 'Observability', name: 'Traffic Recorder' },
    health: { group: 'Observability', name: 'System Health' },
    security: { group: 'Observability', name: 'Security Audit' },
    jobs: { group: 'Tooling & Governance', name: 'Background Jobs' },
    'sdk-impact': { group: 'Tooling & Governance', name: 'SDK Impact' },
    quality: { group: 'Tooling & Governance', name: 'Quality & Governance' },
    ai: { group: 'Tooling & Governance', name: 'AI Architecture Assistant' },
    config: { group: 'Tooling & Governance', name: 'Configuration' },
  };

  const breadcrumb = TAB_LABELS[activeTab] || {
    group: 'Studio',
    name: activeTab,
  };

  const handleSidebarMouseOver = (e: React.MouseEvent) => {
    if (!sidebarCollapsed) return;
    const target = (e.target as HTMLElement).closest(
      '[data-tooltip]',
    ) as HTMLElement | null;
    if (target) {
      const text = target.getAttribute('data-tooltip');
      if (text) {
        const category =
          target.getAttribute('data-tooltip-category') || undefined;
        const badge = target.getAttribute('data-tooltip-badge') || undefined;
        const rect = target.getBoundingClientRect();
        setSidebarTooltip({
          text,
          category,
          badge,
          top: rect.top + rect.height / 2,
        });
        return;
      }
    }
    setSidebarTooltip(null);
  };

  const handleSidebarFocusCapture = (e: React.FocusEvent) => {
    if (!sidebarCollapsed) return;
    const target = (e.target as HTMLElement).closest(
      '[data-tooltip]',
    ) as HTMLElement | null;
    if (target) {
      const text = target.getAttribute('data-tooltip');
      if (text) {
        const category =
          target.getAttribute('data-tooltip-category') || undefined;
        const badge = target.getAttribute('data-tooltip-badge') || undefined;
        const rect = target.getBoundingClientRect();
        setSidebarTooltip({
          text,
          category,
          badge,
          top: rect.top + rect.height / 2,
        });
      }
    }
  };

  const handleSidebarBlurCapture = () => {
    if (sidebarCollapsed) {
      setSidebarTooltip(null);
    }
  };

  const handleNavClick = (tab: string) => {
    dispatch(setActiveTab(tab as any));
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      if (!sidebarCollapsed) {
        dispatch(toggleSidebar());
      }
    }
  };

  return (
    <div
      className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
    >
      {/* ── Top Header ────────────────────────────────────────────── */}
      <header className="header">
        <div className="header-left">
          {/* Mobile Navigation Drawer Toggle */}
          <button
            className="mobile-menu-btn"
            onClick={() => dispatch(toggleSidebar())}
            aria-label={
              sidebarCollapsed
                ? 'Open navigation menu'
                : 'Close navigation menu'
            }
            title="Toggle navigation"
          >
            <Menu size={16} />
          </button>

          <div className="header-title-container">
            <span className="header-subtitle">{breadcrumb.group}</span>
            <ChevronRight size={14} className="header-separator" />
            <span className="header-title">{breadcrumb.name}</span>
          </div>

          {/* Command Palette Trigger */}
          <button
            className="command-palette-trigger"
            onClick={() => dispatch(setCommandPaletteOpen(true))}
            title="Search routes, commands, and schemas (⌘K)"
          >
            <Search size={13} />
            <span>Search routes, commands...</span>
            <kbd style={{ marginLeft: 'auto' }}>⌘K</kbd>
          </button>
        </div>

        <div className="header-right">
          {/* Active Environment Selector & Variables Manager */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Globe size={13} style={{ color: 'var(--text-muted)' }} />
            {environments.length > 0 && (
              <select
                className="select-input"
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  background: 'var(--bg-primary)',
                  borderColor: 'var(--border)',
                  minWidth: '110px',
                }}
                value={selectedEnvironmentId}
                onChange={(e) => dispatch(selectEnvironment(e.target.value))}
                title="Active Environment"
              >
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name} ({env.variables?.length || 0} vars)
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
              onClick={() => setEnvModalOpen(true)}
              title="Manage environment variables & interpolation values"
            >
              <Sliders size={12} style={{ color: 'var(--accent)' }} />
              <span>Variables</span>
            </button>
          </div>

          {/* Connection Status */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              color: wsConnected ? 'var(--success)' : 'var(--text-muted)',
              padding: '4px 8px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <span
              className="status-dot"
              style={{
                background: wsConnected
                  ? 'var(--success)'
                  : 'var(--text-muted)',
                boxShadow: wsConnected
                  ? '0 0 8px rgba(16, 185, 129, 0.4)'
                  : 'none',
              }}
            />
            <span>{wsConnected ? 'Live' : 'Offline'}</span>
          </div>

          {/* Export Report Dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-secondary"
              style={{ padding: '5px 9px', fontSize: '11px' }}
              onClick={() => setExportMenuOpen(!exportMenuOpen)}
            >
              <Download size={13} />
              <span>Export</span>
              <ChevronDown size={11} />
            </button>
            {exportMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '115%',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  boxShadow: 'var(--shadow-md)',
                  zIndex: 100,
                  minWidth: '150px',
                  overflow: 'hidden',
                }}
              >
                <button
                  className="btn btn-ghost"
                  style={{
                    width: '100%',
                    justifyContent: 'flex-start',
                    borderRadius: 0,
                    padding: '8px 12px',
                    fontSize: '12px',
                  }}
                  onClick={() => triggerExportReport('html')}
                >
                  HTML Report (.html)
                </button>
                <button
                  className="btn btn-ghost"
                  style={{
                    width: '100%',
                    justifyContent: 'flex-start',
                    borderRadius: 0,
                    padding: '8px 12px',
                    fontSize: '12px',
                    borderTop: '1px solid var(--border)',
                  }}
                  onClick={() => triggerExportReport('pdf')}
                >
                  PDF Report (.pdf)
                </button>
                <button
                  className="btn btn-ghost"
                  style={{
                    width: '100%',
                    justifyContent: 'flex-start',
                    borderRadius: 0,
                    padding: '8px 12px',
                    fontSize: '12px',
                    borderTop: '1px solid var(--border)',
                  }}
                  onClick={() => triggerExportReport('markdown')}
                >
                  Markdown (.md)
                </button>
              </div>
            )}
          </div>

          {/* Theme Toggle Button */}
          <button
            className="btn btn-ghost"
            style={{ padding: '6px' }}
            onClick={handleThemeToggle}
            title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </header>

      {/* Mobile Drawer Backdrop */}
      <div
        className={`sidebar-backdrop ${!sidebarCollapsed ? 'active' : ''}`}
        onClick={() => dispatch(toggleSidebar())}
        aria-hidden="true"
      />

      {/* ── Sidebar Navigation ────────────────────────────────────── */}
      <nav
        className="sidebar"
        onMouseOver={handleSidebarMouseOver}
        onMouseLeave={() => setSidebarTooltip(null)}
        onScroll={() => setSidebarTooltip(null)}
        onFocusCapture={handleSidebarFocusCapture}
        onBlurCapture={handleSidebarBlurCapture}
      >
        <div className="sidebar-header">
          <div
            className="sidebar-brand-wrapper"
            data-tooltip="Axiomify Studio"
            aria-label="Axiomify Studio"
          >
            <div className="sidebar-logo">A</div>
            {!sidebarCollapsed && (
              <>
                <span className="brand-name">Axiomify</span>
                <span
                  className="nav-badge"
                  style={{ padding: '1px 5px', fontSize: '9px' }}
                >
                  v{STUDIO_VERSION}
                </span>
              </>
            )}
          </div>
          <button
            className="sidebar-collapse-btn"
            onClick={() => dispatch(toggleSidebar())}
            data-tooltip={
              sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
            }
            aria-label={
              sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
            }
            title={!sidebarCollapsed ? 'Collapse sidebar' : undefined}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={13} />
            ) : (
              <PanelLeftClose size={13} />
            )}
          </button>
        </div>

        {/* Global Quick Search trigger */}
        {!sidebarCollapsed && (
          <div className="sidebar-search-container">
            <button
              className="sidebar-search-btn"
              onClick={() => dispatch(setCommandPaletteOpen(true))}
              title="Search routes, schemas, and commands (⌘K)"
            >
              <Search size={12} />
              <span>Quick find...</span>
              <kbd>⌘K</kbd>
            </button>
          </div>
        )}

        <div className="sidebar-nav">
          {/* Group 1: API Client */}
          {!sidebarCollapsed && (
            <div className="sidebar-section">API Client</div>
          )}
          <button
            className={`nav-item ${activeTab === 'tester' ? 'active' : ''}`}
            onClick={() => handleNavClick('tester')}
            data-tooltip="Request Tester"
            data-tooltip-category="API Client"
            aria-label="Request Tester"
          >
            <span className="nav-icon">
              <Send size={13} />
            </span>
            {!sidebarCollapsed && <span>Request Tester</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'ws-tester' ? 'active' : ''}`}
            onClick={() => handleNavClick('ws-tester')}
            data-tooltip="WebSocket Tester"
            data-tooltip-category="API Client"
            data-tooltip-badge={
              (discovery?.routes?.filter((r) => r.isWs).length || 0) > 0
                ? discovery?.routes?.filter((r) => r.isWs).length
                : undefined
            }
            aria-label="WebSocket Tester"
          >
            <span className="nav-icon">
              <Wifi size={13} />
            </span>
            {!sidebarCollapsed && <span>WebSocket Tester</span>}
            {!sidebarCollapsed && discovery && (
              <span className="nav-badge">
                {discovery.routes?.filter((r) => r.isWs).length || 0}
              </span>
            )}
          </button>
          <button
            className={`nav-item ${activeTab === 'playground' ? 'active' : ''}`}
            onClick={() => handleNavClick('playground')}
            data-tooltip="SDK Playground"
            data-tooltip-category="API Client"
            aria-label="SDK Playground"
          >
            <span className="nav-icon">
              <Play size={13} />
            </span>
            {!sidebarCollapsed && <span>SDK Playground</span>}
          </button>

          {/* Group 2: Specifications & Docs */}
          {!sidebarCollapsed && (
            <div className="sidebar-section">Discovery & Docs</div>
          )}
          <button
            className={`nav-item ${activeTab === 'routes' ? 'active' : ''}`}
            onClick={() => handleNavClick('routes')}
            data-tooltip="Routes Index"
            data-tooltip-category="Discovery & Docs"
            data-tooltip-badge={
              (discovery?.routes?.filter((r) => !r.isWs).length || 0) > 0
                ? discovery?.routes?.filter((r) => !r.isWs).length
                : undefined
            }
            aria-label="Routes Index"
          >
            <span className="nav-icon">
              <Layers size={13} />
            </span>
            {!sidebarCollapsed && <span>Routes Index</span>}
            {!sidebarCollapsed && discovery && (
              <span className="nav-badge">
                {discovery.routes?.filter((r) => !r.isWs).length || 0}
              </span>
            )}
          </button>
          <button
            className={`nav-item ${activeTab === 'openapi' ? 'active' : ''}`}
            onClick={() => handleNavClick('openapi')}
            data-tooltip="OpenAPI Spec"
            data-tooltip-category="Discovery & Docs"
            aria-label="OpenAPI Spec"
          >
            <span className="nav-icon">
              <BookOpen size={13} />
            </span>
            {!sidebarCollapsed && <span>OpenAPI Spec</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'schemas' ? 'active' : ''}`}
            onClick={() => handleNavClick('schemas')}
            data-tooltip="Schemas"
            data-tooltip-category="Discovery & Docs"
            data-tooltip-badge={
              (discovery?.schemas?.length || 0) > 0
                ? discovery?.schemas?.length
                : undefined
            }
            aria-label="Schemas"
          >
            <span className="nav-icon">
              <FileCode size={13} />
            </span>
            {!sidebarCollapsed && <span>Schemas</span>}
            {!sidebarCollapsed && discovery && (
              <span className="nav-badge">
                {discovery.schemas?.length || 0}
              </span>
            )}
          </button>
          <button
            className={`nav-item ${activeTab === 'contracts' ? 'active' : ''}`}
            onClick={() => handleNavClick('contracts')}
            data-tooltip="Contracts"
            data-tooltip-category="Discovery & Docs"
            aria-label="Contracts"
          >
            <span className="nav-icon">
              <CheckSquare size={13} />
            </span>
            {!sidebarCollapsed && <span>Contracts</span>}
          </button>

          {/* Group 4: Architecture */}
          {!sidebarCollapsed && (
            <div className="sidebar-section">Architecture</div>
          )}
          <button
            className={`nav-item ${activeTab === 'services' ? 'active' : ''}`}
            onClick={() => handleNavClick('services')}
            data-tooltip="Services"
            data-tooltip-category="Architecture"
            data-tooltip-badge={
              (discovery?.services?.length || 0) > 0
                ? discovery?.services?.length
                : undefined
            }
            aria-label="Services"
          >
            <span className="nav-icon">
              <Cpu size={13} />
            </span>
            {!sidebarCollapsed && <span>Services</span>}
            {!sidebarCollapsed && discovery && (
              <span className="nav-badge">
                {discovery.services?.length || 0}
              </span>
            )}
          </button>
          <button
            className={`nav-item ${activeTab === 'middlewares' ? 'active' : ''}`}
            onClick={() => handleNavClick('middlewares')}
            data-tooltip="Middlewares"
            data-tooltip-category="Architecture"
            data-tooltip-badge={
              (discovery?.middlewares?.length || 0) > 0
                ? discovery?.middlewares?.length
                : undefined
            }
            aria-label="Middlewares"
          >
            <span className="nav-icon">
              <Shield size={13} />
            </span>
            {!sidebarCollapsed && <span>Middlewares</span>}
            {!sidebarCollapsed && discovery && (
              <span className="nav-badge">
                {discovery.middlewares?.length || 0}
              </span>
            )}
          </button>
          <button
            className={`nav-item ${activeTab === 'architecture' ? 'active' : ''}`}
            onClick={() => handleNavClick('architecture')}
            data-tooltip="Architecture Map"
            data-tooltip-category="Architecture"
            aria-label="Architecture Map"
          >
            <span className="nav-icon">
              <Network size={13} />
            </span>
            {!sidebarCollapsed && <span>Architecture Map</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'events' ? 'active' : ''}`}
            onClick={() => handleNavClick('events')}
            data-tooltip="Events"
            data-tooltip-category="Architecture"
            data-tooltip-badge={
              (discovery?.events?.length || 0) > 0
                ? discovery?.events?.length
                : undefined
            }
            aria-label="Events"
          >
            <span className="nav-icon">
              <Activity size={13} />
            </span>
            {!sidebarCollapsed && <span>Events</span>}
            {!sidebarCollapsed && discovery && (
              <span className="nav-badge">{discovery.events?.length || 0}</span>
            )}
          </button>
          <button
            className={`nav-item ${activeTab === 'hooks' ? 'active' : ''}`}
            onClick={() => handleNavClick('hooks')}
            data-tooltip="Hooks"
            data-tooltip-category="Architecture"
            data-tooltip-badge={hookTotal > 0 ? hookTotal : undefined}
            aria-label="Hooks"
          >
            <span className="nav-icon">
              <Webhook size={13} />
            </span>
            {!sidebarCollapsed && <span>Hooks</span>}
            {!sidebarCollapsed && discovery && (
              <span className="nav-badge">{hookTotal}</span>
            )}
          </button>

          {/* Group 5: Observability & Telemetry (Option 3 Metrics Hub) */}
          {!sidebarCollapsed && (
            <div className="sidebar-section">Observability</div>
          )}
          <button
            className={`nav-item ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => handleNavClick('logs')}
            data-tooltip="Live Logs"
            data-tooltip-category="Observability"
            aria-label="Live Logs"
          >
            <span className="nav-icon">
              <Terminal size={13} />
            </span>
            {!sidebarCollapsed && <span>Live Logs</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'errors' ? 'active' : ''}`}
            onClick={() => handleNavClick('errors')}
            data-tooltip="Errors"
            data-tooltip-category="Observability"
            data-tooltip-badge={
              (discovery?.errors?.length || 0) > 0
                ? discovery?.errors?.length
                : undefined
            }
            aria-label="Errors"
          >
            <span className="nav-icon">
              <AlertTriangle size={13} />
            </span>
            {!sidebarCollapsed && <span>Errors</span>}
            {!sidebarCollapsed && discovery && (
              <span className="nav-badge">{discovery.errors?.length || 0}</span>
            )}
          </button>
          <button
            className={`nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => handleNavClick('analytics')}
            data-tooltip="Analytics"
            data-tooltip-category="Observability"
            aria-label="Analytics"
          >
            <span className="nav-icon">
              <BarChart3 size={13} />
            </span>
            {!sidebarCollapsed && <span>Analytics</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'performance' ? 'active' : ''}`}
            onClick={() => handleNavClick('performance')}
            data-tooltip="Performance"
            data-tooltip-category="Observability"
            aria-label="Performance"
          >
            <span className="nav-icon">
              <Zap size={13} />
            </span>
            {!sidebarCollapsed && <span>Performance</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'tracing' ? 'active' : ''}`}
            onClick={() => handleNavClick('tracing')}
            data-tooltip="Distributed Tracing"
            data-tooltip-category="Observability"
            aria-label="Distributed Tracing"
          >
            <span className="nav-icon">
              <GitFork size={13} />
            </span>
            {!sidebarCollapsed && <span>Distributed Tracing</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'recorder' ? 'active' : ''}`}
            onClick={() => handleNavClick('recorder')}
            data-tooltip="Traffic Recorder"
            data-tooltip-category="Observability"
            aria-label="Traffic Recorder"
          >
            <span className="nav-icon">
              <Radio size={13} />
            </span>
            {!sidebarCollapsed && <span>Traffic Recorder</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'health' ? 'active' : ''}`}
            onClick={() => handleNavClick('health')}
            data-tooltip="System Health"
            data-tooltip-category="Observability"
            aria-label="System Health"
          >
            <span className="nav-icon">
              <Heart size={13} />
            </span>
            {!sidebarCollapsed && <span>System Health</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => handleNavClick('security')}
            data-tooltip="Security Audit"
            data-tooltip-category="Observability"
            aria-label="Security Audit"
          >
            <span className="nav-icon">
              <Lock size={13} />
            </span>
            {!sidebarCollapsed && <span>Security Audit</span>}
          </button>

          {/* Group 6: Tooling & Governance */}
          {!sidebarCollapsed && (
            <div className="sidebar-section">Tooling & Quality</div>
          )}
          <button
            className={`nav-item ${activeTab === 'jobs' ? 'active' : ''}`}
            onClick={() => handleNavClick('jobs')}
            data-tooltip="Background Jobs"
            data-tooltip-category="Tooling & Quality"
            aria-label="Background Jobs"
          >
            <span className="nav-icon">
              <Clock size={13} />
            </span>
            {!sidebarCollapsed && <span>Background Jobs</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'sdk-impact' ? 'active' : ''}`}
            onClick={() => handleNavClick('sdk-impact')}
            data-tooltip="SDK Impact"
            data-tooltip-category="Tooling & Quality"
            aria-label="SDK Impact"
          >
            <span className="nav-icon">
              <Boxes size={13} />
            </span>
            {!sidebarCollapsed && <span>SDK Impact</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'quality' ? 'active' : ''}`}
            onClick={() => handleNavClick('quality')}
            data-tooltip="Quality & Governance"
            data-tooltip-category="Tooling & Quality"
            aria-label="Quality & Governance"
          >
            <span className="nav-icon">
              <Award size={13} />
            </span>
            {!sidebarCollapsed && <span>Quality & Governance</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'ai' ? 'active' : ''}`}
            onClick={() => handleNavClick('ai')}
            data-tooltip="AI Assistant"
            data-tooltip-category="Tooling & Quality"
            aria-label="AI Assistant"
          >
            <span className="nav-icon">
              <Sparkles size={13} />
            </span>
            {!sidebarCollapsed && <span>AI Assistant</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'config' ? 'active' : ''}`}
            onClick={() => handleNavClick('config')}
            data-tooltip="Configuration"
            data-tooltip-category="Tooling & Quality"
            aria-label="Configuration"
          >
            <span className="nav-icon">
              <Settings size={13} />
            </span>
            {!sidebarCollapsed && <span>Configuration</span>}
          </button>
        </div>

        <div className="sidebar-footer">
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            data-tooltip={
              wsConnected
                ? 'Connected to Axiomify Server'
                : 'Offline / Disconnected'
            }
            aria-label={
              wsConnected
                ? 'Connected to Axiomify Server'
                : 'Offline / Disconnected'
            }
          >
            <span
              className="status-dot"
              style={{
                width: '6px',
                height: '6px',
                background: wsConnected
                  ? 'var(--success)'
                  : 'var(--text-muted)',
              }}
            />
            {!sidebarCollapsed && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {wsConnected ? 'Connected' : 'Offline'}
              </span>
            )}
          </div>
          <button
            className="btn btn-ghost"
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              color: 'var(--text-muted)',
            }}
            onClick={handleLogout}
            data-tooltip="Log out of Studio"
            aria-label="Log out of Studio"
            title={!sidebarCollapsed ? 'Log out of Studio' : undefined}
          >
            <LogOut size={13} />
            {!sidebarCollapsed && <span>Logout</span>}
          </button>
        </div>

        {/* Floating tooltip for collapsed sidebar */}
        {sidebarCollapsed && sidebarTooltip && (
          <div
            className="sidebar-floating-tooltip"
            style={{ top: `${sidebarTooltip.top}px` }}
          >
            {sidebarTooltip.category && (
              <span className="sidebar-tooltip-category">
                {sidebarTooltip.category}
              </span>
            )}
            <span className="sidebar-tooltip-text">{sidebarTooltip.text}</span>
            {sidebarTooltip.badge !== undefined && (
              <span className="sidebar-tooltip-badge">
                {sidebarTooltip.badge}
              </span>
            )}
          </div>
        )}
      </nav>

      {/* ── Main Content Area ────────────────────────────────────── */}
      <main className="main" id="main-content">
        {loadingDiscovery && !discovery ? (
          <div className="empty-state" style={{ height: '100%' }}>
            <div
              className="spinner"
              style={{ width: '24px', height: '24px', borderWidth: '2px' }}
            />
            <span>Discovering routes, schemas, and services...</span>
          </div>
        ) : (
          <>
            {buildError && (
              <div className="error-banner" style={{ margin: '16px' }}>
                <strong>Build Failure:</strong>
                <pre
                  style={{
                    marginTop: '6px',
                    fontSize: '11px',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {buildError}
                </pre>
              </div>
            )}
            {reloadError && (
              <div className="error-banner" style={{ margin: '16px' }}>
                <strong>Reload Failure:</strong> {reloadError}
              </div>
            )}
            {renderPanelContent()}
          </>
        )}
      </main>

      {/* ── Global Command Palette / Route Launcher Modal ─────────── */}
      {commandPaletteOpen && discovery && (
        <RouteSelector
          routes={discovery.routes || []}
          selectedMethod={prefilledMethod || 'GET'}
          selectedPath={prefilledPath || ''}
          openapi={discovery.openapi}
          defaultOpen={true}
          onClose={() => dispatch(setCommandPaletteOpen(false))}
          onSelectRoute={(m, p) => {
            dispatch(setCommandPaletteOpen(false));
            handleQuickTest(m, p);
          }}
        />
      )}

      {/* ── Source Code Debugger / Inspector Modal ───────────────── */}
      {sourceViewerFile && (
        <div className="modal-overlay" onClick={handleCloseSourceViewer}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '850px' }}
          >
            <div className="pane-header">
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
              >
                <span style={{ fontWeight: 600 }}>Source Code Inspector</span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                  }}
                >
                  {sourceViewerFile}:{sourceViewerLine}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '4px 8px', fontSize: '11px' }}
                  onClick={handleAiDebugClick}
                >
                  <Sparkles size={12} />
                  <span>Explain with AI</span>
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '4px' }}
                  onClick={handleCloseSourceViewer}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div
              style={{
                padding: '16px',
                overflowY: 'auto',
                maxHeight: '70vh',
                background: 'var(--bg-primary)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  lineHeight: 1.6,
                }}
              >
                {sourceViewerLines.map((line) => (
                  <div
                    key={line.num}
                    style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '1px 4px',
                      background: line.isTarget
                        ? 'rgba(239, 68, 68, 0.12)'
                        : 'transparent',
                      borderLeft: line.isTarget
                        ? '3px solid var(--error)'
                        : '3px solid transparent',
                    }}
                  >
                    <span
                      style={{
                        width: '36px',
                        textAlign: 'right',
                        color: 'var(--text-muted)',
                        userSelect: 'none',
                      }}
                    >
                      {line.num}
                    </span>
                    <pre
                      style={{
                        margin: 0,
                        color: line.isTarget
                          ? 'var(--error)'
                          : 'var(--text-primary)',
                      }}
                    >
                      {line.text}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Environment Variables Manager Modal ─────────────────── */}
      {envModalOpen && (
        <div className="modal-overlay" onClick={() => setEnvModalOpen(false)}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '640px' }}
          >
            <div className="pane-header">
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <Sliders size={14} style={{ color: 'var(--accent)' }} />
                <div>
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>
                    Environment Variables
                  </span>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Interpolate values anywhere via{' '}
                    <code
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--accent-text)',
                      }}
                    >
                      {'{{variable}}'}
                    </code>{' '}
                    syntax
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '4px' }}
                onClick={() => setEnvModalOpen(false)}
              >
                <X size={14} />
              </button>
            </div>

            <div
              style={{
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                overflowY: 'auto',
                maxHeight: '65vh',
              }}
            >
              {/* Environment Switcher & Actions */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                  }}
                >
                  Active Environment:
                </span>
                <select
                  className="select-input"
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    minWidth: '140px',
                  }}
                  value={selectedEnvironmentId}
                  onChange={(e) => dispatch(selectEnvironment(e.target.value))}
                >
                  {environments.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 8px', fontSize: '11px' }}
                  onClick={() => {
                    const name = window.prompt(
                      'Environment Name (e.g. Staging, Production):',
                    );
                    if (name?.trim()) {
                      dispatch(createEnvironment(name.trim()));
                    }
                  }}
                >
                  <Plus size={11} />
                  <span>New Env</span>
                </button>
                {environments.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{
                      padding: '4px 8px',
                      fontSize: '11px',
                      color: 'var(--error)',
                    }}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete environment "${currentEnv?.name}"?`,
                        )
                      ) {
                        dispatch(deleteEnvironment(selectedEnvironmentId));
                      }
                    }}
                    title="Delete current environment"
                  >
                    <Trash2 size={12} />
                    <span>Delete</span>
                  </button>
                )}
              </div>

              {/* Variable Key-Value Editor Table */}
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                }}
              >
                <table className="env-variable-table">
                  <thead>
                    <tr style={{ background: 'var(--bg-primary)' }}>
                      <th style={{ width: '42%' }}>Variable Name</th>
                      <th>Value</th>
                      <th style={{ width: '64px', textAlign: 'center' }}>
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {environmentVariables.length === 0 ? (
                      <tr>
                        <td
                          colSpan={3}
                          style={{
                            textAlign: 'center',
                            padding: '24px 12px',
                            color: 'var(--text-muted)',
                          }}
                        >
                          No variables defined for{' '}
                          <strong>
                            {currentEnv?.name || 'this environment'}
                          </strong>
                          .
                          <div style={{ marginTop: '8px' }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '3px 8px', fontSize: '11px' }}
                              onClick={() => dispatch(addVariable())}
                            >
                              <Plus size={11} />
                              <span>Add first variable</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      environmentVariables.map((v, idx) => (
                        <tr
                          key={idx}
                          style={{ background: 'var(--bg-secondary)' }}
                        >
                          <td>
                            <input
                              type="text"
                              className="text-input"
                              placeholder="e.g. baseUrl or token"
                              style={{
                                width: '100%',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '11px',
                                padding: '4px 8px',
                              }}
                              value={v.key}
                              onChange={(e) =>
                                dispatch(
                                  updateVariable({
                                    index: idx,
                                    key: e.target.value,
                                  }),
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="text-input"
                              placeholder="e.g. http://localhost:3000"
                              style={{
                                width: '100%',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '11px',
                                padding: '4px 8px',
                              }}
                              value={v.value}
                              onChange={(e) =>
                                dispatch(
                                  updateVariable({
                                    index: idx,
                                    value: e.target.value,
                                  }),
                                )
                              }
                            />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px',
                              }}
                            >
                              {v.key.trim() && (
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  style={{
                                    padding: '3px',
                                    color: 'var(--text-muted)',
                                  }}
                                  title={`Copy {{${v.key}}}`}
                                  onClick={() => {
                                    navigator.clipboard.writeText(
                                      `{{${v.key.trim()}}}`,
                                    );
                                    setEnvCopiedKey(v.key);
                                    setTimeout(
                                      () => setEnvCopiedKey(null),
                                      1500,
                                    );
                                  }}
                                >
                                  {envCopiedKey === v.key ? (
                                    <Check
                                      size={12}
                                      style={{ color: 'var(--success)' }}
                                    />
                                  ) : (
                                    <Copy size={12} />
                                  )}
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{
                                  padding: '3px',
                                  color: 'var(--text-muted)',
                                }}
                                onClick={() => dispatch(removeVariable(idx))}
                                title="Remove variable"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Add Variable & Auto Suggestions Tip */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '11px' }}
                  onClick={() => dispatch(addVariable())}
                >
                  <Plus size={12} />
                  <span>Add Variable</span>
                </button>

                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Tip: Type{' '}
                  <kbd style={{ padding: '1px 4px', fontSize: '10px' }}>
                    {'{{'}
                  </kbd>{' '}
                  in request paths or body for auto-completion
                </div>
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '10px 16px',
                borderTop: '1px solid var(--border)',
                background: 'var(--bg-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: '8px',
              }}
            >
              {envSaveSuccess && (
                <span
                  style={{
                    fontSize: '11px',
                    color: 'var(--success)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    marginRight: 'auto',
                  }}
                >
                  <Check size={12} />
                  <span>Variables saved successfully</span>
                </span>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '5px 12px', fontSize: '11px' }}
                onClick={() => setEnvModalOpen(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '5px 14px', fontSize: '11px' }}
                onClick={() => {
                  dispatch(saveCurrentEnvironment());
                  setEnvSaveSuccess(true);
                  setTimeout(() => setEnvSaveSuccess(false), 2000);
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
