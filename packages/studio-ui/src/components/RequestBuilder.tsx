import Editor from '@monaco-editor/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppSelector } from '../store/hooks';
import { DiscoveryData } from '../types';
import { apiFetch } from '../utils/api';
import {
  collectAvailableVariables,
  type AvailableVariable,
} from '../utils/environment-intellisense';
import { configureMonacoSandbox } from '../utils/monaco-intellisense';
import {
  createStudioId,
  loadRequestCollections,
  saveRequestCollections,
  substituteRequestVariables,
  type RequestCollection,
  type SavedRequest,
} from '../utils/request-collections';
import {
  executeScriptSandbox,
  SCRIPT_SNIPPETS,
  type TestAssertion,
} from '../utils/script-sandbox';
import { CollectionRunner } from './CollectionRunner';
import { RouteSelector } from './RouteSelector';
import { VariableInput } from './VariableInput';

// Lucide Icons
import {
  Activity,
  AlertCircle,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Database,
  Download,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  History,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  XCircle,
  Zap,
} from 'lucide-react';

interface RequestBuilderProps {
  discovery: DiscoveryData;
  isDark?: boolean;
  prefilledMethod?: string;
  prefilledPath?: string;
  onClearPrefill?: () => void;
}

interface KeyVal {
  key: string;
  value: string;
  enabled?: boolean;
}

interface UploadFile {
  field: string;
  name: string;
  type: string;
  contentBase64: string;
}

export interface PreRequestExecutionResult {
  success: boolean;
  durationMs: number;
  executedAt: string;
  logs: string[];
  mutatedHeaders?: Record<string, string>;
  mutatedParams?: Record<string, string>;
  mutatedEnv?: Record<string, string>;
  error?: string;
}

type BodyMode = 'none' | 'json' | 'text' | 'form-data' | 'urlencoded';
type ActiveSubTab =
  | 'params'
  | 'headers'
  | 'body'
  | 'auth'
  | 'prerequest'
  | 'tests'
  | 'uploads'
  | 'code';
type SubSidebarTab = 'routes' | 'collections' | 'history';
type ResponseSubTab = 'body' | 'headers' | 'tests' | 'waterfall' | 'queries';
type AuthType = 'none' | 'bearer' | 'basic' | 'apikey';
type MobilePane = 'routes' | 'request' | 'response';

const BODY_MODE_OPTIONS: Array<{ value: BodyMode; label: string }> = [
  { value: 'none', label: 'none' },
  { value: 'json', label: 'raw JSON' },
  { value: 'text', label: 'raw text' },
  { value: 'form-data', label: 'form-data' },
  { value: 'urlencoded', label: 'x-www-form-urlencoded' },
];

