import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../src/App';
import { makeStore } from '../src/store';
import { setDiscoveryData } from '../src/store/slices/discoverySlice';
import { toggleSidebar } from '../src/store/slices/uiSlice';
import { setToken } from '../src/utils/api';

beforeAll(() => {
  const store = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, val: string) => store.set(key, val),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] || null,
    length: 0,
  };
  globalThis.localStorage = mockLocalStorage as any;
  (globalThis as any).window = {
    location: {
      search: '?token=test-token',
      pathname: '/',
      hash: '',
    },
    history: {
      replaceState: () => { },
    },
    addEventListener: () => { },
    removeEventListener: () => { },
    localStorage: mockLocalStorage,
  };
  (globalThis as any).document = {
    title: 'Axiomify Studio',
    documentElement: {
      setAttribute: () => { },
      getAttribute: () => 'dark',
    },
  };
});

function renderAppStatic(collapse = true) {
  setToken('test-token');
  const store = makeStore();
  if (collapse) {
    store.dispatch(toggleSidebar());
  }
  store.dispatch(
    setDiscoveryData({
      routes: [
        { id: '1', path: '/api/v1/users', method: 'GET', isWs: false },
        { id: '2', path: '/api/v1/feed', method: 'GET', isWs: true },
      ],
      schemas: [{ name: 'User' }, { name: 'Post' }],
      services: [{ name: 'AuthService' }],
      middlewares: [{ name: 'RateLimit' }],
      events: [],
      hooks: [],
      errors: [],
    } as any),
  );

  return renderToStaticMarkup(
    <Provider store={store}>
      <App />
    </Provider>,
  );
}

describe('Collapsed Sidebar Tooltips & Accessibility', () => {
  it('renders data-tooltip and aria-label attributes on navigation items', () => {
    const markup = renderAppStatic(true);

    // Verify critical navigation items have data-tooltip and category
    expect(markup).toContain('data-tooltip="Request Tester"');
    expect(markup).toContain('data-tooltip-category="API Client"');
    expect(markup).toContain('aria-label="Request Tester"');

    expect(markup).toContain('data-tooltip="WebSocket Tester"');
    expect(markup).toContain('data-tooltip-badge="1"');
    expect(markup).toContain('aria-label="WebSocket Tester"');

    expect(markup).toContain('data-tooltip="Routes Index"');
    expect(markup).toContain('data-tooltip-category="Discovery &amp; Docs"');
    expect(markup).toContain('aria-label="Routes Index"');

    expect(markup).toContain('data-tooltip="Schemas"');
    expect(markup).toContain('data-tooltip-badge="2"');

    expect(markup).toContain('data-tooltip="Services"');
    expect(markup).toContain('data-tooltip-category="Architecture"');

    expect(markup).toContain('data-tooltip="Live Logs"');
    expect(markup).toContain('data-tooltip-category="Observability"');

    expect(markup).toContain('data-tooltip="Background Jobs"');
    expect(markup).toContain('data-tooltip-category="Tooling &amp; Quality"');
  });

  it('renders accessibility labels on brand and footer controls', () => {
    const markup = renderAppStatic(true);

    expect(markup).toContain('data-tooltip="Axiomify Studio"');
    expect(markup).toContain('aria-label="Axiomify Studio"');

    expect(markup).toContain('data-tooltip="Expand sidebar"');
    expect(markup).toContain('aria-label="Expand sidebar"');

    expect(markup).toContain('data-tooltip="Log out of Studio"');
    expect(markup).toContain('aria-label="Log out of Studio"');
  });
});
