import Editor, { Monaco } from '@monaco-editor/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DiscoveryData } from '../types';
import { apiFetch } from '../utils/api';
import {
  extractPlaygroundOperations,
  getPlaygroundCompletionQuery,
  getPlaygroundPropertyCompletionContext,
  playgroundRuntimeDeclarations,
} from '../utils/playground-intellisense';

interface PlaygroundProps {
  discovery: DiscoveryData;
  isDark: boolean;
}

interface SdkFile {
  path: string;
  content: string;
}

interface SdkData {
  starterCode: string;
  files: SdkFile[];
  appBaseUrl?: string;
}

interface CompletionMenu {
  kind: 'method' | 'property';
  query: string;
  selectedIndex: number;
  left: number;
  top: number;
  operationName?: string;
  usedPropertyNames?: string[];
}

interface CompletionItem {
  kind: 'method' | 'property';
  name: string;
  detail: string;
  documentation: string;
}

interface RunHistoryItem {
  id: string;
  timestamp: string;
  target: string;
  code: string;
  status: 'success' | 'error';
  details: any;
}

export const Playground: React.FC<PlaygroundProps> = ({
  discovery,
  isDark,
}) => {
  const [target, setTarget] = useState('typescript');
  const [starterCode, setStarterCode] = useState('');
  const [sdkFiles, setSdkFiles] = useState<SdkFile[]>([]);
  const [code, setCode] = useState('');
  const [leftTab, setLeftTab] = useState<'editor' | 'preview'>('editor');
  const [rightTab, setRightTab] = useState<'terminal' | 'response' | 'history'>(
    'terminal',
  );
  const [terminalLogs, setTerminalLogs] = useState<
    { type: 'info' | 'warn' | 'error'; text: string }[]
  >([
    {
      type: 'info',
      text: "[INFO] Terminal ready. Write your TypeScript client code and click 'Run Code'.",
    },
  ]);
  const [responsePreview, setResponsePreview] = useState<any | null>(null);
  const [selectedPreviewFile, setSelectedPreviewFile] = useState('');
  const [history, setHistory] = useState<RunHistoryItem[]>([]);
  const [running, setRunning] = useState(false);
  const [editorLoading, setEditorLoading] = useState(true);
  const [intellisenseReady, setIntellisenseReady] = useState(false);
  const [appBaseUrl, setAppBaseUrl] = useState('http://localhost:3000');
  const [completionMenu, setCompletionMenu] = useState<CompletionMenu | null>(
    null,
  );

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const intellisenseDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const editorDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const sdkOperations = useMemo(
    () => extractPlaygroundOperations(sdkFiles),
    [sdkFiles],
  );
  const sdkOperationsRef = useRef(sdkOperations);
  const completionMenuRef = useRef<CompletionMenu | null>(null);
  const targetRef = useRef(target);
  sdkOperationsRef.current = sdkOperations;
  completionMenuRef.current = completionMenu;
  targetRef.current = target;

  // Load SDK details and run history on mount
  useEffect(() => {
    fetchSdk();
    loadHistory();
  }, []);

  // Sync types and compiler settings when sdkFiles or editor mounts
  useEffect(() => {
    if (monacoRef.current && sdkFiles.length > 0) {
      configureMonacoTypes(monacoRef.current);
    }
  }, [sdkFiles]);

  useEffect(
    () => () => {
      intellisenseDisposablesRef.current.forEach((disposable) =>
        disposable.dispose(),
      );
      editorDisposablesRef.current.forEach((disposable) =>
        disposable.dispose(),
      );
    },
    [],
  );

  const fetchSdk = async (targetParam: string = 'typescript') => {
    try {
      const res = await apiFetch(
        `/__studio/api/playground/sdk?target=${targetParam}`,
      );
      if (res.ok) {
        const data: SdkData = await res.json();
        setStarterCode(data.starterCode);
        setSdkFiles(data.files);
        setCode(data.starterCode);
        setAppBaseUrl(data.appBaseUrl || 'http://localhost:3000');
        setCompletionMenu(null);
        if (data.files.length > 0) {
          setSelectedPreviewFile(data.files[0].path);
        }
      }
    } catch (err) {
      console.error('Failed to fetch SDK files:', err);
    }
  };

  const loadHistory = () => {
    try {
      const raw = localStorage.getItem('axiomify_pg_history');
      if (raw) setHistory(JSON.parse(raw));
    } catch (e) {
      console.error('Failed to parse history:', e);
    }
  };

  const saveHistory = (items: RunHistoryItem[]) => {
    setHistory(items);
    localStorage.setItem('axiomify_pg_history', JSON.stringify(items));
  };

  const addHistoryItem = (
    codeStr: string,
    status: 'success' | 'error',
    details: any,
  ) => {
    const item: RunHistoryItem = {
      id: 'pgh-' + Date.now(),
      timestamp: new Date().toISOString(),
      target,
      code: codeStr,
      status,
      details,
    };
    const updated = [item, ...history].slice(0, 30);
    saveHistory(updated);
  };

  const handleTargetChange = async (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const nextTarget = e.target.value;
    setTarget(nextTarget);
    appendLog(
      'info',
      `[SYSTEM] Switching target to ${nextTarget.toUpperCase()} and generating SDK...`,
    );
    await fetchSdk(nextTarget);
    appendLog(
      'info',
      `[SYSTEM] ${nextTarget.toUpperCase()} SDK generated and starter code loaded.`,
    );
  };

  const appendLog = (type: 'info' | 'warn' | 'error', text: string) => {
    setTerminalLogs((prev) => [...prev, { type, text }]);
  };

  const clearLogs = () => setTerminalLogs([]);

  const configureMonacoTypes = (monaco: Monaco) => {
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
    });

    // Clear old extra libs to avoid duplicates
    monaco.languages.typescript.typescriptDefaults.setExtraLibs([]);

    // Register mock dependencies
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      'declare module "zod" { export const z: any; export type ZodTypeAny = any; }',
      'file:///node_modules/zod/index.d.ts',
    );
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      playgroundRuntimeDeclarations,
      'file:///node_modules/@axiomify/sdk-runtime/index.d.ts',
    );

    // Register the generated source files as a coherent virtual TypeScript
    // project. This lets standard Monaco IntelliSense infer SDK request and
    // response types rather than treating client as `any`.
    sdkFiles
      .filter((file) => file.path.endsWith('.ts') && file.path !== 'hooks.ts')
      .forEach((file) => {
        monaco.languages.typescript.typescriptDefaults.addExtraLib(
          file.content,
          `file:///${file.path}`,
        );
      });

    // Register sdk.ts to map the export paths in root namespace
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      `export * from './client';
export * from './types';
export * from './validators';`,
      'file:///sdk.ts',
    );

    registerSdkIntellisense(monaco);
    setIntellisenseReady(sdkOperations.length > 0);
  };

  const registerSdkIntellisense = (monaco: Monaco) => {
    intellisenseDisposablesRef.current.forEach((disposable) =>
      disposable.dispose(),
    );
    intellisenseDisposablesRef.current = [];
    if (sdkOperations.length === 0) return;

    const findOperation = (name: string) =>
      sdkOperations.find((operation) => operation.name === name);
    intellisenseDisposablesRef.current.push(
      monaco.languages.registerHoverProvider('typescript', {
        provideHover: (model: any, position: any) => {
          const word = model.getWordAtPosition(position)?.word;
          const operation = word ? findOperation(word) : undefined;
          if (!operation) return null;
          return {
            contents: [
              { value: `\`\`\`typescript\n${operation.signature}\n\`\`\`` },
              { value: operation.documentation },
            ],
          };
        },
      }),
      monaco.languages.registerSignatureHelpProvider('typescript', {
        signatureHelpTriggerCharacters: ['(', ','],
        provideSignatureHelp: (model: any, position: any) => {
          const linePrefix = model
            .getLineContent(position.lineNumber)
            .slice(0, position.column - 1);
          const match = /client\.([A-Za-z_$][\w$]*)\([^)]*$/.exec(linePrefix);
          const operation = match ? findOperation(match[1]) : undefined;
          if (!operation) return null;
          return {
            value: {
              activeParameter: 0,
              activeSignature: 0,
              signatures: [
                {
                  label: operation.signature,
                  documentation: operation.documentation,
                  parameters: [],
                },
              ],
            },
            dispose: () => {},
          };
        },
      }),
    );
  };

  const getCompletionItems = (
    menu: CompletionMenu | null,
  ): CompletionItem[] => {
    if (!menu) return [];
    if (menu.kind === 'property') {
      const operation = sdkOperationsRef.current.find(
        (item) => item.name === menu.operationName,
      );
      const used = new Set(menu.usedPropertyNames || []);
      return (operation?.parameters || [])
        .filter((parameter) => !used.has(parameter.name))
        .filter((parameter) =>
          parameter.name.toLowerCase().startsWith(menu.query.toLowerCase()),
        )
        .map((parameter) => ({
          kind: 'property' as const,
          name: parameter.name,
          detail: `${parameter.name}${parameter.optional ? '?' : ''}: ${parameter.type}`,
          documentation: `${parameter.optional ? 'Optional' : 'Required'} request field for ${operation?.name}.`,
        }));
    }

    return sdkOperationsRef.current
      .filter((operation) =>
        operation.name.toLowerCase().startsWith(menu.query.toLowerCase()),
      )
      .map((operation) => ({
        kind: 'method' as const,
        name: operation.name,
        detail: operation.signature,
        documentation: operation.documentation,
      }));
  };

  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setEditorLoading(false);
    configureMonacoTypes(monaco);
    editorDisposablesRef.current.forEach((disposable) => disposable.dispose());
    const updateCompletionMenu = (force = false) => {
      if (targetRef.current !== 'typescript') {
        setCompletionMenu(null);
        return;
      }
      const position = editor.getPosition();
      const model = editor.getModel();
      if (!position || !model) return;
      const prefix = model
        .getLineContent(position.lineNumber)
        .slice(0, position.column - 1);
      const propertyContext = getPlaygroundPropertyCompletionContext(prefix);
      const methodQuery = propertyContext
        ? null
        : getPlaygroundCompletionQuery(prefix);
      const nextMenu: CompletionMenu | null = propertyContext
        ? {
            kind: 'property',
            query: propertyContext.query,
            selectedIndex: 0,
            left: 0,
            top: 0,
            operationName: propertyContext.operationName,
            usedPropertyNames: propertyContext.usedPropertyNames,
          }
        : methodQuery === null
          ? null
          : {
              kind: 'method',
              query: methodQuery,
              selectedIndex: 0,
              left: 0,
              top: 0,
            };
      const matches = getCompletionItems(nextMenu);
      if ((!force && !nextMenu) || matches.length === 0) {
        setCompletionMenu(null);
        return;
      }
      const visiblePosition = editor.getScrolledVisiblePosition(position);
      if (!visiblePosition) return;
      setCompletionMenu({
        ...nextMenu!,
        left: Math.max(12, visiblePosition.left),
        top:
          visiblePosition.top +
          editor.getOption(monaco.editor.EditorOption.lineHeight),
      });
    };
    editorDisposablesRef.current = [
      editor.onDidChangeModelContent(() => updateCompletionMenu()),
      editor.onDidChangeCursorSelection(() => updateCompletionMenu()),
      editor.onKeyDown((event: any) => {
        if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
          event.preventDefault();
          updateCompletionMenu(true);
          return;
        }
        const currentMenu = completionMenuRef.current;
        if (!currentMenu) return;
        const visibleMatches = getCompletionItems(currentMenu);
        if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
          event.preventDefault();
          setCompletionMenu((current) =>
            current
              ? {
                  ...current,
                  selectedIndex:
                    (current.selectedIndex +
                      (event.code === 'ArrowDown' ? 1 : -1) +
                      visibleMatches.length) %
                    visibleMatches.length,
                }
              : null,
          );
        } else if (event.code === 'Enter' || event.code === 'Tab') {
          const item = visibleMatches[currentMenu.selectedIndex];
          if (!item) return;
          event.preventDefault();
          applySdkCompletion(item);
        } else if (event.code === 'Escape') {
          setCompletionMenu(null);
        }
      }),
    ];
    updateCompletionMenu();
  };

  const completionMatches = getCompletionItems(completionMenu);

  const applySdkCompletion = (item: CompletionItem) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const position = editor?.getPosition();
    const model = editor?.getModel();
    if (!editor || !monaco || !position || !model) return;
    const prefix = model
      .getLineContent(position.lineNumber)
      .slice(0, position.column - 1);
    const propertyContext = getPlaygroundPropertyCompletionContext(prefix);
    const query = propertyContext
      ? propertyContext.query
      : getPlaygroundCompletionQuery(prefix);
    if (query === null) return;
    const propertyName = /^[A-Za-z_$][\w$]*$/.test(item.name)
      ? item.name
      : `'${item.name}'`;
    editor.executeEdits('axiomify-sdk-completion', [
      {
        range: new monaco.Range(
          position.lineNumber,
          position.column - query.length,
          position.lineNumber,
          position.column,
        ),
        text: item.kind === 'property' ? `${propertyName}: ` : item.name,
      },
    ]);
    setCompletionMenu(null);
    editor.focus();
  };

  const handleAppBaseUrlChange = (nextUrl: string) => {
    setAppBaseUrl(nextUrl);
    const nextCode = (
      editorRef.current ? editorRef.current.getValue() : code
    ).replace(
      /baseUrl:\s*(['"])[^'"\n]*\1/,
      `baseUrl: '${nextUrl.replace(/'/g, "\\'")}'`,
    );
    if (editorRef.current) editorRef.current.setValue(nextCode);
    setCode(nextCode);
  };

  const handleRunCode = async () => {
    const codeToRun = editorRef.current ? editorRef.current.getValue() : code;
    setRunning(true);
    setRightTab('terminal');
    appendLog('info', '[SYSTEM] Transpiling and executing code...');

    try {
      const res = await apiFetch('/__studio/api/playground/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeToRun, target }),
      });
      const data = await res.json();

      let lastJsonObject = null;
      let status: 'success' | 'error' = 'success';

      if (data.error) {
        status = 'error';
        appendLog('error', '[ERROR] ' + data.error);
        if (data.message) appendLog('warn', '[INFO] ' + data.message);
      } else {
        if (data.logs && data.logs.length > 0) {
          data.logs.forEach((log: string) => {
            appendLog('info', log);
            try {
              const trimmed = log.trim();
              if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                lastJsonObject = JSON.parse(trimmed);
              } else if (log.includes('Result: ')) {
                const jsonPart = log.substring(log.indexOf('Result: ') + 8);
                lastJsonObject = JSON.parse(jsonPart);
              }
            } catch {}
          });
        }

        if (data.errors && data.errors.length > 0) {
          status = 'error';
          data.errors.forEach((err: string) => {
            appendLog('error', '[ERROR] ' + err);
          });
        }

        if (
          (!data.logs || data.logs.length === 0) &&
          (!data.errors || data.errors.length === 0)
        ) {
          appendLog(
            'info',
            '[SYSTEM] Execution finished successfully (no logs emitted).',
          );
        }
      }

      addHistoryItem(codeToRun, status, data);

      if (data.error) {
        setResponsePreview({ error: data.error });
      } else if (lastJsonObject) {
        setResponsePreview(lastJsonObject);
      } else {
        setResponsePreview(null);
      }
    } catch (err: any) {
      appendLog('error', '[ERROR] Execution failed: ' + String(err));
      addHistoryItem(codeToRun, 'error', { error: String(err) });
      setResponsePreview({ error: String(err) });
    } finally {
      setRunning(false);
    }
  };

  const handleResetCode = () => {
    if (editorRef.current) {
      editorRef.current.setValue(starterCode);
    } else {
      setCode(starterCode);
    }
    appendLog('info', '[SYSTEM] Starter code reset.');
  };

  const handleFormatCode = async () => {
    const editor = editorRef.current;
    if (!editor) return;

    try {
      const before = editor.getValue();
      const formatAction = editor.getAction('editor.action.formatDocument');
      if (!formatAction) {
        appendLog(
          'warn',
          '[INFO] Formatting is not available for this language target.',
        );
        return;
      }
      await formatAction.run();
      const formattedCode = editor.getValue();
      setCode(formattedCode);
      appendLog(
        'info',
        before === formattedCode
          ? '[SYSTEM] Code is already formatted.'
          : '[SYSTEM] Code formatted.',
      );
    } catch (error) {
      console.error('Failed to format Playground code:', error);
      appendLog('error', '[ERROR] Could not format the current code.');
    }
  };

  const loadHistoryItem = (item: RunHistoryItem) => {
    if (editorRef.current) {
      editorRef.current.setValue(item.code);
    } else {
      setCode(item.code);
    }
    setLeftTab('editor');
    appendLog(
      'info',
      `[SYSTEM] Loaded run code from history (${new Date(item.timestamp).toLocaleTimeString()}).`,
    );
  };

  const currentPreviewFileContent =
    sdkFiles.find((f) => f.path === selectedPreviewFile)?.content || '';

  const getMonacoLanguage = (filePath: string) => {
    if (filePath.endsWith('.py')) return 'python';
    if (filePath.endsWith('.dart')) return 'dart';
    if (filePath.endsWith('.yaml')) return 'yaml';
    if (filePath.endsWith('.json')) return 'json';
    return 'typescript';
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
          <div className="panel-title">SDK Playground</div>
          <div className="panel-subtitle">
            Test your auto-generated Client SDK with language target selection
            and inline execution
          </div>
          {target === 'typescript' && (
            <div
              style={{
                color: intellisenseReady
                  ? 'var(--success)'
                  : 'var(--text-muted)',
                fontSize: '11px',
                marginTop: '4px',
              }}
            >
              {intellisenseReady
                ? `✓ SDK IntelliSense ready — type client. for ${sdkOperations.length} route method${sdkOperations.length === 1 ? '' : 's'}`
                : 'Loading generated SDK types…'}
            </div>
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '8px',
              fontSize: '12px',
            }}
          >
            <label
              htmlFor="playground-base-url"
              style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}
            >
              API base URL
            </label>
            <input
              id="playground-base-url"
              className="text-input"
              value={appBaseUrl}
              onChange={(event) => handleAppBaseUrlChange(event.target.value)}
              aria-label="API base URL for Playground requests"
              style={{
                width: '260px',
                padding: '5px 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
              }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select
            id="playground-target-select"
            className="select-input"
            style={{
              margin: 0,
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: 'var(--radius-sm)',
              width: 'auto',
            }}
            value={target}
            onChange={handleTargetChange}
          >
            <option value="typescript">TypeScript Target</option>
            <option value="python">Python Target</option>
            <option value="dart">Dart Target</option>
          </select>
          <button className="btn" onClick={handleRunCode} disabled={running}>
            {running ? 'Running...' : '▶ Run Code'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleFormatCode}
            disabled={editorLoading}
            title="Format document (Shift+Alt+F)"
          >
            ✨ Format Code
          </button>
          <button className="btn btn-secondary" onClick={handleResetCode}>
            🔄 Reset starter
          </button>
        </div>
      </div>

      <div className="playground-grid">
        {/* Left Section: Client Editor or SDK Files Preview */}
        <div
          className="tester-section"
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          <div
            style={{
              display: 'flex',
              gap: '8px',
              borderBottom: '1px solid var(--border)',
              marginBottom: '12px',
              paddingBottom: '6px',
            }}
          >
            <button
              className={`btn btn-secondary ${leftTab === 'editor' ? 'active-tab-btn' : ''}`}
              style={{ margin: 0, padding: '4px 10px', fontSize: '12px' }}
              onClick={() => setLeftTab('editor')}
            >
              💻 Client Editor
            </button>
            <button
              className={`btn btn-secondary ${leftTab === 'preview' ? 'active-tab-btn' : ''}`}
              style={{ margin: 0, padding: '4px 10px', fontSize: '12px' }}
              onClick={() => setLeftTab('preview')}
            >
              📂 SDK Files Preview
            </button>
          </div>

          {leftTab === 'editor' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div
                style={{
                  height: '550px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {editorLoading && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--bg-secondary)',
                      zIndex: 10,
                    }}
                  >
                    <div className="spinner" />
                    <span
                      style={{
                        marginLeft: '8px',
                        fontSize: '13px',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Initializing Monaco Editor...
                    </span>
                  </div>
                )}
                <Editor
                  height="550px"
                  language={target === 'typescript' ? 'typescript' : target}
                  theme={isDark ? 'vs-dark' : 'light'}
                  value={code}
                  path={target === 'typescript' ? 'file:///main.ts' : undefined}
                  onChange={(val) => setCode(val || '')}
                  onMount={handleEditorDidMount}
                  options={{
                    automaticLayout: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    fontFamily: 'JetBrains Mono, Menlo, monospace',
                    suggest: {
                      showMethods: false,
                      showFunctions: false,
                      showWords: false,
                    },
                    quickSuggestions: false,
                    suggestOnTriggerCharacters: false,
                  }}
                />
                {completionMenu && completionMatches.length > 0 && (
                  <div
                    role="listbox"
                    aria-label="SDK method suggestions"
                    style={{
                      position: 'absolute',
                      top: `${completionMenu.top}px`,
                      left: `${completionMenu.left}px`,
                      width: 'min(430px, calc(100% - 24px))',
                      maxHeight: '250px',
                      overflowY: 'auto',
                      zIndex: 20,
                      border: '1px solid #4a4a6e',
                      borderRadius: '6px',
                      background: '#171722',
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
                      padding: '4px',
                    }}
                  >
                    <div
                      style={{
                        color: '#a9a9c4',
                        fontSize: '10px',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        padding: '5px 8px',
                        textTransform: 'uppercase',
                      }}
                    >
                      {completionMenu.kind === 'property'
                        ? `${completionMenu.operationName} request fields`
                        : 'SDK methods'}
                    </div>
                    {completionMatches.map((item, index) => (
                      <button
                        key={`${item.kind}-${item.name}`}
                        role="option"
                        aria-selected={completionMenu.selectedIndex === index}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applySdkCompletion(item)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                          width: '100%',
                          border: 0,
                          borderRadius: '4px',
                          cursor: 'pointer',
                          padding: '7px 8px',
                          textAlign: 'left',
                          background:
                            completionMenu.selectedIndex === index
                              ? '#343153'
                              : 'transparent',
                          color: '#f2f2fa',
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '12px',
                            fontWeight: 700,
                          }}
                        >
                          {item.name}
                        </span>
                        <span
                          style={{
                            color: '#b8b8cc',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '10px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.detail}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {leftTab === 'preview' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                  }}
                >
                  Generated Files:
                </span>
                <select
                  className="select-input"
                  style={{
                    margin: 0,
                    padding: '4px 8px',
                    fontSize: '12px',
                    flex: 1,
                    width: 'auto',
                  }}
                  value={selectedPreviewFile}
                  onChange={(e) => setSelectedPreviewFile(e.target.value)}
                >
                  {sdkFiles.length === 0 ? (
                    <option value="">-- No files generated --</option>
                  ) : (
                    sdkFiles.map((f) => (
                      <option key={f.path} value={f.path}>
                        {f.path}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div
                style={{
                  height: '500px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                }}
              >
                <Editor
                  height="500px"
                  language={getMonacoLanguage(selectedPreviewFile)}
                  theme={isDark ? 'vs-dark' : 'light'}
                  value={currentPreviewFileContent}
                  options={{
                    automaticLayout: true,
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    fontFamily: 'JetBrains Mono, Menlo, monospace',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Section: Console, Response Preview, or History */}
        <div
          className="tester-section"
          style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid var(--border)',
              marginBottom: '12px',
              paddingBottom: '6px',
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className={`btn btn-secondary ${rightTab === 'terminal' ? 'active-tab-btn' : ''}`}
                style={{ margin: 0, padding: '4px 10px', fontSize: '12px' }}
                onClick={() => setRightTab('terminal')}
              >
                🖥️ Output Terminal
              </button>
              <button
                className={`btn btn-secondary ${rightTab === 'response' ? 'active-tab-btn' : ''}`}
                style={{ margin: 0, padding: '4px 10px', fontSize: '12px' }}
                onClick={() => setRightTab('response')}
              >
                📦 Response Preview
              </button>
              <button
                className={`btn btn-secondary ${rightTab === 'history' ? 'active-tab-btn' : ''}`}
                style={{ margin: 0, padding: '4px 10px', fontSize: '12px' }}
                onClick={() => setRightTab('history')}
              >
                📜 Request History
              </button>
            </div>
            {rightTab === 'terminal' && (
              <button
                className="btn btn-secondary"
                style={{ padding: '2px 8px', fontSize: '11px', margin: 0 }}
                onClick={clearLogs}
              >
                Clear Terminal
              </button>
            )}
          </div>

          {rightTab === 'terminal' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                height: '100%',
              }}
            >
              <div
                className="console-terminal"
                style={{
                  minHeight: '510px',
                  maxHeight: '510px',
                  textAlign: 'left',
                }}
              >
                {terminalLogs.map((log, i) => (
                  <div key={i} className={`console-line ${log.type}`}>
                    {log.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          {rightTab === 'response' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div
                className="console-terminal"
                style={{
                  minHeight: '510px',
                  maxHeight: '510px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '12px',
                  padding: '16px',
                  overflowY: 'auto',
                  lineHeight: 1.5,
                  textAlign: 'left',
                }}
              >
                {responsePreview ? (
                  <pre style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>
                    {JSON.stringify(responsePreview, null, 2)}
                  </pre>
                ) : (
                  <div
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '13px',
                      textAlign: 'center',
                      paddingTop: '40px',
                    }}
                  >
                    No response payload captured yet. Run client code that
                    prints an object or response.
                  </div>
                )}
              </div>
            </div>
          )}

          {rightTab === 'history' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  minHeight: '510px',
                  maxHeight: '510px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  paddingRight: '4px',
                }}
              >
                {history.length === 0 ? (
                  <div
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '13px',
                      textAlign: 'center',
                      paddingTop: '40px',
                    }}
                  >
                    No code execution history recorded. Run code to add history.
                  </div>
                ) : (
                  history.map((item) => (
                    <div
                      key={item.id}
                      className="card"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        padding: '10px 14px',
                        cursor: 'pointer',
                        margin: 0,
                        textAlign: 'left',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                      onClick={() => loadHistoryItem(item)}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span
                          className="method-badge method-POST"
                          style={{ fontSize: '9px', padding: '1px 4px' }}
                        >
                          {item.target.toUpperCase()}
                        </span>
                        <span
                          style={{
                            color:
                              item.status === 'success'
                                ? 'var(--success)'
                                : 'var(--error)',
                            fontWeight: 'bold',
                            fontSize: '11px',
                          }}
                        >
                          {item.status.toUpperCase()}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--text-secondary)',
                          textOverflow: 'ellipsis',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          marginTop: '2px',
                        }}
                      >
                        {item.code}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '10px',
                          color: 'var(--text-muted)',
                          marginTop: '4px',
                        }}
                      >
                        <span>{new Date(item.timestamp).toLocaleString()}</span>
                        <span
                          style={{ color: 'var(--accent)', fontWeight: 500 }}
                        >
                          Load code ➔
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