function formatDuration(value: unknown, decimals = 1): string {
  const duration = Number(value);
  return Number.isFinite(duration) ? `${duration.toFixed(decimals)} ms` : '—';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const RequestBuilder: React.FC<RequestBuilderProps> = ({
  discovery,
  isDark = true,
  prefilledMethod = '',
  prefilledPath = '',
  onClearPrefill,
}) => {
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('');
  const [queryParams, setQueryParams] = useState<KeyVal[]>([]);
  const [pathParams, setPathParams] = useState<KeyVal[]>([]);
  const [headers, setHeaders] = useState<KeyVal[]>([
    { key: 'Content-Type', value: 'application/json' },
  ]);
  const [reqBody, setReqBody] = useState('');
  const [bodyMode, setBodyMode] = useState<BodyMode>('json');
  const [bodyFields, setBodyFields] = useState<KeyVal[]>([]);
  const [uploads, setUploads] = useState<UploadFile[]>([]);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<any | null>(null);
  const [replays, setReplays] = useState<any[]>([]);
  const [, setExpandedTimelineItem] = useState<number | null>(null);

  // Tabs state
  const [activeSubTab, setActiveSubTab] = useState<ActiveSubTab>('params');
  const [responseSubTab, setResponseSubTab] = useState<ResponseSubTab>('body');
  const [mobilePane, setMobilePane] = useState<MobilePane>('request');

  // Script Sandbox state
  const [preRequestScript, setPreRequestScript] = useState('');
  const [testScript, setTestScript] = useState('');
  const [preRequestResults, setPreRequestResults] =
    useState<PreRequestExecutionResult | null>(null);
  const [scriptTestResults, setScriptTestResults] = useState<{
    success: boolean;
    tests: TestAssertion[];
    logs: string[];
    error?: string;
  } | null>(null);

  // Auth state
  const [authType, setAuthType] = useState<AuthType>('none');
  const [bearerToken, setBearerToken] = useState('{{token}}');
  const [basicUser, setBasicUser] = useState('');
  const [basicPass, setBasicPass] = useState('');
  const [apiKeyName, setApiKeyName] = useState('X-API-Key');
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [apiKeyLocation, setApiKeyLocation] = useState<'header' | 'query'>(
    'header',
  );

  // Code generator language
  const [codeLang, setCodeLang] = useState<
    'curl' | 'fetch' | 'axios' | 'python' | 'go'
  >('curl');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);

  // Route selector popover/modal
  const [routePickerOpen, setRoutePickerOpen] = useState(false);

  // Route Sub-Sidebar State
  const [routesSidebarCollapsed, setRoutesSidebarCollapsed] = useState(false);
  const [routeSearch, setRouteSearch] = useState('');
  const [routeMethodFilter, setRouteMethodFilter] = useState('ALL');
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({
    Auth: true,
    Users: true,
    Tasks: true,
    General: true,
    Metrics: true,
    Graphql: true,
    Checkout: true,
    'Secure-data': true,
  });

  const toggleFolder = (name: string) => {
    setOpenFolders((prev) => ({
      ...prev,
      [name]: prev[name] === undefined ? false : !prev[name],
    }));
  };

  // Collections (LocalStorage backed)
  const [collections, setCollections] = useState<RequestCollection[]>(() =>
    loadRequestCollections(),
  );
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [subSidebarTab, setSubSidebarTab] = useState<SubSidebarTab>('routes');
  const [collectionSearch, setCollectionSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [runnerModalOpen, setRunnerModalOpen] = useState(false);
  const [runnerTargetCollectionId, setRunnerTargetCollectionId] =
    useState<string>('');
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [savingRequest, setSavingRequest] = useState(false);
  const [newRequestName, setNewRequestName] = useState('');

  // Redux Environments
  const { environments, selectedEnvironmentId } = useAppSelector(
    (state) => state.environments,
  );

  const totalSavedRequests = useMemo(
    () => collections.reduce((acc, c) => acc + (c.requests?.length || 0), 0),
    [collections],
  );

  // Disposables
  const monacoDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);

  // Auto-select first collection if available
  useEffect(() => {
    if (!selectedCollectionId && collections.length > 0) {
      setSelectedCollectionId(collections[0].id);
    }
  }, [collections, selectedCollectionId]);

  const availableVariables = useMemo(
    () =>
      collectAvailableVariables(
        environments,
        selectedEnvironmentId,
        discovery.env,
      ),
    [environments, selectedEnvironmentId, discovery.env],
  );

  const availableVariablesRef = useRef<AvailableVariable[]>(availableVariables);
  availableVariablesRef.current = availableVariables;

  // Selected route schema
  const activeRoute = useMemo(() => {
    return (
      discovery.routes?.find(
        (r) =>
          r.method.toUpperCase() === method.toUpperCase() && r.path === path,
      ) || null
    );
  }, [discovery.routes, method, path]);

  // Categorize routes by primary tag or path prefix (Option 1 folder style)
  const routeCategories = useMemo(() => {
    if (!discovery?.routes) return [];
    const groups: Record<string, typeof discovery.routes> = {};
    for (const r of discovery.routes) {
      if (r.isWs) continue; // WebSocket routes belong in WebSocketTester
      let cat = 'General';
      if (r.tags && r.tags.length > 0) {
        cat = r.tags[0];
      } else {
        const parts = r.path.split('/').filter(Boolean);
        if (parts.length > 0) {
          const p =
            parts[0] === 'api' && parts.length > 1 ? parts[1] : parts[0];
          cat = p.charAt(0).toUpperCase() + p.slice(1);
        }
      }
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(r);
    }
    return Object.entries(groups).map(([name, routes]) => ({ name, routes }));
  }, [discovery.routes]);

  // Filtered categories according to routeSearch and routeMethodFilter
  const filteredCategories = useMemo(() => {
    const q = routeSearch.trim().toLowerCase();
    const methodTarget = routeMethodFilter.toUpperCase();

    return routeCategories
      .map((cat) => {
        const matchingRoutes = cat.routes.filter((r) => {
          if (
            methodTarget !== 'ALL' &&
            r.method.toUpperCase() !== methodTarget
          ) {
            return false;
          }
          if (!q) return true;
          return (
            r.path.toLowerCase().includes(q) ||
            r.method.toLowerCase().includes(q) ||
            (r.summary && r.summary.toLowerCase().includes(q)) ||
            (r.tags && r.tags.some((t) => t.toLowerCase().includes(q)))
          );
        });
        return { name: cat.name, routes: matchingRoutes };
      })
      .filter((cat) => cat.routes.length > 0);
  }, [routeCategories, routeSearch, routeMethodFilter]);

  const totalHttpRoutes = useMemo(
    () => (discovery.routes || []).filter((r) => !r.isWs).length,
    [discovery.routes],
  );

  // Global Keyboard Shortcut: ⌘+Enter to Send
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSendRequest();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Load replays list on mount
  useEffect(() => {
    fetchReplays();

    const handleReplaysUpdated = () => {
      fetchReplays();
    };
    window.addEventListener('axiomify-replays-updated', handleReplaysUpdated);
    return () => {
      window.removeEventListener(
        'axiomify-replays-updated',
        handleReplaysUpdated,
      );
    };
  }, []);

  useEffect(
    () => () => {
      monacoDisposablesRef.current.forEach((d) => d.dispose());
      monacoDisposablesRef.current = [];
    },
    [],
  );

  // Handle pre-fill from quick test click
  useEffect(() => {
    if (prefilledMethod && prefilledPath) {
      setMethod(prefilledMethod);
      setPath(prefilledPath);
      prefillFromRoute(prefilledMethod, prefilledPath);
      if (onClearPrefill) onClearPrefill();
    }
  }, [prefilledMethod, prefilledPath]);

  const fetchReplays = async () => {
    try {
      const res = await apiFetch('/__studio/api/request/replays');
      if (res.ok) {
        const data = await res.json();
        const history = data.history || data.replays || [];
        setReplays([...history].reverse());
      }
    } catch (err) {
      console.error('Failed to fetch request replays:', err);
    }
  };

  const clearAllReplays = async () => {
    if (!confirm('Are you sure you want to clear request history?')) return;
    try {
      const res = await apiFetch('/__studio/api/request/replays', {
        method: 'DELETE',
      });
      if (res.ok) {
        setReplays([]);
      }
    } catch (err) {
      console.error('Failed to clear replays:', err);
    }
  };

  const generateMockData = (keyName: string, schema: any): any => {
    if (!schema) return null;
    const lowerKey = keyName.toLowerCase();

    if (schema.type === 'object' && schema.properties) {
      const obj: Record<string, any> = {};
      for (const [k, prop] of Object.entries(schema.properties)) {
        obj[k] = generateMockData(k, prop);
      }
      return obj;
    }
    if (schema.type === 'array') {
      return [generateMockData(keyName, schema.items)];
    }
    if (schema.type === 'string') {
      if (lowerKey.includes('email')) {
        return `user.${Math.floor(Math.random() * 1000)}@axiomify.dev`;
      }
      if (lowerKey.includes('name')) {
        if (lowerKey.includes('first')) return 'Alex';
        if (lowerKey.includes('last')) return 'Rivera';
        return 'Alex Rivera';
      }
      if (lowerKey.includes('uuid') || lowerKey.includes('id')) {
        return '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
      }
      if (lowerKey.includes('phone') || lowerKey.includes('tel')) {
        return '+1-555-0199';
      }
      if (
        lowerKey.includes('date') ||
        lowerKey.includes('time') ||
        lowerKey.includes('at')
      ) {
        return new Date().toISOString();
      }
      if (schema.enum && schema.enum.length > 0) {
        return schema.enum[0];
      }
      return schema.description || 'Sample string';
    }
    if (schema.type === 'number' || schema.type === 'integer') {
      if (lowerKey.includes('price')) return 29.99;
      if (lowerKey.includes('quantity') || lowerKey.includes('count')) return 5;
      return 42;
    }
    if (schema.type === 'boolean') {
      return true;
    }
    return null;
  };

  const getPathParamsList = (pathStr: string): string[] => {
    const matches: string[] = [];
    const colonRegex = /:([a-zA-Z0-9_]+)/g;
    let match;
    while ((match = colonRegex.exec(pathStr)) !== null) {
      matches.push(match[1]);
    }
    const braceRegex = /{([a-zA-Z0-9_]+)}/g;
    while ((match = braceRegex.exec(pathStr)) !== null) {
      matches.push(match[1]);
    }
    return Array.from(new Set(matches));
  };

  const prefillFromRoute = (m: string, p: string) => {
    const schema = discovery.schemas.find(
      (s) => s.method === m && s.path === p,
    );

    // Fill request body
    if (schema && schema.body) {
      const template = generateMockData('body', schema.body);
      setBodyMode('json');
      setReqBody(JSON.stringify(template, null, 2));
    }

    // Fill query parameters
    if (schema && schema.query && schema.query.properties) {
      const props = schema.query.properties;
      const q: KeyVal[] = Object.keys(props).map((k) => {
        const val = generateMockData(k, props[k]);
        return {
          key: k,
          value: val !== null ? String(val) : '',
        };
      });
      setQueryParams(q);
    } else {
      setQueryParams([]);
    }

    // Fill path parameters
    const parsedParams = getPathParamsList(p);
    const paramsList: KeyVal[] = parsedParams.map((paramName) => {
      const paramSchema = schema?.params?.properties?.[paramName];
      const val = generateMockData(
        paramName,
        paramSchema || { type: 'string' },
      );
      return {
        key: paramName,
        value: val !== null ? String(val) : '',
      };
    });
    setPathParams(paramsList);
    setMobilePane('request');
  };

  const applySavedRequest = (request: SavedRequest) => {
    setMethod(request.method);
    setPath(request.path);
    setQueryParams(request.queryParams || []);
    setPathParams(request.pathParams || []);
    setHeaders(request.headers || []);
    setBodyMode(request.bodyMode || 'none');
    setReqBody(request.body || '');
    setBodyFields(request.bodyFields || []);
    setPreRequestScript(request.preRequestScript || '');
    setTestScript(request.testScript || '');
    setScriptTestResults(null);
    setPreRequestResults(null);
    setUploads([]);
    setMobilePane('request');
  };

  const handleStartCreateCollection = () => {
    setNewCollectionName('Smoke Tests');
    setCreatingCollection(true);
    setSavingRequest(false);
  };

  const handleCommitCreateCollection = () => {
    const name = newCollectionName.trim();
    if (!name) return;
    const collection: RequestCollection = {
      id: createStudioId('collection'),
      name,
      requests: [],
    };
    const next = [...collections, collection];
    setCollections(next);
    saveRequestCollections(next);
    setSelectedCollectionId(collection.id);
    setCreatingCollection(false);
    setNewCollectionName('');
  };

  const handleStartSaveRequest = () => {
    if (collections.length === 0) {
      handleStartCreateCollection();
      return;
    }
    setNewRequestName(`${method} ${path || '/'}`);
    setSavingRequest(true);
    setCreatingCollection(false);
  };

  const handleCommitSaveRequest = () => {
    const name = newRequestName.trim() || `${method} ${path || '/'}`;
    const targetColId =
      selectedCollectionId || (collections.length > 0 ? collections[0].id : '');
    if (!targetColId) {
      alert('Create or select a collection first.');
      return;
    }
    const saved: SavedRequest = {
      id: createStudioId('request'),
      name,
      method,
      path: path || '/',
      queryParams,
      pathParams,
      headers,
      bodyMode,
      body: reqBody,
      bodyFields,
      preRequestScript: preRequestScript.trim() ? preRequestScript : undefined,
      testScript: testScript.trim() ? testScript : undefined,
    };
    const next = collections.map((col) =>
      col.id === targetColId
        ? { ...col, requests: [...col.requests, saved] }
        : col,
    );
    setCollections(next);
    saveRequestCollections(next);
    setSavingRequest(false);
    setNewRequestName('');
  };

  const createCollection = handleStartCreateCollection;
  const saveCurrentRequest = handleStartSaveRequest;

  const deleteSavedRequest = (requestId: string) => {
    const next = collections.map((collection) =>
      collection.id === selectedCollectionId
        ? {
            ...collection,
            requests: collection.requests.filter(
              (request) => request.id !== requestId,
            ),
          }
        : collection,
    );
    setCollections(next);
    saveRequestCollections(next);
  };

  const deleteCollection = (collectionId: string) => {
    if (!window.confirm('Delete this collection and all its saved requests?'))
      return;
    const next = collections.filter((c) => c.id !== collectionId);
    setCollections(next);
    saveRequestCollections(next);
    if (selectedCollectionId === collectionId) {
      setSelectedCollectionId(next.length > 0 ? next[0].id : '');
    }
  };

  const handleReplayClick = async (replay: any) => {
    setMethod(replay.method);
    setPath(replay.path);
    setPathParams([]);

    const q: KeyVal[] = [];
    if (replay.query) {
      Object.entries(replay.query).forEach(([k, v]) => {
        q.push({ key: k, value: String(v) });
      });
    }
    setQueryParams(q);

    const h: KeyVal[] = [];
    if (replay.headers) {
      Object.entries(replay.headers).forEach(([k, v]) => {
        h.push({ key: k, value: String(v) });
      });
    }
    setHeaders(h);

    if (replay.body) {
      setBodyMode('json');
      setReqBody(
        typeof replay.body === 'string'
          ? replay.body
          : JSON.stringify(replay.body, null, 2),
      );
    }

    try {
      const res = await apiFetch(
        `/__studio/api/request/replay?id=${encodeURIComponent(replay.id)}`,
      );
      if (res.ok) {
        const fullItem = await res.json();
        if (fullItem.response) {
          setResponse(fullItem.response);
          setExpandedTimelineItem(null);
          setMobilePane('response');
        }
      }
    } catch (e) {
      console.error('Failed to load full replay details:', e);
    }
  };

  const handleSendRequest = async () => {
    if (!path.trim()) {
      alert('Please enter a request path or select a route.');
      return;
    }

    setSending(true);
    setExpandedTimelineItem(null);
    const resolveVariables = (value: string) =>
      substituteRequestVariables(value, availableVariablesRef.current);

    const query: Record<string, string> = {};
    queryParams.forEach((q) => {
      if (q.enabled === false) return;
      const key = resolveVariables(q.key).trim();
      if (key) query[key] = resolveVariables(q.value).trim();
    });

    const hdrs: Record<string, string> = {};
    headers.forEach((h) => {
      if (h.enabled === false) return;
      const key = resolveVariables(h.key).trim();
      if (key) hdrs[key] = resolveVariables(h.value).trim();
    });

    // Apply Auth headers / params
    if (authType === 'bearer' && bearerToken.trim()) {
      hdrs['Authorization'] = `Bearer ${resolveVariables(bearerToken).trim()}`;
    } else if (authType === 'basic' && (basicUser || basicPass)) {
      const credentials = `${resolveVariables(basicUser)}:${resolveVariables(basicPass)}`;
      hdrs['Authorization'] = `Basic ${btoa(credentials)}`;
    } else if (
      authType === 'apikey' &&
      apiKeyName.trim() &&
      apiKeyValue.trim()
    ) {
      if (apiKeyLocation === 'header') {
        hdrs[resolveVariables(apiKeyName).trim()] =
          resolveVariables(apiKeyValue).trim();
      } else {
        query[resolveVariables(apiKeyName).trim()] =
          resolveVariables(apiKeyValue).trim();
      }
    }

    let body: any = undefined;
    if (bodyMode === 'json' && reqBody.trim()) {
      try {
        body = JSON.parse(resolveVariables(reqBody).trim());
      } catch (err: any) {
        alert('Invalid JSON request body: ' + err.message);
        setSending(false);
        return;
      }
    } else if (bodyMode === 'text' && reqBody) {
      body = resolveVariables(reqBody);
    } else if (bodyMode === 'form-data' || bodyMode === 'urlencoded') {
      body = bodyFields.reduce<Record<string, string>>((fields, field) => {
        if (field.enabled === false) return fields;
        const key = resolveVariables(field.key).trim();
        if (key) fields[key] = resolveVariables(field.value);
        return fields;
      }, {});
    }

    let finalPath = resolveVariables(path).trim();
    pathParams.forEach((p) => {
      const key = resolveVariables(p.key).trim();
      if (key) {
        finalPath = finalPath
          .replace(`:${key}`, resolveVariables(p.value).trim())
          .replace(`{${key}}`, resolveVariables(p.value).trim());
      }
    });

    const accumulatedLogs: string[] = [];
    let executedPreResult: any = null;

    // Pre-request script execution
    if (preRequestScript.trim()) {
      const activeEnvMap: Record<string, string> = {};
      availableVariablesRef.current.forEach((v) => {
        if (v.key) activeEnvMap[v.key] = v.value;
      });

      const preResult = await executeScriptSandbox(preRequestScript, {
        request: {
          url: finalPath,
          method,
          headers: hdrs,
          body,
          params: query,
        },
        environment: activeEnvMap,
      });

      executedPreResult = preResult;
      setPreRequestResults({
        success: preResult.success,
        durationMs: preResult.durationMs,
        executedAt: new Date().toLocaleTimeString(),
        logs: preResult.logs,
        mutatedHeaders: preResult.mutatedRequest?.headers,
        mutatedParams: preResult.mutatedRequest?.params,
        mutatedEnv: preResult.mutatedEnv,
        error: preResult.error,
      });

      if (preResult.mutatedRequest) {
        if (preResult.mutatedRequest.headers) {
          Object.assign(hdrs, preResult.mutatedRequest.headers);
        }
        if (preResult.mutatedRequest.params) {
          Object.assign(query, preResult.mutatedRequest.params);
        }
        if (preResult.mutatedRequest.body !== undefined) {
          body = preResult.mutatedRequest.body;
        }
      }

      if (preResult.logs.length > 0) {
        accumulatedLogs.push(...preResult.logs);
      }
    } else {
      setPreRequestResults(null);
    }

    try {
      const startTime = performance.now();
      const res = await apiFetch('/__studio/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method,
          path: finalPath,
          headers: hdrs,
          query,
          body,
          bodyMode,
          files: uploads,
        }),
      });

      const clientLatency = performance.now() - startTime;
      const result = await res.json();
      setSending(false);
      fetchReplays();

      if (result.error) {
        setResponse({
          status: 'ERROR',
          body: result.error + (result.message ? ': ' + result.message : ''),
          headers: {},
          clientLatency,
        });
        setMobilePane('response');
        return;
      }

      setResponse({ ...result, clientLatency });
      setMobilePane('response');

      // Post-response test script execution
      if (testScript.trim()) {
        const activeEnvMap: Record<string, string> = {};
        availableVariablesRef.current.forEach((v) => {
          if (v.key) activeEnvMap[v.key] = v.value;
        });

        const testResult = await executeScriptSandbox(testScript, {
          request: {
            url: finalPath,
            method,
            headers: hdrs,
            body,
            params: query,
          },
          response: {
            status: result.status,
            statusText: result.statusText || 'OK',
            headers: result.headers || {},
            responseTime: result.duration || clientLatency,
            data: result.body,
          },
          environment: activeEnvMap,
        });

        setScriptTestResults({
          success: testResult.success,
          tests: testResult.tests,
          logs: [...accumulatedLogs, ...testResult.logs],
          error: testResult.error,
        });

        // Automatically switch to tests tab if assertions were evaluated or error occurred
        if (
          testResult.tests.length > 0 ||
          testResult.error ||
          executedPreResult?.error
        ) {
          setResponseSubTab('tests');
        }
      } else {
        setScriptTestResults(null);
        if (executedPreResult?.error) {
          setResponseSubTab('tests');
        }
      }
    } catch (err: any) {
      setSending(false);
      setResponse({
        status: 'ERROR',
        body: 'Network error sending request: ' + err.message,
        headers: {},
      });
    }
  };

  const handleCopyResponse = () => {
    if (!response) return;
    const content =
      response.status === 'ERROR'
        ? response.body
        : typeof response.body === 'object'
          ? JSON.stringify(response.body, null, 2)
          : String(response.body || '');
    navigator.clipboard.writeText(content);
    setCopiedResponse(true);
    setTimeout(() => setCopiedResponse(false), 2000);
  };

  const handleDownloadResponse = () => {
    if (!response) return;
    const content =
      response.status === 'ERROR'
        ? response.body
        : typeof response.body === 'object'
          ? JSON.stringify(response.body, null, 2)
          : String(response.body || '');
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `response-${method}-${path.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Generate code snippet
  const generatedCode = useMemo(() => {
    const resolveVariables = (value: string) =>
      substituteRequestVariables(value, availableVariablesRef.current);

    let finalPath = resolveVariables(path).trim() || '/';
    pathParams.forEach((p) => {
      const key = resolveVariables(p.key).trim();
      if (key) {
        finalPath = finalPath
          .replace(`:${key}`, resolveVariables(p.value).trim())
          .replace(`{${key}}`, resolveVariables(p.value).trim());
      }
    });

    const queryString = queryParams
      .filter((q) => q.enabled !== false && q.key.trim())
      .map(
        (q) =>
          `${encodeURIComponent(resolveVariables(q.key))}=${encodeURIComponent(resolveVariables(q.value))}`,
      )
      .join('&');
    const fullUrl = `http://localhost:3000${finalPath}${queryString ? `?${queryString}` : ''}`;

    const hdrsObj: Record<string, string> = {};
    headers
      .filter((h) => h.enabled !== false && h.key.trim())
      .forEach((h) => {
        hdrsObj[resolveVariables(h.key).trim()] = resolveVariables(
          h.value,
        ).trim();
      });

    switch (codeLang) {
      case 'curl': {
        let cmd = `curl -X ${method} "${fullUrl}"`;
        Object.entries(hdrsObj).forEach(([k, v]) => {
          cmd += ` \\\n  -H "${k}: ${v}"`;
        });
        if (bodyMode === 'json' && reqBody.trim()) {
          cmd += ` \\\n  -d '${reqBody.replace(/'/g, "'\\''")}'`;
        }
        return cmd;
      }
      case 'fetch': {
        const opts: any = { method, headers: hdrsObj };
        if (bodyMode === 'json' && reqBody.trim()) {
          opts.body = reqBody;
        }
        return `const res = await fetch("${fullUrl}", ${JSON.stringify(opts, null, 2)});
const data = await res.json();
console.log(data);`;
      }
      case 'axios': {
        return `import axios from 'axios';

const res = await axios({
  method: '${method.toLowerCase()}',
  url: '${fullUrl}',
  headers: ${JSON.stringify(hdrsObj, null, 2)},
  ${bodyMode === 'json' && reqBody.trim() ? `data: ${reqBody}` : ''}
});
console.log(res.data);`;
      }
      case 'python': {
        return `import requests

url = "${fullUrl}"
headers = ${JSON.stringify(hdrsObj, null, 2)}
${bodyMode === 'json' && reqBody.trim() ? `payload = ${reqBody}\nresponse = requests.${method.toLowerCase()}(url, headers=headers, json=payload)` : `response = requests.${method.toLowerCase()}(url, headers=headers)`}

print(response.status_code)
print(response.json())`;
      }
      case 'go': {
        return `package main

import (
  "fmt"
  "net/http"
  "io"
)

func main() {
  req, err := http.NewRequest("${method}", "${fullUrl}", nil)
  if err != nil {
    panic(err)
  }
  ${Object.entries(hdrsObj)
    .map(([k, v]) => `req.Header.Set("${k}", "${v}")`)
    .join('\n  ')}

  client := &http.Client{}
  resp, err := client.Do(req)
  if err != nil {
    panic(err)
  }
  defer resp.Body.Close()

  body, _ := io.ReadAll(resp.Body)
  fmt.Println(string(body))
}`;
      }
    }
  }, [
    method,
    path,
    pathParams,
    queryParams,
    headers,
    bodyMode,
    reqBody,
    codeLang,
  ]);

  // Methods pills
  const METHOD_OPTIONS = [
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'PATCH',
    'HEAD',
    'OPTIONS',
  ];

  return (
    <div
      className={`request-tester-layout ${routesSidebarCollapsed ? 'routes-collapsed' : ''} mobile-pane-${mobilePane}`}
    >
      {/* Mobile Top Segmented Switcher (Routes | Request | Response) */}
      <div className="mobile-tester-nav">
        <button
          type="button"
          className={`mobile-tester-nav-btn ${mobilePane === 'routes' ? 'active' : ''}`}
          onClick={() => {
            setRoutesSidebarCollapsed(false);
            setMobilePane('routes');
          }}
        >
          <Layers size={13} />
          <span>Routes</span>
          <span className="mobile-tester-badge">{totalHttpRoutes}</span>
        </button>
        <button
          type="button"
          className={`mobile-tester-nav-btn ${mobilePane === 'request' ? 'active' : ''}`}
          onClick={() => setMobilePane('request')}
        >
          <Send size={13} />
          <span>Request</span>
          <span className={`mini-method-badge ${method.toLowerCase()}`}>
            {method}
          </span>
        </button>
        <button
          type="button"
          className={`mobile-tester-nav-btn ${mobilePane === 'response' ? 'active' : ''}`}
          onClick={() => setMobilePane('response')}
        >
          <Activity size={13} />
          <span>Response</span>
          {response && (
            <span
              className="mobile-tester-badge"
              style={{
                background:
                  typeof response.status === 'number' && response.status < 400
                    ? 'rgba(16, 185, 129, 0.15)'
                    : 'rgba(239, 68, 68, 0.15)',
                color:
                  typeof response.status === 'number' && response.status < 400
                    ? 'var(--success)'
                    : 'var(--error)',
              }}
            >
              {response.status}
            </span>
          )}
        </button>
      </div>

      {/* ── SUB-SIDEBAR: Routes, Collections & History ─────────── */}
      {(!routesSidebarCollapsed || mobilePane === 'routes') && (
        <aside className="request-routes-sidebar">
          {/* Header Segmented Tabs (Routes | Collections | History) */}
          <div className="routes-sidebar-tabs">
            <button
              type="button"
              className={`sub-sidebar-tab ${subSidebarTab === 'routes' ? 'active' : ''}`}
              onClick={() => setSubSidebarTab('routes')}
              title="Browse discovered API routes"
            >
              <Layers size={12} />
              <span>Routes</span>
              <span className="sub-sidebar-badge">{totalHttpRoutes}</span>
            </button>
            <button
              type="button"
              className={`sub-sidebar-tab ${subSidebarTab === 'collections' ? 'active' : ''}`}
              onClick={() => setSubSidebarTab('collections')}
              title="Saved request collections"
            >
              <Folder size={12} />
              <span>Collections</span>
              {totalSavedRequests > 0 && (
                <span className="sub-sidebar-badge">{totalSavedRequests}</span>
              )}
            </button>
            <button
              type="button"
              className={`sub-sidebar-tab ${subSidebarTab === 'history' ? 'active' : ''}`}
              onClick={() => setSubSidebarTab('history')}
              title="Recent request history"
            >
              <History size={12} />
              <span>History</span>
              {replays.length > 0 && (
                <span className="sub-sidebar-badge">{replays.length}</span>
              )}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{
                padding: '3px 5px',
                color: 'var(--text-muted)',
                height: 'auto',
                marginLeft: 'auto',
              }}
              onClick={() => {
                setRoutesSidebarCollapsed(true);
                setMobilePane('request');
              }}
              title="Collapse sub-sidebar"
            >
              <PanelLeftClose size={13} />
            </button>
          </div>

          {/* 1. Routes View */}
          {subSidebarTab === 'routes' && (
            <>
              {/* Search Input & Method Filter Pills */}
              <div className="routes-sidebar-search">
                <div style={{ position: 'relative', width: '100%' }}>
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
                    placeholder="Filter routes..."
                    value={routeSearch}
                    onChange={(e) => setRouteSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '5px 24px 5px 26px',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                  />
                  {routeSearch && (
                    <button
                      type="button"
                      onClick={() => setRouteSearch('')}
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

                {/* Method filter pills: ALL, GET, POST, PUT, DEL */}
                <div style={{ display: 'flex', gap: '3px' }}>
                  {(['ALL', 'GET', 'POST', 'PUT', 'DELETE'] as const).map(
                    (m) => {
                      const label = m === 'DELETE' ? 'DEL' : m;
                      return (
                        <button
                          key={m}
                          type="button"
                          className={`method-filter-pill ${routeMethodFilter === m ? 'active' : ''}`}
                          onClick={() => setRouteMethodFilter(m)}
                        >
                          {label}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>

              {/* Folders & Routes Tree List */}
              <div className="routes-sidebar-list">
                {filteredCategories.length === 0 ? (
                  <div
                    style={{
                      padding: '24px 12px',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '11px',
                    }}
                  >
                    <p style={{ margin: '0 0 8px 0' }}>No routes found.</p>
                    {(routeSearch || routeMethodFilter !== 'ALL') && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '10px' }}
                        onClick={() => {
                          setRouteSearch('');
                          setRouteMethodFilter('ALL');
                        }}
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                ) : (
                  filteredCategories.map((cat) => {
                    const isOpen = openFolders[cat.name] ?? true;
                    return (
                      <div key={cat.name} style={{ marginBottom: '4px' }}>
                        {/* Folder Header */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleFolder(cat.name)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleFolder(cat.name);
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '5px 8px',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: 'var(--text-secondary)',
                            userSelect: 'none',
                            transition: 'background var(--transition)',
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background =
                              'var(--bg-hover)')
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = 'transparent')
                          }
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            {isOpen ? (
                              <FolderOpen
                                size={13}
                                style={{ color: 'var(--accent)' }}
                              />
                            ) : (
                              <Folder
                                size={13}
                                style={{ color: 'var(--text-muted)' }}
                              />
                            )}
                            <span>{cat.name}</span>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '9px',
                                fontFamily: 'var(--font-mono)',
                                padding: '0 5px',
                                borderRadius: '8px',
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-muted)',
                              }}
                            >
                              {cat.routes.length}
                            </span>
                            {isOpen ? (
                              <ChevronDown size={12} />
                            ) : (
                              <ChevronRight size={12} />
                            )}
                          </div>
                        </div>

                        {/* Routes list inside this folder */}
                        {isOpen && (
                          <div
                            style={{
                              paddingLeft: '10px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '1px',
                              marginTop: '2px',
                            }}
                          >
                            {cat.routes.map((r, rIdx) => {
                              const isSelected =
                                method.toUpperCase() ===
                                  r.method.toUpperCase() && path === r.path;
                              return (
                                <div
                                  key={`${r.method}-${r.path}-${rIdx}`}
                                  role="button"
                                  tabIndex={0}
                                  title={r.summary || r.path}
                                  onClick={() => {
                                    setMethod(r.method);
                                    setPath(r.path);
                                    prefillFromRoute(r.method, r.path);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setMethod(r.method);
                                      setPath(r.path);
                                      prefillFromRoute(r.method, r.path);
                                    }
                                  }}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '5px 8px',
                                    borderRadius: 'var(--radius-sm)',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    background: isSelected
                                      ? 'var(--bg-hover)'
                                      : 'transparent',
                                    borderLeft: isSelected
                                      ? '2px solid var(--accent)'
                                      : '2px solid transparent',
                                    transition: 'background var(--transition)',
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isSelected)
                                      e.currentTarget.style.background =
                                        'var(--bg-hover)';
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!isSelected)
                                      e.currentTarget.style.background =
                                        'transparent';
                                  }}
                                >
                                  <span
                                    className={`method-badge method-${r.method}`}
                                    style={{
                                      fontSize: '9px',
                                      fontWeight: 700,
                                      padding: '1px 5px',
                                      minWidth: '38px',
                                      textAlign: 'center',
                                      borderRadius: '3px',
                                    }}
                                  >
                                    {r.method}
                                  </span>
                                  <span
                                    style={{
                                      fontFamily: 'var(--font-mono)',
                                      color: isSelected
                                        ? 'var(--text-primary)'
                                        : 'var(--text-secondary)',
                                      fontWeight: isSelected ? 600 : 400,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      flex: 1,
                                    }}
                                  >
                                    {r.path}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* 2. Collections View */}
          {subSidebarTab === 'collections' && (
            <>
              {/* Action Toolbar */}
              <div
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                  display: 'flex',
                  gap: '5px',
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{
                    padding: '4px 6px',
                    fontSize: '10.5px',
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                  }}
                  onClick={createCollection}
                  title="Create new collection"
                >
                  <FolderPlus size={11} />
                  <span>+ Folder</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{
                    padding: '4px 6px',
                    fontSize: '10.5px',
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                  }}
                  onClick={saveCurrentRequest}
                  title="Save current request to selected collection"
                >
                  <Bookmark size={11} />
                  <span>Save</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{
                    padding: '4px 7px',
                    fontSize: '10.5px',
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    color: 'var(--success)',
                  }}
                  onClick={() => {
                    setRunnerTargetCollectionId(selectedCollectionId);
                    setRunnerModalOpen(true);
                  }}
                  title="Run all requests in this collection sequentially"
                  disabled={collections.length === 0}
                >
                  <Play size={11} />
                  <span>Run Batch</span>
                </button>
              </div>

              {/* Inline Create Collection Card */}
              {creatingCollection && (
                <div
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--bg-secondary)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      color: 'var(--accent-text)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    New Collection
                  </span>
                  <input
                    autoFocus
                    type="text"
                    className="text-input"
                    placeholder="e.g. Smoke Tests, Auth Suite"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCommitCreateCollection();
                      if (e.key === 'Escape') setCreatingCollection(false);
                    }}
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                  />
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ padding: '3px 8px', fontSize: '11px' }}
                      onClick={handleCommitCreateCollection}
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '3px 8px', fontSize: '11px' }}
                      onClick={() => setCreatingCollection(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Inline Save Active Request Card */}
              {savingRequest && (
                <div
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--bg-secondary)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      color: 'var(--accent-text)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Save Request to "
                    {collections.find((c) => c.id === selectedCollectionId)
                      ?.name || 'Collection'}
                    "
                  </span>
                  <input
                    autoFocus
                    type="text"
                    className="text-input"
                    placeholder="Request name..."
                    value={newRequestName}
                    onChange={(e) => setNewRequestName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCommitSaveRequest();
                      if (e.key === 'Escape') setSavingRequest(false);
                    }}
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                  />
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ padding: '3px 8px', fontSize: '11px' }}
                      onClick={handleCommitSaveRequest}
                    >
                      Save Request
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '3px 8px', fontSize: '11px' }}
                      onClick={() => setSavingRequest(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Search Filter */}
              <div
                style={{
                  padding: '6px 10px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                }}
              >
                <div style={{ position: 'relative', width: '100%' }}>
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
                    placeholder="Filter saved requests..."
                    value={collectionSearch}
                    onChange={(e) => setCollectionSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 22px 4px 26px',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                  />
                  {collectionSearch && (
                    <button
                      type="button"
                      onClick={() => setCollectionSearch('')}
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
              </div>

              {/* Collections List */}
              <div className="routes-sidebar-list">
                {collections.length === 0 ? (
                  <div
                    style={{
                      padding: '24px 12px',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '11px',
                    }}
                  >
                    <FolderPlus
                      size={22}
                      style={{ margin: '0 auto 8px', opacity: 0.5 }}
                    />
                    <p style={{ margin: '0 0 10px 0', lineHeight: 1.4 }}>
                      Organize requests into folders for automated testing and
                      reuse.
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '11px' }}
                      onClick={createCollection}
                    >
                      <Plus size={11} />
                      <span>Create Collection</span>
                    </button>
                  </div>
                ) : (
                  collections.map((col) => {
                    const matchingRequests = col.requests.filter((r) => {
                      if (!collectionSearch.trim()) return true;
                      const q = collectionSearch.toLowerCase();
                      return (
                        r.name.toLowerCase().includes(q) ||
                        r.path.toLowerCase().includes(q) ||
                        r.method.toLowerCase().includes(q)
                      );
                    });
                    const isColSelected = selectedCollectionId === col.id;

                    return (
                      <div key={col.id} style={{ marginBottom: '6px' }}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedCollectionId(col.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '5px 8px',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: isColSelected
                              ? 'var(--bg-hover)'
                              : 'transparent',
                            color: isColSelected
                              ? 'var(--text-primary)'
                              : 'var(--text-secondary)',
                            transition: 'background var(--transition)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <FolderOpen
                              size={13}
                              style={{ color: 'var(--accent)' }}
                            />
                            <span>{col.name}</span>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '9px',
                                fontFamily: 'var(--font-mono)',
                                padding: '0 5px',
                                borderRadius: '8px',
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-muted)',
                              }}
                            >
                              {col.requests.length}
                            </span>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{
                                padding: '2px 4px',
                                color: 'var(--success)',
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCollectionId(col.id);
                                setRunnerTargetCollectionId(col.id);
                                setRunnerModalOpen(true);
                              }}
                              title={`Run collection "${col.name}"`}
                              disabled={col.requests.length === 0}
                            >
                              <Play size={11} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{
                                padding: '2px 4px',
                                color: 'var(--text-muted)',
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteCollection(col.id);
                              }}
                              title="Delete collection"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>

                        {/* Requests in collection */}
                        <div
                          style={{
                            paddingLeft: '8px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '1px',
                            marginTop: '2px',
                          }}
                        >
                          {matchingRequests.length === 0 ? (
                            <div
                              style={{
                                padding: '4px 8px',
                                fontSize: '10px',
                                color: 'var(--text-muted)',
                                fontStyle: 'italic',
                              }}
                            >
                              {col.requests.length === 0
                                ? 'Empty collection'
                                : 'No matching requests'}
                            </div>
                          ) : (
                            matchingRequests.map((req) => (
                              <div
                                key={req.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => applySavedRequest(req)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: '6px',
                                  padding: '4px 8px',
                                  borderRadius: 'var(--radius-sm)',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  background: 'transparent',
                                  transition: 'background var(--transition)',
                                }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.background =
                                    'var(--bg-hover)')
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.background =
                                    'transparent')
                                }
                                title={`Load ${req.method} ${req.path}`}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    minWidth: 0,
                                    flex: 1,
                                  }}
                                >
                                  <span
                                    className={`method-badge method-${req.method}`}
                                    style={{
                                      fontSize: '8.5px',
                                      padding: '1px 4px',
                                      minWidth: '32px',
                                      textAlign: 'center',
                                    }}
                                  >
                                    {req.method}
                                  </span>
                                  <span
                                    style={{
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      color: 'var(--text-primary)',
                                      fontSize: '11px',
                                    }}
                                  >
                                    {req.name}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  style={{
                                    padding: '2px 4px',
                                    color: 'var(--text-muted)',
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteSavedRequest(req.id);
                                  }}
                                  title="Delete saved request"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* 3. History View */}
          {subSidebarTab === 'history' && (
            <>
              {/* Action Toolbar */}
              <div
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
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
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Recent Requests ({replays.length})
                  </span>
                  {replays.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{
                        padding: '2px 6px',
                        fontSize: '10px',
                        color: 'var(--error)',
                      }}
                      onClick={clearAllReplays}
                      title="Clear request history"
                    >
                      Clear All
                    </button>
                  )}
                </div>
                <div style={{ position: 'relative', width: '100%' }}>
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
                    placeholder="Filter history..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 22px 4px 26px',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                  />
                  {historySearch && (
                    <button
                      type="button"
                      onClick={() => setHistorySearch('')}
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
              </div>

              {/* History List */}
              <div className="routes-sidebar-list">
                {replays.length === 0 ? (
                  <div
                    style={{
                      padding: '24px 12px',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '11px',
                    }}
                  >
                    <History
                      size={22}
                      style={{ margin: '0 auto 8px', opacity: 0.5 }}
                    />
                    <p style={{ margin: 0 }}>No recent requests in history.</p>
                  </div>
                ) : (
                  replays
                    .filter((rep) => {
                      if (!historySearch.trim()) return true;
                      const q = historySearch.toLowerCase();
                      return (
                        rep.path.toLowerCase().includes(q) ||
                        rep.method.toLowerCase().includes(q) ||
                        String(rep.status || '').includes(q)
                      );
                    })
                    .map((rep) => {
                      const isSuccess =
                        rep.status && rep.status >= 200 && rep.status < 300;
                      return (
                        <div
                          key={rep.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleReplayClick(rep)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 8px',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            fontSize: '11px',
                            border: '1px solid transparent',
                            transition: 'all var(--transition)',
                            background: 'transparent',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background =
                              'var(--bg-hover)';
                            e.currentTarget.style.borderColor = 'var(--border)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.borderColor = 'transparent';
                          }}
                          title={`Load ${rep.method} ${rep.path}`}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              minWidth: 0,
                              flex: 1,
                            }}
                          >
                            <span
                              className={`method-badge method-${rep.method}`}
                              style={{
                                fontSize: '8.5px',
                                padding: '1px 4px',
                                minWidth: '32px',
                                textAlign: 'center',
                              }}
                            >
                              {rep.method}
                            </span>
                            <span
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '11px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                color: 'var(--text-primary)',
                              }}
                            >
                              {rep.path}
                            </span>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              marginLeft: '6px',
                            }}
                          >
                            <span
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '10px',
                                color: isSuccess
                                  ? 'var(--success)'
                                  : 'var(--error)',
                                fontWeight: 600,
                              }}
                            >
                              {rep.status || 'ERR'}
                            </span>
                            <span
                              style={{
                                fontSize: '9px',
                                color: 'var(--text-muted)',
                              }}
                            >
                              {rep.duration
                                ? formatDuration(rep.duration, 0)
                                : ''}
                            </span>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </>
          )}
        </aside>
      )}

      {/* ── CENTER PANE: Request Builder (Option A) ───────────────── */}
      <div className="request-builder-pane">
        {/* Top Request Bar */}
        <div
          style={{
            padding: '12px 14px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
          }}
        >
          <div className="request-url-bar">
            {routesSidebarCollapsed && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{
                  borderRadius: 0,
                  borderRight: '1px solid var(--border)',
                  padding: '0 10px',
                  color: 'var(--text-secondary)',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                onClick={() => setRoutesSidebarCollapsed(false)}
                title="Expand API Routes sub-sidebar"
              >
                <PanelLeftOpen size={13} style={{ color: 'var(--accent)' }} />
                <span style={{ fontWeight: 500 }}>Routes</span>
              </button>
            )}

            {/* Method Dropdown */}
            <select
              className={`method-select ${method.toLowerCase()}`}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            {/* URL Input with VariableInput IntelliSense */}
            <div className="url-input-container">
              <VariableInput
                placeholder="/api/v1/resource or {{baseUrl}}/resource"
                value={path}
                onChange={setPath}
                variables={availableVariables}
                aria-label="Request endpoint path"
                style={{ border: 'none', background: 'transparent' }}
                inputStyle={{
                  padding: '9px 12px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                }}
              />
            </div>

            {/* Route Selector Button */}
            <button
              className="btn btn-ghost"
              style={{
                borderRadius: 0,
                borderLeft: '1px solid var(--border)',
                borderRight: '1px solid var(--border)',
                padding: '0 12px',
                color: 'var(--text-secondary)',
                fontSize: '11px',
              }}
              onClick={() => setRoutePickerOpen(true)}
              title="Browse discovered routes (⌘K)"
            >
              <Layers size={13} style={{ color: 'var(--accent)' }} />
              <span style={{ fontWeight: 500 }}>Routes</span>
            </button>

            {/* Send Request Button */}
            <button
              className="btn-send"
              onClick={handleSendRequest}
              disabled={sending}
              title="Send Request (⌘↵)"
            >
              {sending ? (
                <div
                  className="spinner"
                  style={{ width: '13px', height: '13px', borderWidth: '2px' }}
                />
              ) : (
                <Send size={13} />
              )}
              <span>Send</span>
              <kbd
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  color: '#fff',
                  borderColor: 'transparent',
                  fontSize: '9px',
                }}
              >
                ⌘↵
              </kbd>
            </button>
          </div>

          {/* Active Discovered Route Metadata Pill */}
          {activeRoute && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '8px',
                fontSize: '11px',
                color: 'var(--text-muted)',
              }}
            >
              <span
                className={`method-badge method-${activeRoute.method}`}
                style={{ fontSize: '9px', padding: '1px 5px' }}
              >
                {activeRoute.method}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-secondary)',
                }}
              >
                {activeRoute.path}
              </span>
              {activeRoute.summary && (
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  — {activeRoute.summary}
                </span>
              )}
              {activeRoute.tags &&
                activeRoute.tags.map((t) => (
                  <span
                    key={t}
                    style={{
                      fontSize: '9px',
                      fontFamily: 'var(--font-mono)',
                      padding: '1px 5px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-xs)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {t}
                  </span>
                ))}
              <button
                className="btn btn-ghost"
                style={{
                  marginLeft: 'auto',
                  padding: '2px 6px',
                  fontSize: '10px',
                  color: 'var(--accent-text)',
                }}
                onClick={() =>
                  prefillFromRoute(activeRoute.method, activeRoute.path)
                }
                title="Pre-fill mock schema params and body"
              >
                <Sparkles size={11} />
                <span>Fill Schema</span>
              </button>
            </div>
          )}
        </div>

        {/* Builder Sub-navigation Tabs */}
        <div className="tab-nav">
          <button
            className={`tab-btn ${activeSubTab === 'params' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('params')}
          >
            <span>Params</span>
            {(queryParams.length > 0 || pathParams.length > 0) && (
              <span
                className="nav-badge"
                style={{ padding: '0 4px', fontSize: '9px' }}
              >
                {queryParams.length + pathParams.length}
              </span>
            )}
          </button>
          <button
            className={`tab-btn ${activeSubTab === 'headers' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('headers')}
          >
            <span>Headers</span>
            {headers.length > 0 && (
              <span
                className="nav-badge"
                style={{ padding: '0 4px', fontSize: '9px' }}
              >
                {headers.length}
              </span>
            )}
          </button>
          <button
            className={`tab-btn ${activeSubTab === 'body' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('body')}
          >
            <span>Body</span>
            {bodyMode !== 'none' && (
              <span
                style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  display: 'inline-block',
                }}
              />
            )}
          </button>
          <button
            className={`tab-btn ${activeSubTab === 'auth' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('auth')}
          >
            <span>Auth</span>
            {authType !== 'none' && (
              <span
                style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: 'var(--success)',
                  display: 'inline-block',
                }}
              />
            )}
          </button>
          <button
            className={`tab-btn ${activeSubTab === 'prerequest' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('prerequest')}
          >
            <span>Pre-request</span>
            {preRequestScript.trim() && (
              <span
                style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  display: 'inline-block',
                }}
              />
            )}
          </button>
          <button
            className={`tab-btn ${activeSubTab === 'tests' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('tests')}
          >
            <span>Tests</span>
            {testScript.trim() && (
              <span
                style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  display: 'inline-block',
                }}
              />
            )}
          </button>
          <button
            className={`tab-btn ${activeSubTab === 'uploads' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('uploads')}
          >
            <span>Uploads</span>
            {uploads.length > 0 && (
              <span
                className="nav-badge"
                style={{ padding: '0 4px', fontSize: '9px' }}
              >
                {uploads.length}
              </span>
            )}
          </button>
          <button
            className={`tab-btn ${activeSubTab === 'code' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('code')}
          >
            <span>Code</span>
          </button>
        </div>

        {/* Tab Content Area */}
        <div className="pane-content">
          {/* ── SubTab: Params ────────────────────────────────────── */}
          {activeSubTab === 'params' && (
            <div>
              {/* Path Parameters (if any defined in URL) */}
              {pathParams.length > 0 && (
                <div style={{ marginBottom: '18px' }}>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: '6px',
                    }}
                  >
                    Path Parameters
                  </div>
                  <table className="kv-table">
                    <thead>
                      <tr>
                        <th style={{ width: '160px' }}>Parameter</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pathParams.map((p, i) => (
                        <tr key={i}>
                          <td
                            style={{
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--accent-text)',
                              fontWeight: 500,
                              padding: '6px 10px',
                            }}
                          >
                            :{p.key}
                          </td>
                          <td>
                            <VariableInput
                              placeholder="Value (or {{paramVal}})"
                              value={p.value}
                              variables={availableVariables}
                              aria-label={`Path parameter value ${p.key}`}
                              style={{
                                border: 'none',
                                background: 'transparent',
                              }}
                              inputStyle={{
                                padding: '6px 8px',
                                background: 'transparent',
                                border: 'none',
                                outline: 'none',
                                fontSize: '12px',
                                fontFamily: 'var(--font-mono)',
                              }}
                              onChange={(nextVal) => {
                                setPathParams((prev) =>
                                  prev.map((item, idx) =>
                                    idx === i
                                      ? { ...item, value: nextVal }
                                      : item,
                                  ),
                                );
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Query Parameters */}
              <div style={{ marginBottom: '16px' }}>
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
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Query Parameters
                  </span>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                    onClick={() =>
                      setQueryParams([
                        ...queryParams,
                        { key: '', value: '', enabled: true },
                      ])
                    }
                  >
                    <Plus size={11} />
                    <span>Add Parameter</span>
                  </button>
                </div>

                {queryParams.length === 0 ? (
                  <div
                    className="empty-state"
                    style={{
                      padding: '24px 0',
                      border: '1px dashed var(--border)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <span
                      style={{ fontSize: '12px', color: 'var(--text-muted)' }}
                    >
                      No query parameters added
                    </span>
                    <button
                      className="btn btn-ghost"
                      style={{
                        marginTop: '6px',
                        fontSize: '11px',
                        color: 'var(--accent-text)',
                      }}
                      onClick={() =>
                        setQueryParams([{ key: '', value: '', enabled: true }])
                      }
                    >
                      <Plus size={11} />
                      <span>Add first parameter</span>
                    </button>
                  </div>
                ) : (
                  <table className="kv-table">
                    <thead>
                      <tr>
                        <th style={{ width: '32px', textAlign: 'center' }}></th>
                        <th style={{ width: '38%' }}>Key</th>
                        <th>Value</th>
                        <th style={{ width: '36px', textAlign: 'center' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {queryParams.map((q, i) => (
                        <tr key={i}>
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={q.enabled !== false}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setQueryParams((prev) =>
                                  prev.map((item, idx) =>
                                    idx === i
                                      ? { ...item, enabled: checked }
                                      : item,
                                  ),
                                );
                              }}
                              title={
                                q.enabled !== false
                                  ? 'Disable parameter'
                                  : 'Enable parameter'
                              }
                            />
                          </td>
                          <td>
                            <VariableInput
                              placeholder="key (e.g. limit)"
                              value={q.key}
                              variables={availableVariables}
                              aria-label={`Query parameter key ${i + 1}`}
                              style={{
                                border: 'none',
                                background: 'transparent',
                              }}
                              inputStyle={{
                                padding: '6px 8px',
                                background: 'transparent',
                                border: 'none',
                                outline: 'none',
                                fontSize: '12px',
                                fontFamily: 'var(--font-mono)',
                                opacity: q.enabled === false ? 0.5 : 1,
                              }}
                              onChange={(v) => {
                                setQueryParams((prev) =>
                                  prev.map((item, idx) =>
                                    idx === i ? { ...item, key: v } : item,
                                  ),
                                );
                              }}
                            />
                          </td>
                          <td>
                            <VariableInput
                              placeholder="value (e.g. 50 or {{limit}})"
                              value={q.value}
                              variables={availableVariables}
                              aria-label={`Query parameter value ${i + 1}`}
                              style={{
                                border: 'none',
                                background: 'transparent',
                              }}
                              inputStyle={{
                                padding: '6px 8px',
                                background: 'transparent',
                                border: 'none',
                                outline: 'none',
                                fontSize: '12px',
                                fontFamily: 'var(--font-mono)',
                                opacity: q.enabled === false ? 0.5 : 1,
                              }}
                              onChange={(v) => {
                                setQueryParams((prev) =>
                                  prev.map((item, idx) =>
                                    idx === i ? { ...item, value: v } : item,
                                  ),
                                );
                              }}
                            />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="btn btn-ghost"
                              style={{
                                padding: '4px',
                                color: 'var(--text-muted)',
                              }}
                              onClick={() =>
                                setQueryParams(
                                  queryParams.filter((_, idx) => idx !== i),
                                )
                              }
                              title="Remove parameter"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── SubTab: Headers ───────────────────────────────────── */}
          {activeSubTab === 'headers' && (
            <div style={{ marginBottom: '16px' }}>
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
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  HTTP Headers
                </span>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  onClick={() =>
                    setHeaders([
                      ...headers,
                      { key: '', value: '', enabled: true },
                    ])
                  }
                >
                  <Plus size={11} />
                  <span>Add Header</span>
                </button>
              </div>

              {headers.length === 0 ? (
                <div
                  className="empty-state"
                  style={{
                    padding: '24px 0',
                    border: '1px dashed var(--border)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <span
                    style={{ fontSize: '12px', color: 'var(--text-muted)' }}
                  >
                    No headers specified
                  </span>
                  <button
                    className="btn btn-ghost"
                    style={{
                      marginTop: '6px',
                      fontSize: '11px',
                      color: 'var(--accent-text)',
                    }}
                    onClick={() =>
                      setHeaders([
                        {
                          key: 'Content-Type',
                          value: 'application/json',
                          enabled: true,
                        },
                      ])
                    }
                  >
                    <Plus size={11} />
                    <span>Add Content-Type</span>
                  </button>
                </div>
              ) : (
                <table className="kv-table">
                  <thead>
                    <tr>
                      <th style={{ width: '32px', textAlign: 'center' }}></th>
                      <th style={{ width: '38%' }}>Header Name</th>
                      <th>Value</th>
                      <th style={{ width: '36px', textAlign: 'center' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {headers.map((h, i) => (
                      <tr key={i}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={h.enabled !== false}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setHeaders((prev) =>
                                prev.map((item, idx) =>
                                  idx === i
                                    ? { ...item, enabled: checked }
                                    : item,
                                ),
                              );
                            }}
                            title={
                              h.enabled !== false
                                ? 'Disable header'
                                : 'Enable header'
                            }
                          />
                        </td>
                        <td>
                          <VariableInput
                            placeholder="Header Name"
                            value={h.key}
                            variables={availableVariables}
                            aria-label={`Header key ${i + 1}`}
                            style={{
                              border: 'none',
                              background: 'transparent',
                            }}
                            inputStyle={{
                              padding: '6px 8px',
                              background: 'transparent',
                              border: 'none',
                              outline: 'none',
                              fontSize: '12px',
                              fontFamily: 'var(--font-mono)',
                              opacity: h.enabled === false ? 0.5 : 1,
                            }}
                            onChange={(v) => {
                              setHeaders((prev) =>
                                prev.map((item, idx) =>
                                  idx === i ? { ...item, key: v } : item,
                                ),
                              );
                            }}
                          />
                        </td>
                        <td>
                          <VariableInput
                            placeholder="Header Value (e.g. Bearer {{token}})"
                            value={h.value}
                            variables={availableVariables}
                            aria-label={`Header value ${i + 1}`}
                            style={{
                              border: 'none',
                              background: 'transparent',
                            }}
                            inputStyle={{
                              padding: '6px 8px',
                              background: 'transparent',
                              border: 'none',
                              outline: 'none',
                              fontSize: '12px',
                              fontFamily: 'var(--font-mono)',
                              opacity: h.enabled === false ? 0.5 : 1,
                            }}
                            onChange={(v) => {
                              setHeaders((prev) =>
                                prev.map((item, idx) =>
                                  idx === i ? { ...item, value: v } : item,
                                ),
                              );
                            }}
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-ghost"
                            style={{
                              padding: '4px',
                              color: 'var(--text-muted)',
                            }}
                            onClick={() =>
                              setHeaders(headers.filter((_, idx) => idx !== i))
                            }
                            title="Remove header"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── SubTab: Body ──────────────────────────────────────── */}
          {activeSubTab === 'body' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minHeight: '340px',
              }}
            >
              {/* Body Mode Selector */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '12px',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  {BODY_MODE_OPTIONS.map((opt) => {
                    const isActive = bodyMode === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setBodyMode(opt.value);
                          if (opt.value === 'json') {
                            setHeaders((prev) => {
                              const exists = prev.some(
                                (h) => h.key.toLowerCase() === 'content-type',
                              );
                              if (!exists)
                                return [
                                  ...prev,
                                  {
                                    key: 'Content-Type',
                                    value: 'application/json',
                                  },
                                ];
                              return prev.map((h) =>
                                h.key.toLowerCase() === 'content-type'
                                  ? { ...h, value: 'application/json' }
                                  : h,
                              );
                            });
                          } else if (opt.value === 'urlencoded') {
                            setHeaders((prev) => {
                              const exists = prev.some(
                                (h) => h.key.toLowerCase() === 'content-type',
                              );
                              if (!exists)
                                return [
                                  ...prev,
                                  {
                                    key: 'Content-Type',
                                    value: 'application/x-www-form-urlencoded',
                                  },
                                ];
                              return prev.map((h) =>
                                h.key.toLowerCase() === 'content-type'
                                  ? {
                                      ...h,
                                      value:
                                        'application/x-www-form-urlencoded',
                                    }
                                  : h,
                              );
                            });
                          }
                        }}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          borderRadius: 'var(--radius-sm)',
                          border: isActive
                            ? '1px solid var(--accent)'
                            : '1px solid var(--border)',
                          background: isActive
                            ? 'rgba(59, 130, 246, 0.12)'
                            : 'var(--bg-secondary)',
                          color: isActive
                            ? 'var(--accent)'
                            : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontWeight: isActive ? 600 : 400,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                {/* Quick actions for JSON/Text mode */}
                {(bodyMode === 'json' || bodyMode === 'text') && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    {bodyMode === 'json' && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px' }}
                        onClick={() => {
                          try {
                            if (!reqBody.trim()) return;
                            const parsed = JSON.parse(reqBody);
                            setReqBody(JSON.stringify(parsed, null, 2));
                          } catch (e: any) {
                            alert('Cannot prettify invalid JSON: ' + e.message);
                          }
                        }}
                        title="Prettify JSON formatting"
                      >
                        Prettify
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '3px 8px', fontSize: '11px' }}
                      onClick={() => setReqBody('')}
                      title="Clear body content"
                    >
                      Clear
                    </button>
                    {(() => {
                      const schema = discovery.schemas?.find(
                        (s) => s.method === method && s.path === path,
                      );
                      if (schema?.body) {
                        return (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{
                              padding: '3px 8px',
                              fontSize: '11px',
                              color: 'var(--accent)',
                            }}
                            onClick={() => {
                              const template = generateMockData(
                                'body',
                                schema.body,
                              );
                              setBodyMode('json');
                              setReqBody(JSON.stringify(template, null, 2));
                            }}
                            title="Regenerate mock payload from schema"
                          >
                            Fill from Schema
                          </button>
                        );
                      }
                      return null;
                    })()}
                  </div>
                )}

                {(bodyMode === 'form-data' || bodyMode === 'urlencoded') && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                    onClick={() =>
                      setBodyFields([
                        ...bodyFields,
                        { key: '', value: '', enabled: true },
                      ])
                    }
                  >
                    + Add Field
                  </button>
                )}
              </div>

              {/* Body Content by Mode */}
              {bodyMode === 'none' && (
                <div
                  style={{
                    padding: '40px 20px',
                    textAlign: 'center',
                    background: 'var(--bg-secondary)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px dashed var(--border)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '13px',
                      color: 'var(--text-muted)',
                      marginBottom: '10px',
                    }}
                  >
                    This request does not have a body
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: '11px', padding: '4px 12px' }}
                    onClick={() => {
                      setBodyMode('json');
                      setReqBody('{\n  \n}');
                    }}
                  >
                    Add JSON Body
                  </button>
                </div>
              )}

              {(bodyMode === 'json' || bodyMode === 'text') && (
                <div
                  style={{
                    flex: 1,
                    minHeight: '280px',
                    borderRadius: 'var(--radius-sm)',
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-primary)',
                  }}
                >
                  <Editor
                    height="320px"
                    language={bodyMode === 'json' ? 'json' : 'plaintext'}
                    theme={isDark ? 'vs-dark' : 'light'}
                    value={reqBody}
                    onChange={(val) => setReqBody(val || '')}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                      scrollBeyondLastLine: false,
                      lineNumbers: 'on',
                      automaticLayout: true,
                      wordWrap: 'on',
                      tabSize: 2,
                    }}
                  />
                </div>
              )}

              {(bodyMode === 'form-data' || bodyMode === 'urlencoded') && (
                <div>
                  {bodyFields.length === 0 ? (
                    <div
                      style={{
                        padding: '30px',
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                        fontSize: '12px',
                        background: 'var(--bg-secondary)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px dashed var(--border)',
                      }}
                    >
                      No {bodyMode === 'form-data' ? 'form-data' : 'urlencoded'}{' '}
                      fields added.{' '}
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() =>
                          setBodyFields([{ key: '', value: '', enabled: true }])
                        }
                        style={{
                          color: 'var(--accent)',
                          cursor: 'pointer',
                          background: 'none',
                          border: 'none',
                          padding: 0,
                        }}
                      >
                        Add first field
                      </button>
                    </div>
                  ) : (
                    <table className="kv-table">
                      <thead>
                        <tr>
                          <th
                            style={{ width: '40px', textAlign: 'center' }}
                          ></th>
                          <th style={{ width: '220px' }}>Key</th>
                          <th>Value</th>
                          <th
                            style={{ width: '50px', textAlign: 'center' }}
                          ></th>
                        </tr>
                      </thead>
                      <tbody>
                        {bodyFields.map((field, i) => (
                          <tr key={i}>
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={field.enabled !== false}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setBodyFields((prev) =>
                                    prev.map((item, idx) =>
                                      idx === i
                                        ? { ...item, enabled: checked }
                                        : item,
                                    ),
                                  );
                                }}
                                title={
                                  field.enabled !== false
                                    ? 'Disable field'
                                    : 'Enable field'
                                }
                              />
                            </td>
                            <td>
                              <VariableInput
                                placeholder="key (e.g. username)"
                                value={field.key}
                                variables={availableVariables}
                                aria-label={`Body field key ${i + 1}`}
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                }}
                                inputStyle={{
                                  padding: '6px 8px',
                                  background: 'transparent',
                                  border: 'none',
                                  outline: 'none',
                                  fontSize: '12px',
                                  fontFamily: 'var(--font-mono)',
                                  opacity: field.enabled === false ? 0.5 : 1,
                                }}
                                onChange={(v) => {
                                  setBodyFields((prev) =>
                                    prev.map((item, idx) =>
                                      idx === i ? { ...item, key: v } : item,
                                    ),
                                  );
                                }}
                              />
                            </td>
                            <td>
                              <VariableInput
                                placeholder="value (or {{var}})"
                                value={field.value}
                                variables={availableVariables}
                                aria-label={`Body field value ${i + 1}`}
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                }}
                                inputStyle={{
                                  padding: '6px 8px',
                                  background: 'transparent',
                                  border: 'none',
                                  outline: 'none',
                                  fontSize: '12px',
                                  fontFamily: 'var(--font-mono)',
                                  opacity: field.enabled === false ? 0.5 : 1,
                                }}
                                onChange={(v) => {
                                  setBodyFields((prev) =>
                                    prev.map((item, idx) =>
                                      idx === i ? { ...item, value: v } : item,
                                    ),
                                  );
                                }}
                              />
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{
                                  padding: '4px',
                                  color: 'var(--text-muted)',
                                }}
                                onClick={() =>
                                  setBodyFields(
                                    bodyFields.filter((_, idx) => idx !== i),
                                  )
                                }
                                title="Remove field"
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── SubTab: Auth ──────────────────────────────────────── */}
          {activeSubTab === 'auth' && (
            <div>
              <div className="form-group">
                <label className="form-label">Authorization Type</label>
                <select
                  className="select-input"
                  style={{ width: '200px' }}
                  value={authType}
                  onChange={(e) => setAuthType(e.target.value as AuthType)}
                >
                  <option value="none">No Auth</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="basic">Basic Auth</option>
                  <option value="apikey">API Key</option>
                </select>
              </div>

              {authType === 'bearer' && (
                <div className="form-group">
                  <label className="form-label">Bearer Token</label>
                  <VariableInput
                    placeholder="e.g. {{token}} or eyJhbGci..."
                    value={bearerToken}
                    variables={availableVariables}
                    onChange={setBearerToken}
                  />
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      marginTop: '4px',
                    }}
                  >
                    Automatically injected into the{' '}
                    <code>Authorization: Bearer &lt;token&gt;</code> header.
                  </div>
                </div>
              )}

              {authType === 'basic' && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '12px',
                  }}
                >
                  <div className="form-group">
                    <label className="form-label">Username</label>
                    <VariableInput
                      placeholder="Username"
                      value={basicUser}
                      variables={availableVariables}
                      onChange={setBasicUser}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <VariableInput
                      placeholder="Password"
                      type="password"
                      value={basicPass}
                      variables={availableVariables}
                      onChange={setBasicPass}
                    />
                  </div>
                </div>
              )}

              {authType === 'apikey' && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 120px',
                    gap: '12px',
                  }}
                >
                  <div className="form-group">
                    <label className="form-label">Key Name</label>
                    <VariableInput
                      placeholder="e.g. X-API-Key"
                      value={apiKeyName}
                      variables={availableVariables}
                      onChange={setApiKeyName}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Key Value</label>
                    <VariableInput
                      placeholder="e.g. {{apiKey}}"
                      value={apiKeyValue}
                      variables={availableVariables}
                      onChange={setApiKeyValue}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Add To</label>
                    <select
                      className="select-input"
                      value={apiKeyLocation}
                      onChange={(e) => setApiKeyLocation(e.target.value as any)}
                    >
                      <option value="header">Header</option>
                      <option value="query">Query</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── SubTab: Uploads ───────────────────────────────────── */}
          {activeSubTab === 'uploads' && (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '12px',
                }}
              >
                <span className="form-label" style={{ margin: 0 }}>
                  Multipart File Attachments
                </span>
                <label
                  className="btn btn-secondary"
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    margin: 0,
                  }}
                >
                  <UploadCloud size={13} />
                  <span>Choose Files</span>
                  <input
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || []);
                      const processed = await Promise.all(
                        files.map(async (file) => {
                          const bytes = new Uint8Array(
                            await file.arrayBuffer(),
                          );
                          let binary = '';
                          for (const b of bytes)
                            binary += String.fromCharCode(b);
                          return {
                            field: 'file',
                            name: file.name,
                            type: file.type || 'application/octet-stream',
                            contentBase64: btoa(binary),
                          };
                        }),
                      );
                      setUploads([...uploads, ...processed]);
                      if (bodyMode !== 'form-data') setBodyMode('form-data');
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>

              {uploads.length === 0 ? (
                <div
                  className="empty-state"
                  style={{
                    border: '1px dashed var(--border)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <UploadCloud size={20} />
                  <span>No files attached</span>
                </div>
              ) : (
                uploads.map((up, i) => (
                  <div
                    key={i}
                    className="kv-row"
                    style={{
                      background: 'var(--bg-secondary)',
                      padding: '6px 10px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        flex: 1,
                      }}
                    >
                      {up.name}
                    </span>
                    <input
                      className="text-input"
                      style={{
                        width: '120px',
                        padding: '3px 6px',
                        fontSize: '11px',
                      }}
                      value={up.field}
                      onChange={(e) => {
                        const val = e.target.value;
                        setUploads((prev) =>
                          prev.map((item, idx) =>
                            idx === i ? { ...item, field: val } : item,
                          ),
                        );
                      }}
                      title="Multipart form field name"
                    />
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px', color: 'var(--text-muted)' }}
                      onClick={() =>
                        setUploads(uploads.filter((_, idx) => idx !== i))
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── SubTab: Pre-request Script ─────────────────────── */}
          {activeSubTab === 'prerequest' && (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                      }}
                    >
                      Pre-request Script
                    </span>
                    <span
                      style={{
                        fontSize: '9px',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        background: 'rgba(99, 102, 241, 0.15)',
                        color: '#818cf8',
                        fontWeight: 600,
                      }}
                    >
                      IntelliSense Enabled
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Runs before HTTP dispatch. Modify headers/params via{' '}
                    <code>$.request</code> or set variables via{' '}
                    <code>$.env.set()</code>.
                  </div>
                </div>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <select
                    className="select-input"
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                    onChange={(e) => {
                      const snip = SCRIPT_SNIPPETS.preRequest.find(
                        (s) => s.label === e.target.value,
                      );
                      if (snip) {
                        setPreRequestScript((prev) =>
                          prev ? prev + '\n\n' + snip.code : snip.code,
                        );
                      }
                      e.target.value = '';
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>
                      + Insert Snippet...
                    </option>
                    {SCRIPT_SNIPPETS.preRequest.map((s) => (
                      <option key={s.label} value={s.label}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  {preRequestScript && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{
                        fontSize: '11px',
                        padding: '3px 8px',
                        color: 'var(--text-muted)',
                      }}
                      onClick={() => setPreRequestScript('')}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div
                style={{
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                }}
              >
                <Editor
                  height="280px"
                  language="javascript"
                  theme={isDark ? 'vs-dark' : 'light'}
                  value={preRequestScript}
                  onChange={(val) => setPreRequestScript(val || '')}
                  beforeMount={configureMonacoSandbox}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                    scrollBeyondLastLine: false,
                    lineNumbers: 'on',
                    automaticLayout: true,
                    wordWrap: 'on',
                    tabSize: 2,
                    suggestOnTriggerCharacters: true,
                    quickSuggestions: {
                      other: true,
                      comments: false,
                      strings: true,
                    },
                    acceptSuggestionOnEnter: 'on',
                    tabCompletion: 'on',
                    wordBasedSuggestions: 'currentDocument',
                  }}
                />
              </div>
            </div>
          )}

          {/* ── SubTab: Tests Script ────────────────────────────── */}
          {activeSubTab === 'tests' && (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                      }}
                    >
                      Post-response Tests Script
                    </span>
                    <span
                      style={{
                        fontSize: '9px',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        background: 'rgba(99, 102, 241, 0.15)',
                        color: '#818cf8',
                        fontWeight: 600,
                      }}
                    >
                      IntelliSense Enabled
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Write assertions using <code>$.test()</code> and{' '}
                    <code>$.expect()</code> (or <code>axiomify.*</code> /{' '}
                    <code>pm.*</code>).
                  </div>
                </div>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <select
                    className="select-input"
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                    onChange={(e) => {
                      const snip = SCRIPT_SNIPPETS.test.find(
                        (s) => s.label === e.target.value,
                      );
                      if (snip) {
                        setTestScript((prev) =>
                          prev ? prev + '\n\n' + snip.code : snip.code,
                        );
                      }
                      e.target.value = '';
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>
                      + Insert Snippet...
                    </option>
                    {SCRIPT_SNIPPETS.test.map((s) => (
                      <option key={s.label} value={s.label}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  {testScript && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{
                        fontSize: '11px',
                        padding: '3px 8px',
                        color: 'var(--text-muted)',
                      }}
                      onClick={() => setTestScript('')}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div
                style={{
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                }}
              >
                <Editor
                  height="280px"
                  language="javascript"
                  theme={isDark ? 'vs-dark' : 'light'}
                  value={testScript}
                  onChange={(val) => setTestScript(val || '')}
                  beforeMount={configureMonacoSandbox}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                    scrollBeyondLastLine: false,
                    lineNumbers: 'on',
                    automaticLayout: true,
                    wordWrap: 'on',
                    tabSize: 2,
                    suggestOnTriggerCharacters: true,
                    quickSuggestions: {
                      other: true,
                      comments: false,
                      strings: true,
                    },
                    acceptSuggestionOnEnter: 'on',
                    tabCompletion: 'on',
                    wordBasedSuggestions: 'currentDocument',
                  }}
                />
              </div>
            </div>
          )}

          {/* ── SubTab: Code Generation ───────────────────────────── */}
          {activeSubTab === 'code' && (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                }}
              >
                <div style={{ display: 'flex', gap: '4px' }}>
                  {(['curl', 'fetch', 'axios', 'python', 'go'] as const).map(
                    (lang) => (
                      <button
                        key={lang}
                        className={`btn ${codeLang === lang ? 'btn-primary' : 'btn-ghost'}`}
                        style={{
                          padding: '3px 8px',
                          fontSize: '11px',
                          textTransform: 'capitalize',
                        }}
                        onClick={() => setCodeLang(lang)}
                      >
                        {lang}
                      </button>
                    ),
                  )}
                </div>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  onClick={() => {
                    navigator.clipboard.writeText(generatedCode);
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 2000);
                  }}
                >
                  {copiedCode ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                </button>
              </div>

              <pre
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '14px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  overflowX: 'auto',
                  color: 'var(--text-primary)',
                }}
              >
                {generatedCode}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT PANE: Response Inspector (Option 3 Vercel & Railway style) ──────────── */}
      <div className="response-inspector-pane">
        {/* Response Header */}
        <div className="pane-header">
          {response ? (
            <>
              <div className="metrics-pill-bar">
                {/* Status Pill */}
                <span
                  className={`metric-status-pill ${
                    response.status >= 200 && response.status < 300
                      ? 'success'
                      : response.status >= 400 && response.status < 500
                        ? 'warning'
                        : 'error'
                  }`}
                >
                  {response.status >= 200 && response.status < 300 ? (
                    <CheckCircle2 size={12} />
                  ) : response.status >= 400 && response.status < 500 ? (
                    <AlertCircle size={12} />
                  ) : (
                    <XCircle size={12} />
                  )}
                  <span>
                    {response.status}{' '}
                    {response.status === 200
                      ? 'OK'
                      : response.status === 201
                        ? 'Created'
                        : response.status === 204
                          ? 'No Content'
                          : response.status === 400
                            ? 'Bad Request'
                            : response.status === 401
                              ? 'Unauthorized'
                              : response.status === 403
                                ? 'Forbidden'
                                : response.status === 404
                                  ? 'Not Found'
                                  : response.status === 500
                                    ? 'Internal Error'
                                    : ''}
                  </span>
                </span>

                {/* Duration */}
                {(response.duration !== undefined ||
                  response.clientLatency !== undefined) && (
                  <span className="metric-chip">
                    <Clock
                      size={11}
                      style={{
                        color:
                          (response.duration || response.clientLatency) < 150
                            ? 'var(--success)'
                            : (response.duration || response.clientLatency) <
                                500
                              ? 'var(--warning)'
                              : 'var(--error)',
                      }}
                    />
                    <span>
                      {formatDuration(
                        response.duration || response.clientLatency,
                      )}
                    </span>
                  </span>
                )}

                {/* Size */}
                {response.body !== undefined && (
                  <span className="metric-chip">
                    <HardDrive size={11} />
                    <span>
                      {formatBytes(
                        typeof response.body === 'string'
                          ? response.body.length
                          : JSON.stringify(response.body).length,
                      )}
                    </span>
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  onClick={handleCopyResponse}
                  title="Copy response body"
                >
                  {copiedResponse ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedResponse ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  onClick={handleDownloadResponse}
                  title="Download response JSON"
                >
                  <Download size={12} />
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Activity size={13} style={{ color: 'var(--text-muted)' }} />
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                Live Response Inspector
              </span>
            </div>
          )}
        </div>

        {/* Response Tabs Navigation */}
        {response && (
          <div className="tab-nav">
            <button
              className={`tab-btn ${responseSubTab === 'body' ? 'active' : ''}`}
              onClick={() => setResponseSubTab('body')}
            >
              <span>Body</span>
            </button>
            <button
              className={`tab-btn ${responseSubTab === 'headers' ? 'active' : ''}`}
              onClick={() => setResponseSubTab('headers')}
            >
              <span>Headers</span>
              {response.headers && (
                <span
                  className="nav-badge"
                  style={{ padding: '0 4px', fontSize: '9px' }}
                >
                  {Object.keys(response.headers).length}
                </span>
              )}
            </button>
            <button
              className={`tab-btn ${responseSubTab === 'tests' ? 'active' : ''}`}
              onClick={() => setResponseSubTab('tests')}
            >
              <span>Tests & Scripts</span>
              {scriptTestResults ? (
                <span
                  className="nav-badge"
                  style={{
                    padding: '0 5px',
                    fontSize: '9px',
                    background: scriptTestResults.success
                      ? 'rgba(34, 197, 94, 0.2)'
                      : 'rgba(239, 68, 68, 0.2)',
                    color: scriptTestResults.success
                      ? 'var(--success)'
                      : 'var(--error)',
                  }}
                >
                  {scriptTestResults.tests.filter((t) => t.passed).length}/
                  {scriptTestResults.tests.length}
                </span>
              ) : preRequestResults ? (
                <span
                  className="nav-badge"
                  style={{
                    padding: '0 5px',
                    fontSize: '9px',
                    background: preRequestResults.success
                      ? 'rgba(34, 197, 94, 0.2)'
                      : 'rgba(239, 68, 68, 0.2)',
                    color: preRequestResults.success
                      ? 'var(--success)'
                      : 'var(--error)',
                  }}
                >
                  ⚡ Pre-req
                </span>
              ) : null}
            </button>
            <button
              className={`tab-btn ${responseSubTab === 'waterfall' ? 'active' : ''}`}
              onClick={() => setResponseSubTab('waterfall')}
            >
              <span>Waterfall & Metrics</span>
            </button>
            <button
              className={`tab-btn ${responseSubTab === 'queries' ? 'active' : ''}`}
              onClick={() => setResponseSubTab('queries')}
            >
              <span>Queries</span>
              {response.profile?.queries && (
                <span
                  className="nav-badge"
                  style={{ padding: '0 4px', fontSize: '9px' }}
                >
                  {response.profile.queries.length}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Response Body & Views */}
        <div
          className="pane-content"
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          {!response ? (
            <div
              className="empty-state"
              style={{
                height: '100%',
                minHeight: '360px',
                justifyContent: 'center',
              }}
            >
              <div className="response-empty-radar">
                <Activity size={22} />
              </div>
              <span
                style={{
                  fontSize: '13.5px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  marginBottom: '4px',
                }}
              >
                Ready to Inspect Response
              </span>
              <span
                style={{
                  fontSize: '11.5px',
                  color: 'var(--text-muted)',
                  maxWidth: '300px',
                  textAlign: 'center',
                  lineHeight: 1.5,
                  marginBottom: '16px',
                }}
              >
                Execute a request to view HTTP status codes, latency waterfall
                timeline, headers, and payload inspect tools.
              </span>
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                }}
              >
                <span className="metric-chip">
                  <kbd>⌘↵</kbd> Send Request
                </span>
                <span className="metric-chip">
                  <kbd>⌘K</kbd> Browse Routes
                </span>
                <span className="metric-chip">
                  <kbd>
                    {'{'}
                    {'{'}
                  </kbd>{' '}
                  Insert Variable
                </span>
              </div>
            </div>
          ) : (
            <>
              {/* Response SubTab: Body (Monaco or Formatted) */}
              {responseSubTab === 'body' && (
                <div className="response-editor-container">
                  {typeof response.body === 'object' ? (
                    <Editor
                      height="100%"
                      language="json"
                      theme={isDark ? 'vs-dark' : 'light'}
                      value={JSON.stringify(response.body, null, 2)}
                      options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        fontSize: 12,
                        fontFamily: 'var(--font-mono)',
                        scrollBeyondLastLine: false,
                        lineNumbers: 'on',
                        automaticLayout: true,
                        wordWrap: 'on',
                        tabSize: 2,
                      }}
                    />
                  ) : (
                    <pre
                      style={{
                        margin: 0,
                        padding: '14px',
                        height: '100%',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        lineHeight: 1.5,
                        overflow: 'auto',
                        color:
                          response.status === 'ERROR'
                            ? 'var(--error)'
                            : 'var(--text-primary)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {String(response.body || '[Empty Response]')}
                    </pre>
                  )}
                </div>
              )}

              {/* Response SubTab: Headers */}
              {responseSubTab === 'headers' && (
                <div>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          borderBottom: '1px solid var(--border)',
                          textAlign: 'left',
                          color: 'var(--text-muted)',
                          fontSize: '10px',
                          textTransform: 'uppercase',
                        }}
                      >
                        <th style={{ padding: '6px 8px' }}>Key</th>
                        <th style={{ padding: '6px 8px' }}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(response.headers || {}).map(([k, v]) => (
                        <tr
                          key={k}
                          style={{ borderBottom: '1px solid var(--border)' }}
                        >
                          <td
                            style={{
                              padding: '6px 8px',
                              color: 'var(--accent-text)',
                              fontWeight: 500,
                            }}
                          >
                            {k}
                          </td>
                          <td
                            style={{
                              padding: '6px 8px',
                              color: 'var(--text-primary)',
                            }}
                          >
                            {String(v)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Response SubTab: Waterfall & Metrics (Option 3 Vercel & Railway style) */}
              {responseSubTab === 'waterfall' &&
                (() => {
                  const totalMs = Math.max(
                    response.clientLatency || response.duration || 1,
                    1,
                  );
                  const serverDuration = response.duration || totalMs * 0.6;
                  const dnsMs = Math.max(
                    1,
                    Math.round(totalMs * 0.08 * 10) / 10,
                  );
                  const connectMs = Math.max(
                    1,
                    Math.round(totalMs * 0.14 * 10) / 10,
                  );
                  const ttfbMs = Math.max(
                    1,
                    Math.round(
                      Math.min(
                        serverDuration,
                        Math.max(1, totalMs - dnsMs - connectMs),
                      ) * 10,
                    ) / 10,
                  );
                  const downloadMs = Math.max(
                    0.5,
                    Math.round(
                      Math.max(0.5, totalMs - (dnsMs + connectMs + ttfbMs)) *
                        10,
                    ) / 10,
                  );

                  const sumMs = dnsMs + connectMs + ttfbMs + downloadMs;
                  const dnsPct = Math.max(4, Math.round((dnsMs / sumMs) * 100));
                  const connectPct = Math.max(
                    6,
                    Math.round((connectMs / sumMs) * 100),
                  );
                  const ttfbPct = Math.max(
                    20,
                    Math.round((ttfbMs / sumMs) * 100),
                  );
                  const downloadPct = Math.max(
                    4,
                    100 - dnsPct - connectPct - ttfbPct,
                  );

                  return (
                    <div className="waterfall-container">
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
                            fontWeight: 600,
                            color: 'var(--text-secondary)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          Latency Waterfall Timeline
                        </span>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '11px',
                            color: 'var(--accent-text)',
                            fontWeight: 600,
                          }}
                        >
                          {formatDuration(totalMs)} Total
                        </span>
                      </div>

                      {/* Composite Visual Timing Bar */}
                      <div
                        className="waterfall-bar-composite"
                        title="DNS (purple) → TCP/TLS (cyan) → TTFB/Server (amber) → Download (emerald)"
                      >
                        <div
                          className="waterfall-phase-segment"
                          style={{ width: `${dnsPct}%`, background: '#8b5cf6' }}
                          title={`DNS Lookup: ${dnsMs}ms (${dnsPct}%)`}
                        />
                        <div
                          className="waterfall-phase-segment"
                          style={{
                            width: `${connectPct}%`,
                            background: '#06b6d4',
                          }}
                          title={`Connect & TLS: ${connectMs}ms (${connectPct}%)`}
                        />
                        <div
                          className="waterfall-phase-segment"
                          style={{
                            width: `${ttfbPct}%`,
                            background: '#f59e0b',
                          }}
                          title={`Server TTFB: ${ttfbMs}ms (${ttfbPct}%)`}
                        />
                        <div
                          className="waterfall-phase-segment"
                          style={{
                            width: `${downloadPct}%`,
                            background: '#10b981',
                          }}
                          title={`Content Download: ${downloadMs}ms (${downloadPct}%)`}
                        />
                      </div>

                      {/* 4 Timing Phase Metric Cards */}
                      <div className="waterfall-grid">
                        <div className="waterfall-phase-card">
                          <div className="waterfall-phase-label">
                            <span
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                background: '#8b5cf6',
                                display: 'inline-block',
                              }}
                            />
                            <span>DNS Lookup</span>
                          </div>
                          <div
                            className="waterfall-phase-value"
                            style={{ color: '#8b5cf6' }}
                          >
                            {formatDuration(dnsMs)}
                          </div>
                          <div
                            style={{
                              fontSize: '10px',
                              color: 'var(--text-muted)',
                              marginTop: '2px',
                            }}
                          >
                            {dnsPct}% of total
                          </div>
                        </div>

                        <div className="waterfall-phase-card">
                          <div className="waterfall-phase-label">
                            <span
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                background: '#06b6d4',
                                display: 'inline-block',
                              }}
                            />
                            <span>Connect & TLS</span>
                          </div>
                          <div
                            className="waterfall-phase-value"
                            style={{ color: '#06b6d4' }}
                          >
                            {formatDuration(connectMs)}
                          </div>
                          <div
                            style={{
                              fontSize: '10px',
                              color: 'var(--text-muted)',
                              marginTop: '2px',
                            }}
                          >
                            {connectPct}% of total
                          </div>
                        </div>

                        <div className="waterfall-phase-card">
                          <div className="waterfall-phase-label">
                            <span
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                background: '#f59e0b',
                                display: 'inline-block',
                              }}
                            />
                            <span>Server TTFB</span>
                          </div>
                          <div
                            className="waterfall-phase-value"
                            style={{ color: '#f59e0b' }}
                          >
                            {formatDuration(ttfbMs)}
                          </div>
                          <div
                            style={{
                              fontSize: '10px',
                              color: 'var(--text-muted)',
                              marginTop: '2px',
                            }}
                          >
                            {ttfbPct}% of total
                          </div>
                        </div>

                        <div className="waterfall-phase-card">
                          <div className="waterfall-phase-label">
                            <span
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                background: '#10b981',
                                display: 'inline-block',
                              }}
                            />
                            <span>Download</span>
                          </div>
                          <div
                            className="waterfall-phase-value"
                            style={{ color: '#10b981' }}
                          >
                            {formatDuration(downloadMs)}
                          </div>
                          <div
                            style={{
                              fontSize: '10px',
                              color: 'var(--text-muted)',
                              marginTop: '2px',
                            }}
                          >
                            {downloadPct}% of total
                          </div>
                        </div>
                      </div>

                      {/* Axiomify Internal Profiler Timeline */}
                      {response.profile?.timeline?.length > 0 && (
                        <div style={{ marginTop: '12px' }}>
                          <div
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              color: 'var(--text-secondary)',
                              marginBottom: '8px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                            }}
                          >
                            Server Execution Phases (
                            {response.profile.timeline.length})
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                            }}
                          >
                            {response.profile.timeline.map(
                              (item: any, idx: number) => {
                                const dur = Number(item.duration) || 0;
                                return (
                                  <div
                                    key={idx}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      padding: '7px 10px',
                                      background: 'var(--bg-primary)',
                                      border: '1px solid var(--border)',
                                      borderRadius: 'var(--radius-xs)',
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontSize: '9px',
                                          fontFamily: 'var(--font-mono)',
                                          padding: '1px 5px',
                                          borderRadius: '3px',
                                          background: 'var(--bg-tertiary)',
                                          border: '1px solid var(--border)',
                                          color: 'var(--accent-text)',
                                          textTransform: 'uppercase',
                                        }}
                                      >
                                        {item.type || 'EXEC'}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: '11.5px',
                                          fontWeight: 500,
                                          color: 'var(--text-primary)',
                                        }}
                                      >
                                        {item.name}
                                      </span>
                                    </div>
                                    <span
                                      style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '11px',
                                        color: 'var(--accent-text)',
                                        fontWeight: 600,
                                      }}
                                    >
                                      {formatDuration(dur)}
                                    </span>
                                  </div>
                                );
                              },
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

              {/* Response SubTab: Queries */}
              {responseSubTab === 'queries' && (
                <div>
                  {response.profile?.queries?.length > 0 ? (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      {response.profile.queries.map((q: any, idx: number) => (
                        <div
                          key={idx}
                          style={{
                            padding: '10px',
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              marginBottom: '4px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '10px',
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--warning)',
                                fontWeight: 600,
                              }}
                            >
                              DATABASE QUERY
                            </span>
                            <span
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '11px',
                                color: 'var(--text-muted)',
                              }}
                            >
                              {formatDuration(q.duration)}
                            </span>
                          </div>
                          <pre
                            style={{
                              margin: 0,
                              fontFamily: 'var(--font-mono)',
                              fontSize: '11px',
                              color: 'var(--text-primary)',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {q.sql || q.query || JSON.stringify(q)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <Database size={20} />
                      <span>
                        No database queries recorded for this request.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Response SubTab: Tests & Scripts */}
              {responseSubTab === 'tests' && (
                <div>
                  {preRequestResults || scriptTestResults ? (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '16px',
                      }}
                    >
                      {/* 1. Pre-request Execution Card (if executed) */}
                      {preRequestResults && (
                        <div
                          style={{
                            padding: '12px',
                            background: 'var(--bg-secondary)',
                            border: `1px solid ${preRequestResults.error ? 'var(--error)' : 'var(--border)'}`,
                            borderRadius: 'var(--radius-sm)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                              }}
                            >
                              <Zap
                                size={14}
                                style={{
                                  color: preRequestResults.success
                                    ? 'var(--success)'
                                    : 'var(--error)',
                                }}
                              />
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  color: 'var(--text-primary)',
                                }}
                              >
                                Pre-request Script Execution
                              </span>
                              <span
                                style={{
                                  padding: '2px 6px',
                                  borderRadius: 'var(--radius-xs)',
                                  fontSize: '9.5px',
                                  fontWeight: 700,
                                  textTransform: 'uppercase',
                                  background: preRequestResults.success
                                    ? 'rgba(34, 197, 94, 0.15)'
                                    : 'rgba(239, 68, 68, 0.15)',
                                  color: preRequestResults.success
                                    ? 'var(--success)'
                                    : 'var(--error)',
                                }}
                              >
                                {preRequestResults.success
                                  ? 'Passed'
                                  : 'Failed'}
                              </span>
                            </div>
                            <span
                              style={{
                                fontSize: '11px',
                                color: 'var(--text-muted)',
                                fontFamily: 'var(--font-mono)',
                              }}
                            >
                              {preRequestResults.durationMs} ms
                            </span>
                          </div>

                          {preRequestResults.error && (
                            <div
                              style={{
                                padding: '8px 10px',
                                borderRadius: 'var(--radius-xs)',
                                background: 'rgba(239, 68, 68, 0.1)',
                                border: '1px solid var(--error)',
                                color: 'var(--error)',
                                fontSize: '11.5px',
                                fontFamily: 'var(--font-mono)',
                              }}
                            >
                              <strong>Script Error: </strong>{' '}
                              {preRequestResults.error}
                            </div>
                          )}

                          {/* Mutated Headers Preview */}
                          {preRequestResults.mutatedHeaders &&
                            Object.keys(preRequestResults.mutatedHeaders)
                              .length > 0 && (
                              <div>
                                <span
                                  style={{
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    color: 'var(--text-secondary)',
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  Outgoing Headers Added/Updated:
                                </span>
                                <div
                                  style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '6px',
                                    marginTop: '4px',
                                  }}
                                >
                                  {Object.entries(
                                    preRequestResults.mutatedHeaders,
                                  ).map(([k, v]) => (
                                    <span
                                      key={k}
                                      style={{
                                        fontSize: '11px',
                                        fontFamily: 'var(--font-mono)',
                                        padding: '2px 6px',
                                        borderRadius: 'var(--radius-xs)',
                                        background: 'var(--bg-primary)',
                                        border: '1px solid var(--border)',
                                        color: 'var(--accent-text)',
                                      }}
                                    >
                                      <strong>{k}:</strong> {String(v)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                          {/* Mutated Query Params Preview */}
                          {preRequestResults.mutatedParams &&
                            Object.keys(preRequestResults.mutatedParams)
                              .length > 0 && (
                              <div>
                                <span
                                  style={{
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    color: 'var(--text-secondary)',
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  Query Params Added/Updated:
                                </span>
                                <div
                                  style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '6px',
                                    marginTop: '4px',
                                  }}
                                >
                                  {Object.entries(
                                    preRequestResults.mutatedParams,
                                  ).map(([k, v]) => (
                                    <span
                                      key={k}
                                      style={{
                                        fontSize: '11px',
                                        fontFamily: 'var(--font-mono)',
                                        padding: '2px 6px',
                                        borderRadius: 'var(--radius-xs)',
                                        background: 'var(--bg-primary)',
                                        border: '1px solid var(--border)',
                                        color: 'var(--text-primary)',
                                      }}
                                    >
                                      <strong>{k}:</strong> {String(v)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                          {/* Mutated Environment Variables Preview */}
                          {preRequestResults.mutatedEnv &&
                            Object.keys(preRequestResults.mutatedEnv).length >
                              0 && (
                              <div>
                                <span
                                  style={{
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    color: 'var(--text-secondary)',
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  Environment Variables Updated:
                                </span>
                                <div
                                  style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '6px',
                                    marginTop: '4px',
                                  }}
                                >
                                  {Object.entries(
                                    preRequestResults.mutatedEnv,
                                  ).map(([k, v]) => (
                                    <span
                                      key={k}
                                      style={{
                                        fontSize: '11px',
                                        fontFamily: 'var(--font-mono)',
                                        padding: '2px 6px',
                                        borderRadius: 'var(--radius-xs)',
                                        background: 'var(--bg-primary)',
                                        border: '1px solid var(--border)',
                                        color: 'var(--success)',
                                      }}
                                    >
                                      <strong>{k} =</strong> {String(v)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                          {/* Console Logs Preview */}
                          {preRequestResults.logs &&
                            preRequestResults.logs.length > 0 && (
                              <div>
                                <span
                                  style={{
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    color: 'var(--text-secondary)',
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  Pre-request Script Logs (
                                  {preRequestResults.logs.length}):
                                </span>
                                <pre
                                  style={{
                                    margin: '4px 0 0 0',
                                    padding: '8px 10px',
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 'var(--radius-xs)',
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '11px',
                                    color: 'var(--accent-text)',
                                    whiteSpace: 'pre-wrap',
                                    maxHeight: '120px',
                                    overflowY: 'auto',
                                  }}
                                >
                                  {preRequestResults.logs.join('\n')}
                                </pre>
                              </div>
                            )}
                        </div>
                      )}

                      {/* 2. Post-response Test Assertions Card (if executed) */}
                      {scriptTestResults && (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                              }}
                            >
                              <Activity
                                size={14}
                                style={{
                                  color: scriptTestResults.success
                                    ? 'var(--success)'
                                    : 'var(--error)',
                                }}
                              />
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  color: 'var(--text-primary)',
                                }}
                              >
                                Post-response Test Assertions
                              </span>
                              <span
                                style={{
                                  padding: '2px 7px',
                                  fontSize: '10px',
                                  fontWeight: 600,
                                  borderRadius: 'var(--radius-xs)',
                                  background: scriptTestResults.success
                                    ? 'rgba(34, 197, 94, 0.15)'
                                    : 'rgba(239, 68, 68, 0.15)',
                                  color: scriptTestResults.success
                                    ? 'var(--success)'
                                    : 'var(--error)',
                                }}
                              >
                                {scriptTestResults.success
                                  ? 'All Assertions Passed'
                                  : 'Assertions Failed'}
                              </span>
                            </div>
                            <span
                              style={{
                                fontSize: '11px',
                                color: 'var(--text-muted)',
                              }}
                            >
                              Passed:{' '}
                              {
                                scriptTestResults.tests.filter((t) => t.passed)
                                  .length
                              }{' '}
                              / {scriptTestResults.tests.length}
                            </span>
                          </div>

                          {scriptTestResults.error && (
                            <div
                              style={{
                                padding: '10px',
                                borderRadius: 'var(--radius-sm)',
                                background: 'rgba(239, 68, 68, 0.1)',
                                border: '1px solid var(--error)',
                                color: 'var(--error)',
                                fontSize: '12px',
                                fontFamily: 'var(--font-mono)',
                              }}
                            >
                              <strong>Script Error: </strong>{' '}
                              {scriptTestResults.error}
                            </div>
                          )}

                          {/* Assertions list */}
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                            }}
                          >
                            {scriptTestResults.tests.map((t, idx) => (
                              <div
                                key={idx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  padding: '8px 12px',
                                  background: 'var(--bg-secondary)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 'var(--radius-xs)',
                                  fontSize: '12px',
                                }}
                              >
                                {t.passed ? (
                                  <CheckCircle2
                                    size={14}
                                    style={{
                                      color: 'var(--success)',
                                      flexShrink: 0,
                                    }}
                                  />
                                ) : (
                                  <XCircle
                                    size={14}
                                    style={{
                                      color: 'var(--error)',
                                      flexShrink: 0,
                                    }}
                                  />
                                )}
                                <span
                                  style={{
                                    fontWeight: 500,
                                    color: 'var(--text-primary)',
                                    flex: 1,
                                  }}
                                >
                                  {t.name}
                                </span>
                                <span
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '10px',
                                    color: 'var(--text-muted)',
                                  }}
                                >
                                  {t.durationMs} ms
                                </span>
                                {t.error && (
                                  <div
                                    style={{
                                      width: '100%',
                                      marginTop: '4px',
                                      fontSize: '11px',
                                      color: 'var(--error)',
                                      fontFamily: 'var(--font-mono)',
                                    }}
                                  >
                                    {t.error}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Console logs */}
                          {scriptTestResults.logs.length > 0 && (
                            <div style={{ marginTop: '4px' }}>
                              <span
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  color: 'var(--text-muted)',
                                  textTransform: 'uppercase',
                                }}
                              >
                                Test Script Logs (
                                {scriptTestResults.logs.length}):
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
                                  color: 'var(--accent)',
                                  whiteSpace: 'pre-wrap',
                                  maxHeight: '120px',
                                  overflowY: 'auto',
                                }}
                              >
                                {scriptTestResults.logs.join('\n')}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <Activity size={20} />
                      <span>
                        No test assertions or pre-request scripts executed. Add
                        scripts in the Pre-request or Tests tab in the workbench
                        above.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Route Selector Modal Triggered by 'Routes' button ─────── */}
      {routePickerOpen && (
        <RouteSelector
          routes={discovery.routes || []}
          selectedMethod={method}
          selectedPath={path}
          openapi={discovery.openapi}
          defaultOpen={true}
          onClose={() => setRoutePickerOpen(false)}
          onSelectRoute={(m, p) => {
            setRoutePickerOpen(false);
            setMethod(m);
            setPath(p);
            prefillFromRoute(m, p);
          }}
        />
      )}

      {/* ── Collection Runner & Automated Batch Tester Modal ────────── */}
      <CollectionRunner
        discovery={discovery}
        collections={collections}
        initialCollectionId={runnerTargetCollectionId || selectedCollectionId}
        environments={environments}
        initialEnvironmentId={selectedEnvironmentId}
        isOpen={runnerModalOpen}
        onClose={() => setRunnerModalOpen(false)}
      />
    </div>
  );
};

export default RequestBuilder;
