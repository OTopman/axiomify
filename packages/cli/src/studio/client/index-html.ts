/**
 * Studio Frontend — Index HTML builder.
 *
 * Generates the full SPA shell as an inline HTML string. In Phase 1
 * this serves as a functional placeholder that:
 *   - Fetches and displays discovery data from the Studio API
 *   - Provides a professional-looking interface
 *   - Proves the full backend → frontend pipeline works
 *
 * In Phase 2+, this will be replaced with a pre-built SPA served from
 * static files, but the inline approach is deliberate for Phase 1 —
 * it eliminates the need for a separate frontend build step during
 * initial development.
 */

export function buildIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Axiomify Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #f8fafc;
      --bg-secondary: #ffffff;
      --bg-tertiary: #f1f5f9;
      --bg-hover: #f1f5f9;
      --bg-active: #e2e8f0;
      --text-primary: #0f172a;
      --text-secondary: #475569;
      --text-muted: #94a3b8;
      --border: #e2e8f0;
      --border-active: #cbd5e1;
      --accent: #4f46e5;
      --accent-glow: rgba(79, 70, 229, 0.06);
      --accent-text: #4f46e5;
      --success: #10b981;
      --warning: #f59e0b;
      --error: #ef4444;
      --info: #3b82f6;
      --method-get: #10b981;
      --method-post: #3b82f6;
      --method-put: #f59e0b;
      --method-patch: #f97316;
      --method-delete: #ef4444;
      --method-ws: #8b5cf6;
      --method-head: #64748b;
      --method-options: #64748b;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 16px;
      --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
      --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
      --shadow-glow: 0 0 20px var(--accent-glow);
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
      --transition: 180ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    [data-theme="dark"] {
      --bg-primary: #0a0a0f;
      --bg-secondary: #12121a;
      --bg-tertiary: #1a1a26;
      --bg-hover: #22223a;
      --bg-active: #2a2a44;
      --text-primary: #e8e8f0;
      --text-secondary: #9090a8;
      --text-muted: #606078;
      --border: #2a2a3e;
      --border-active: #4a4a6e;
      --accent: #6c5ce7;
      --accent-glow: rgba(108, 92, 231, 0.15);
      --accent-text: #a29bfe;
      --success: #00d2a0;
      --warning: #ffc107;
      --error: #ff6b6b;
      --info: #54a0ff;
      --method-get: #00d2a0;
      --method-post: #54a0ff;
      --method-put: #ffc107;
      --method-patch: #fd9644;
      --method-delete: #ff6b6b;
      --method-ws: #a29bfe;
      --method-head: #9090a8;
      --method-options: #9090a8;
      --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
      --shadow-md: 0 4px 20px rgba(0, 0, 0, 0.4);
      --shadow-glow: 0 0 30px var(--accent-glow);
    }

    [data-theme="dark"] .method-GET { background: rgba(0, 210, 160, 0.12); }
    [data-theme="dark"] .method-POST { background: rgba(84, 160, 255, 0.12); }
    [data-theme="dark"] .method-PUT { background: rgba(255, 193, 7, 0.12); }
    [data-theme="dark"] .method-PATCH { background: rgba(253, 150, 68, 0.12); }
    [data-theme="dark"] .method-DELETE { background: rgba(255, 107, 107, 0.12); }
    [data-theme="dark"] .method-WS { background: rgba(162, 155, 254, 0.12); }
    [data-theme="dark"] .method-HEAD { background: rgba(144, 144, 168, 0.12); }
    [data-theme="dark"] .method-OPTIONS { background: rgba(144, 144, 168, 0.12); }
    [data-theme="dark"] .deprecated-badge { background: rgba(255, 107, 107, 0.12); }
    [data-theme="dark"] .finding-card.severity-ok .finding-card-status-icon { background: rgba(0, 210, 160, 0.12); }
    [data-theme="dark"] .finding-card.severity-warn .finding-card-status-icon { background: rgba(255, 193, 7, 0.12); }
    [data-theme="dark"] .finding-card.severity-fail .finding-card-status-icon { background: rgba(255, 107, 107, 0.12); }

    .theme-toggle-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      width: 34px;
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 16px;
      transition: var(--transition);
      color: var(--text-primary);
      margin-left: 16px;
    }
    .theme-toggle-btn:hover {
      background: var(--bg-hover);
      border-color: var(--border-active);
    }

    .filter-pills {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .filter-pill {
      padding: 6px 12px;
      border-radius: var(--radius-sm);
      font-size: 12px;
      font-weight: 500;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      cursor: pointer;
      transition: var(--transition);
      user-select: none;
    }
    .filter-pill:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .filter-pill.active {
      background: var(--accent);
      border-color: var(--accent);
      color: #ffffff;
      font-weight: 600;
    }

    .hook-handlers-list {
      margin-top: 10px;
      border-top: 1px solid var(--border);
      padding-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .hook-handler-item {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
      background: var(--bg-tertiary);
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--border);
    }
    .hook-handler-icon {
      color: var(--accent-text);
      font-size: 10px;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-sans);
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Layout ───────────────────────────────────────────────────── */
    .app-layout {
      display: grid;
      grid-template-columns: 260px 1fr;
      grid-template-rows: 60px 1fr;
      min-height: 100vh;
    }

    /* ── Header ──────────────────────────────────────────────────── */
    .header {
      grid-column: 2;
      grid-row: 1;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      padding: 0 24px;
      gap: 16px;
      z-index: 10;
    }

    .header-title {
      font-weight: 600;
      font-size: 16px;
      color: var(--text-primary);
    }

    .header-stats {
      margin-left: auto;
      display: flex;
      gap: 20px;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .header-stat-value {
      font-weight: 600;
      color: var(--text-primary);
      margin-right: 4px;
    }

    /* ── Sidebar ─────────────────────────────────────────────────── */
    .sidebar {
      grid-column: 1;
      grid-row: 1 / span 2;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      padding: 20px 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow-y: auto;
    }

    .sidebar-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 12px 20px 12px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 16px;
    }

    .sidebar-brand .header-logo-icon {
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, var(--accent), #8b5cf6);
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 700;
      color: #fff;
      box-shadow: var(--shadow-glow);
    }

    .sidebar-brand span {
      font-weight: 700;
      font-size: 15px;
      letter-spacing: -0.02em;
      color: var(--text-primary);
    }

    .sidebar-brand .header-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 20px;
      background: var(--accent-glow);
      color: var(--accent-text);
      border: 1px solid rgba(79, 70, 229, 0.2);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-left: auto;
    }

    .sidebar-section {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      padding: 12px 12px 6px;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all var(--transition);
      border: 1px solid transparent;
      text-decoration: none;
    }

    .nav-item:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .nav-item.active {
      background: var(--accent-glow);
      color: var(--accent-text);
      border-color: rgba(79, 70, 229, 0.15);
    }

    .nav-icon {
      font-size: 16px;
      width: 20px;
      text-align: center;
      flex-shrink: 0;
    }

    .nav-badge {
      margin-left: auto;
      font-size: 11px;
      font-weight: 600;
      padding: 1px 7px;
      border-radius: 10px;
      background: var(--bg-tertiary);
      color: var(--text-muted);
    }

    .nav-item.active .nav-badge {
      background: rgba(79, 70, 229, 0.15);
      color: var(--accent-text);
    }

    /* ── Main Content ────────────────────────────────────────────── */
    .main {
      padding: 24px;
      overflow-y: auto;
      background: var(--bg-primary);
    }

    .panel { display: none; }
    .panel.active { display: block; }

    .panel-header {
      margin-bottom: 20px;
    }

    .panel-title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 4px;
    }

    .panel-subtitle {
      font-size: 13px;
      color: var(--text-secondary);
    }

    /* ── Route Table ─────────────────────────────────────────────── */
    .search-bar {
      display: flex;
      gap: 10px;
      margin-bottom: 16px;
    }

    .search-input {
      flex: 1;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 10px 14px;
      font-size: 13px;
      font-family: var(--font-sans);
      color: var(--text-primary);
      outline: none;
      transition: border-color var(--transition);
    }

    .search-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
    }

    .search-input::placeholder {
      color: var(--text-muted);
    }

    .route-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
    }

    .route-table th {
      text-align: left;
      padding: 10px 14px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      background: var(--bg-primary);
      z-index: 1;
    }

    .route-table td {
      padding: 12px 14px;
      font-size: 13px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
      transition: background var(--transition);
    }

    .route-table tr:hover td {
      background: var(--bg-hover);
    }

    .method-badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      font-family: var(--font-mono);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .method-GET { background: rgba(16, 185, 129, 0.08); color: var(--method-get); }
    .method-POST { background: rgba(59, 130, 246, 0.08); color: var(--method-post); }
    .method-PUT { background: rgba(245, 158, 11, 0.08); color: var(--method-put); }
    .method-PATCH { background: rgba(249, 115, 22, 0.08); color: var(--method-patch); }
    .method-DELETE { background: rgba(239, 68, 68, 0.08); color: var(--method-delete); }
    .method-WS { background: rgba(139, 92, 246, 0.08); color: var(--method-ws); }
    .method-HEAD { background: rgba(100, 116, 139, 0.08); color: var(--method-head); }
    .method-OPTIONS { background: rgba(100, 116, 139, 0.08); color: var(--method-options); }

    .route-path {
      font-family: var(--font-mono);
      font-size: 13px;
    }

    .route-param {
      color: var(--warning);
    }

    .validation-pills {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    .validation-pill {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .tag-pill {
      font-size: 10px;
      font-weight: 500;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--accent-glow);
      color: var(--accent-text);
    }

    .deprecated-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(239, 68, 68, 0.08);
      color: var(--error);
    }

    .empty-state {
      text-align: center;
      padding: 48px 24px;
      color: var(--text-muted);
    }

    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .empty-state-message {
      font-size: 14px;
    }

    /* ── System Metrics & Environment Variables ──────────────────── */
    .metric-progress-container {
      width: 100%;
      background: var(--bg-tertiary);
      border-radius: 4px;
      height: 8px;
      margin-top: 8px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .metric-progress-bar {
      height: 100%;
      background: var(--accent);
      width: 0%;
      transition: width 0.3s ease;
    }
    .metric-progress-bar.success { background: var(--success); }
    .metric-progress-bar.warning { background: var(--warning); }
    .metric-progress-bar.error { background: var(--error); }

    .env-table-container {
      margin-top: 24px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-secondary);
      overflow: hidden;
      box-shadow: var(--shadow-sm);
    }
    .env-search-bar {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-secondary);
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .env-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
    }
    .env-table th {
      background: var(--bg-tertiary);
      padding: 10px 16px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
      text-align: left;
    }
    .env-table td {
      padding: 10px 16px;
      font-size: 13px;
      border-bottom: 1px solid var(--border);
      font-family: var(--font-mono);
      word-break: break-all;
    }
    .env-table tr:last-child td {
      border-bottom: none;
    }
    .env-key {
      color: var(--accent-text);
      font-weight: 500;
      width: 35%;
    }
    .env-val {
      color: var(--text-secondary);
    }

    /* ── Schema Panel ────────────────────────────────────────────── */
    .schema-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      margin-bottom: 12px;
      overflow: hidden;
      box-shadow: var(--shadow-sm);
      transition: border-color var(--transition), box-shadow var(--transition);
    }

    .schema-card:hover {
      border-color: var(--border-active);
      box-shadow: var(--shadow-md);
    }

    .schema-card-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      cursor: pointer;
      user-select: none;
    }

    .schema-card-header:hover {
      background: var(--bg-hover);
    }

    .schema-card-chevron {
      transition: transform var(--transition);
      color: var(--text-muted);
      font-size: 12px;
    }

    .schema-card.open .schema-card-chevron {
      transform: rotate(90deg);
    }

    .schema-card-body {
      display: none;
      padding: 0 16px 16px;
    }

    .schema-card.open .schema-card-body {
      display: block;
    }

    pre.schema-json {
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 14px;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.6;
      overflow-x: auto;
      color: var(--text-secondary);
      margin-top: 10px;
    }

    .schema-section-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin-top: 12px;
      margin-bottom: 6px;
    }

    /* ── Health Panel ────────────────────────────────────────────── */
    .finding-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      margin-bottom: 12px;
      overflow: hidden;
      box-shadow: var(--shadow-sm);
      transition: border-color var(--transition), box-shadow var(--transition);
      border-left: 4px solid var(--border);
    }
    .finding-card:hover {
      border-color: var(--border-active);
      box-shadow: var(--shadow-md);
    }
    .finding-card.severity-ok {
      border-left-color: var(--success);
    }
    .finding-card.severity-warn {
      border-left-color: var(--warning);
    }
    .finding-card.severity-fail {
      border-left-color: var(--error);
    }
    .finding-card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      cursor: pointer;
      user-select: none;
    }
    .finding-card-header:hover {
      background: var(--bg-hover);
    }
    .finding-card-status-icon {
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
    }
    .finding-card.severity-ok .finding-card-status-icon {
      background: rgba(16, 185, 129, 0.08);
      color: var(--success);
    }
    .finding-card.severity-warn .finding-card-status-icon {
      background: rgba(245, 158, 11, 0.08);
      color: var(--warning);
    }
    .finding-card.severity-fail .finding-card-status-icon {
      background: rgba(239, 68, 68, 0.08);
      color: var(--error);
    }
    .finding-card-title {
      font-size: 14px;
      font-weight: 500;
    }
    .finding-card-area {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      margin-left: auto;
    }
    .finding-card-body {
      display: none;
      padding: 12px 16px 16px 52px;
      background: var(--bg-primary);
      border-top: 1px solid var(--border);
    }
    .finding-card.open .finding-card-body {
      display: block;
    }
    .finding-card-hint {
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.5;
    }

    /* ── Config / Hooks Panel ────────────────────────────────────── */
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }

    .info-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 18px;
      box-shadow: var(--shadow-sm);
      transition: border-color var(--transition), box-shadow var(--transition);
    }

    .info-card:hover {
      border-color: var(--border-active);
      box-shadow: var(--shadow-md);
    }

    .info-card-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin-bottom: 6px;
    }

    .info-card-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .info-card-sub {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 4px;
    }

    /* ── Loading / Error States ───────────────────────────────────── */
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 48px;
      color: var(--text-muted);
      gap: 10px;
    }

    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @keyframes pulse {
      0% { opacity: 0.5; }
      50% { opacity: 1; }
      100% { opacity: 0.5; }
    }

    .error-banner {
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.2);
      border-radius: var(--radius-sm);
      padding: 12px 16px;
      color: var(--error);
      font-size: 13px;
      margin-bottom: 16px;
    }

    /* ── Responsive ──────────────────────────────────────────────── */
    @media (max-width: 768px) {
      .app-layout {
        grid-template-columns: 1fr;
        grid-template-rows: 60px auto 1fr;
      }
      .sidebar {
        grid-column: 1;
        grid-row: 2;
        flex-direction: row;
        overflow-x: auto;
        border-right: none;
        border-bottom: 1px solid var(--border);
        padding: 8px;
        gap: 4px;
      }
      .sidebar-brand {
        display: none;
      }
      .header {
        grid-column: 1;
        grid-row: 1;
      }
      .sidebar-section { display: none; }
      .nav-badge { display: none; }
    }

    /* ── Request Tester ─────────────────────────────────────────── */
    .tester-container {
      display: grid;
      grid-template-columns: 240px 1fr 1fr;
      gap: 16px;
      margin-top: 16px;
    }
    
    @media (max-width: 1024px) {
      .tester-container {
        grid-template-columns: 1fr;
      }
    }
    
    .tester-section {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-shadow: var(--shadow-sm);
    }
    
    .tester-section-title {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.01em;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
      margin-bottom: 4px;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .form-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
    }
    
    .form-row {
      display: flex;
      gap: 10px;
    }
    
    .select-input, .text-input, .textarea-input {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 10px 14px;
      font-size: 13px;
      font-family: var(--font-sans);
      color: var(--text-primary);
      outline: none;
      transition: border-color var(--transition), background var(--transition);
      width: 100%;
    }
    
    .textarea-input {
      font-family: var(--font-mono);
      min-height: 120px;
      resize: vertical;
    }
    
    .select-input:focus, .text-input:focus, .textarea-input:focus {
      border-color: var(--accent);
      background: var(--bg-secondary);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
    }
    
    .btn {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: var(--radius-sm);
      padding: 10px 20px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: var(--transition);
    }
    
    .btn:hover {
      background: #4338ca;
      box-shadow: var(--shadow-glow);
    }
    
    .btn:active {
      transform: scale(0.98);
    }
    
    .btn-secondary {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border);
    }
    
    .btn-secondary:hover {
      background: var(--bg-hover);
      box-shadow: none;
    }
    
    .kv-row {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
    }
    
    .kv-row input {
      flex: 1;
    }
    
    .btn-danger {
      background: rgba(239, 68, 68, 0.08);
      color: var(--error);
      border: 1px solid rgba(239, 68, 68, 0.15);
      padding: 10px 14px;
    }
    
    .btn-danger:hover {
      background: var(--error);
      color: #fff;
    }
    
    .response-status-badge {
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      font-weight: 600;
      font-size: 12px;
      display: inline-block;
    }
    
    .response-headers-container {
      max-height: 150px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--bg-tertiary);
    }
    
    .response-headers-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    
    .response-headers-table td {
      padding: 6px 12px;
      border-bottom: 1px solid var(--border);
    }
    
    .response-headers-table tr:last-child td {
      border-bottom: none;
    }
    
    .response-headers-key {
      color: var(--text-secondary);
      font-weight: 500;
      width: 40%;
    }
    
    .response-headers-value {
      font-family: var(--font-mono);
      color: var(--text-primary);
      word-break: break-all;
    }
    
    .response-body-pre {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 14px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-primary);
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      flex: 1;
      min-height: 200px;
      max-height: 400px;
      overflow-y: auto;
    }

    .response-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      height: 100%;
      min-height: 250px;
      border: 2px dashed var(--border);
      border-radius: var(--radius-md);
      font-size: 13px;
      gap: 8px;
    }

    /* Timeline bars styling */
    .timeline-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 8px;
    }
    .timeline-label-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      font-weight: 500;
    }
    .timeline-type-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 5px;
      border-radius: 4px;
      text-transform: uppercase;
      margin-left: 8px;
    }
    .timeline-type-hook {
      background: rgba(139, 92, 246, 0.1);
      color: var(--method-ws);
    }
    .timeline-type-middleware {
      background: rgba(59, 130, 246, 0.1);
      color: var(--info);
    }
    .timeline-type-handler {
      background: rgba(16, 185, 129, 0.1);
      color: var(--success);
    }
    .timeline-bar-container {
      width: 100%;
      background: var(--bg-tertiary);
      border-radius: 4px;
      height: 16px;
      overflow: hidden;
      display: flex;
    }
    .timeline-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), #8b5cf6);
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    .timeline-duration {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
    }

    /* Database queries styling */
    .db-query-row {
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
      margin-bottom: 8px;
    }
    .db-query-row:last-child {
      border-bottom: none;
      padding-bottom: 0;
      margin-bottom: 0;
    }
    .db-query-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .db-query-badge {
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(16, 185, 129, 0.1);
      color: var(--success);
    }
    .db-query-duration {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
    }
    .db-query-sql {
      font-family: var(--font-mono);
      font-size: 12px;
      background: var(--bg-primary);
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      white-space: pre-wrap;
      word-break: break-all;
      border: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <div class="app-layout">
    <!-- Header -->
    <header class="header">
      <div class="header-title" id="header-title">Route Inspector</div>
      <div class="header-stats" id="header-stats"></div>
      <button class="theme-toggle-btn" id="theme-toggle-btn" onclick="toggleTheme()" title="Toggle Light/Dark Mode">☀️</button>
    </header>

    <!-- Sidebar -->
    <nav class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <div class="header-logo-icon">A</div>
        <span>Axiomify Studio</span>
        <span class="header-badge">v1</span>
      </div>
      <div class="sidebar-section">Inspect</div>
      <a class="nav-item active" data-panel="routes" href="#routes">
        <span class="nav-icon">🧭</span>
        <span>Routes</span>
        <span class="nav-badge" id="badge-routes">—</span>
      </a>
      <a class="nav-item" data-panel="schemas" href="#schemas">
        <span class="nav-icon">📐</span>
        <span>Schemas</span>
        <span class="nav-badge" id="badge-schemas">—</span>
      </a>
      <a class="nav-item" data-panel="openapi" href="#openapi">
        <span class="nav-icon">📄</span>
        <span>OpenAPI</span>
      </a>
      <a class="nav-item" data-panel="services" href="#services">
        <span class="nav-icon">🧩</span>
        <span>Services</span>
        <span class="nav-badge" id="badge-services">—</span>
      </a>
      <a class="nav-item" data-panel="events" href="#events">
        <span class="nav-icon">📣</span>
        <span>Events</span>
      </a>
      <a class="nav-item" data-panel="architecture" href="#architecture">
        <span class="nav-icon">🗺️</span>
        <span>Architecture</span>
      </a>
      <div class="sidebar-section">Observe</div>
      <a class="nav-item" data-panel="hooks" href="#hooks">
        <span class="nav-icon">🪝</span>
        <span>Hooks</span>
        <span class="nav-badge" id="badge-hooks">—</span>
      </a>
      <a class="nav-item" data-panel="errors" href="#errors">
        <span class="nav-icon">👁️</span>
        <span>Errors</span>
        <span class="nav-badge" id="badge-errors">0</span>
      </a>
      <a class="nav-item" data-panel="ws-analytics" href="#ws-analytics">
        <span class="nav-icon">📊</span>
        <span>WS Traffic</span>
      </a>
      <a class="nav-item" data-panel="health" href="#health">
        <span class="nav-icon">❤️</span>
        <span>Health</span>
        <span class="nav-badge" id="badge-health">—</span>
      </a>
      <a class="nav-item" data-panel="security" href="#security">
        <span class="nav-icon">🛡️</span>
        <span>Security</span>
      </a>
      <a class="nav-item" data-panel="config" href="#config">
        <span class="nav-icon">⚙️</span>
        <span>Config</span>
      </a>
      <div class="sidebar-section">Playground</div>
      <a class="nav-item" data-panel="tester" href="#tester">
        <span class="nav-icon">⚡</span>
        <span>Request Tester</span>
      </a>
    </nav>

    <!-- Main Content -->
    <main class="main" id="main-content">
      <div class="loading" id="loading-state">
        <div class="spinner"></div>
        <span>Loading discovery data...</span>
      </div>

      <!-- Routes Panel -->
      <div class="panel" id="panel-routes">
        <div class="panel-header">
          <div class="panel-title">Route Inspector</div>
          <div class="panel-subtitle">All registered HTTP and WebSocket routes</div>
        </div>
        <div class="search-bar">
          <input class="search-input" id="route-search" type="text"
                 placeholder="Search routes by path, method, or tag..." />
        </div>
        <div class="filter-pills" id="method-filters">
          <div class="filter-pill active" data-method="ALL">ALL</div>
          <div class="filter-pill" data-method="GET">GET</div>
          <div class="filter-pill" data-method="POST">POST</div>
          <div class="filter-pill" data-method="PUT">PUT</div>
          <div class="filter-pill" data-method="DELETE">DELETE</div>
          <div class="filter-pill" data-method="WS">WS</div>
        </div>
        <div id="routes-content"></div>
      </div>

      <!-- Schemas Panel -->
      <div class="panel" id="panel-schemas">
        <div class="panel-header">
          <div class="panel-title">Schema Inspector</div>
          <div class="panel-subtitle">Validation schemas for each route (Zod → JSON Schema)</div>
        </div>
        <div id="schemas-content"></div>
      </div>

      <!-- OpenAPI Panel -->
      <div class="panel" id="panel-openapi">
        <div class="panel-header">
          <div class="panel-title">OpenAPI Viewer</div>
          <div class="panel-subtitle">Generated OpenAPI 3.1 specification</div>
        </div>
        <div id="openapi-content"></div>
      </div>

      <!-- Hooks Panel -->
      <div class="panel" id="panel-hooks">
        <div class="panel-header">
          <div class="panel-title">Lifecycle Hooks</div>
          <div class="panel-subtitle">Registered hook handlers across the request lifecycle</div>
        </div>
        <div id="hooks-content"></div>
      </div>

      <!-- Health Panel -->
      <div class="panel" id="panel-health">
        <div class="panel-header">
          <div class="panel-title">Health Dashboard</div>
          <div class="panel-subtitle">Production-readiness checks and configuration audits</div>
        </div>
        <div id="health-content"></div>
      </div>

      <!-- Config Panel -->
      <div class="panel" id="panel-config">
        <div class="panel-header">
          <div class="panel-title">Framework Configuration</div>
          <div class="panel-subtitle">Application settings and overview</div>
        </div>
        <div id="config-content"></div>
      </div>

      <!-- Request Tester Panel -->
      <div class="panel" id="panel-tester">
        <div class="panel-header">
          <div class="panel-title">Request Tester</div>
          <div class="panel-subtitle">Interact with and test routes directly against your in-memory Axiomify app instance</div>
        </div>
        
        <div class="search-bar">
          <select class="select-input" id="tester-route-select" style="max-width: 400px;">
            <option value="">-- Choose a discovered route to pre-fill --</option>
          </select>
        </div>

        <div class="tester-container">
          <!-- Replay History Sidebar -->
          <div class="tester-section" style="max-height: 700px; overflow-y: auto;">
            <div class="tester-section-title" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
              <span style="display:flex; align-items:center; gap:6px;"><span>⏱️</span> Replay History</span>
              <button class="btn btn-secondary" style="padding:2px 8px; font-size:10px; border-radius:var(--radius-sm); margin:0;" onclick="clearAllReplays()">Clear</button>
            </div>
            <div id="tester-replay-history" style="display:flex; flex-direction:column; gap:8px;">
              <!-- History item buttons -->
            </div>
          </div>

          <!-- Request Builder -->
          <div class="tester-section">
            <div class="tester-section-title">
              <span>📝</span> Request Builder
            </div>
            
            <div class="form-row">
              <div class="form-group" style="width: 120px; flex: none;">
                <label class="form-label">Method</label>
                <select class="select-input" id="tester-method">
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                  <option value="PATCH">PATCH</option>
                  <option value="HEAD">HEAD</option>
                  <option value="OPTIONS">OPTIONS</option>
                </select>
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Path</label>
                <input class="text-input" type="text" id="tester-path" placeholder="/api/v1/resource" />
              </div>
            </div>

            <!-- Query Parameters Editor -->
            <div class="form-group">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <label class="form-label">Query Parameters</label>
                <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" id="btn-add-query">+ Add Param</button>
              </div>
              <div id="tester-query-container">
                <!-- KV Rows go here -->
              </div>
            </div>

            <!-- Headers Editor -->
            <div class="form-group">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <label class="form-label">Headers</label>
                <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" id="btn-add-header">+ Add Header</button>
              </div>
              <div id="tester-headers-container">
                <!-- KV Rows go here -->
              </div>
            </div>

            <!-- Body Editor -->
            <div class="form-group" id="tester-body-group">
              <label class="form-label">Request Body (JSON)</label>
              <textarea class="textarea-input" id="tester-body" placeholder="{&#10;  &quot;key&quot;: &quot;value&quot;&#10;}"></textarea>
            </div>

            <div style="margin-top: 10px;">
              <button class="btn" id="btn-send-request" style="width: 100%;">
                <span>⚡</span> Send Request
              </button>
            </div>
          </div>

          <!-- Response Viewer -->
          <div class="tester-section" style="display: flex; flex-direction: column;">
            <div class="tester-section-title">
              <span>📥</span> Response
            </div>
            
            <div id="tester-response-placeholder" class="response-placeholder">
              <span>📥</span>
              <span>Send a request to see the response here</span>
            </div>

            <div id="tester-response-content" style="display: none; flex-direction: column; gap: 16px; flex: 1;">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <div>
                  <span class="form-label" style="margin-right: 8px;">Status</span>
                  <span id="response-status-badge" class="response-status-badge">200 OK</span>
                </div>
                <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;" id="btn-copy-response">Copy Body</button>
              </div>

              <div class="form-group">
                <label class="form-label">Headers</label>
                <div class="response-headers-container">
                  <table class="response-headers-table">
                    <tbody id="response-headers-body">
                      <!-- Headers populated here -->
                    </tbody>
                  </table>
                </div>
              </div>

              <div class="form-group" style="flex: 1; display: flex; flex-direction: column;">
                <label class="form-label">Body</label>
                <pre class="response-body-pre" id="response-body-pre"></pre>
              </div>

              <!-- Validation Errors -->
              <div class="form-group" id="response-validation-errors-group" style="display:none; margin-top:16px;">
                <label class="form-label" style="color:var(--error); font-weight:600;">Validation Errors</label>
                <div id="response-validation-errors" style="display:flex; flex-direction:column; gap:8px; background:rgba(239, 68, 68, 0.05); border:1px solid rgba(239, 68, 68, 0.2); border-radius:var(--radius-md); padding:16px;">
                  <!-- Validation error callouts go here -->
                </div>
              </div>

              <!-- Timeline Profiler -->
              <div class="form-group" id="response-profile-timeline-group" style="display:none; margin-top:16px;">
                <label class="form-label">Execution Timeline</label>
                <div id="response-profile-timeline" style="display:flex; flex-direction:column; gap:8px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px;">
                  <!-- Timeline bars go here -->
                </div>
              </div>

              <!-- Database Queries -->
              <div class="form-group" id="response-profile-queries-group" style="display:none; margin-top:16px;">
                <label class="form-label">Database Queries</label>
                <div id="response-profile-queries" style="display:flex; flex-direction:column; gap:8px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px;">
                  <!-- Queries list goes here -->
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Services Panel -->
      <div class="panel" id="panel-services">
        <div class="panel-header">
          <div class="panel-title">DI Services Explorer</div>
          <div class="panel-subtitle">Registered dependency injection services and methods</div>
        </div>
        <div class="search-bar">
          <input type="text" id="services-search" class="search-input" oninput="renderServices()" placeholder="Search services by token or method name..." />
        </div>
        <div id="services-content"></div>
      </div>

      <!-- Security Panel -->
      <div class="panel" id="panel-security">
        <div class="panel-header">
          <div class="panel-title">Security Analyzer</div>
          <div class="panel-subtitle">Automated security audit for routes, CORS, rate limiting, and metrics</div>
        </div>
        <div id="security-content"></div>
      </div>

      <!-- Errors Panel -->
      <div class="panel" id="panel-errors">
        <div class="panel-header">
          <div class="panel-title">Error Observatory</div>
          <div class="panel-subtitle">Centralized analysis of errors and validation failures today</div>
        </div>
        <div id="errors-content"></div>
      </div>

      <!-- WS Analytics Panel -->
      <div class="panel" id="panel-ws-analytics">
        <div class="panel-header">
          <div class="panel-title">WebSocket Traffic Analytics</div>
          <div class="panel-subtitle">Real-time metrics, throughput, and connection status</div>
        </div>
        <div id="ws-analytics-content"></div>
      </div>

      <!-- Architecture Panel -->
      <div class="panel" id="panel-architecture">
        <div class="panel-header">
          <div class="panel-title">Application Architecture Map</div>
          <div class="panel-subtitle">Auto-generated structural mapping of controllers, services, repositories, and database connections</div>
        </div>
        <div id="architecture-content"></div>
      </div>

      <!-- Events Panel -->
      <div class="panel" id="panel-events">
        <div class="panel-header">
          <div class="panel-title">Event Bus Explorer</div>
          <div class="panel-subtitle">Inspect active event emitters, events, and registered listener functions</div>
        </div>
        <div id="events-content"></div>
      </div>
    </main>
  </div>

  <script>
    // ── State ──────────────────────────────────────────────────────
    let discovery = null;
    let activePanel = 'routes';
    let activeMethodFilter = 'ALL';

    // ── Theme Switcher ────────────────────────────────────────────
    function toggleTheme() {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('axiomify-studio-theme', newTheme);
      
      const btn = document.getElementById('theme-toggle-btn');
      if (btn) {
        btn.textContent = newTheme === 'light' ? '☀️' : '🌙';
      }
    }
    window.toggleTheme = toggleTheme;

    // Apply stored theme on boot
    (function () {
      const savedTheme = localStorage.getItem('axiomify-studio-theme') || 'light';
      document.documentElement.setAttribute('data-theme', savedTheme);
      document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('theme-toggle-btn');
        if (btn) {
          btn.textContent = savedTheme === 'light' ? '☀️' : '🌙';
        }
      });
    })();

    // ── Navigation ────────────────────────────────────────────────
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const panel = item.getAttribute('data-panel');
        if (panel) switchPanel(panel);
      });
    });

    function switchPanel(name) {
      activePanel = name;
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      document.querySelector('[data-panel="' + name + '"]')?.classList.add('active');
      document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));
      document.getElementById('panel-' + name)?.classList.add('active');

      const titles = {
        routes: 'Route Inspector',
        schemas: 'Schema Inspector',
        openapi: 'OpenAPI Viewer',
        hooks: 'Lifecycle Hooks',
        health: 'Health Dashboard',
        config: 'Framework Configuration',
        tester: 'Request Tester',
        services: 'DI Services Explorer',
        security: 'Security Analyzer',
        errors: 'Error Observatory',
        'ws-analytics': 'WebSocket Traffic Analytics',
        architecture: 'Application Architecture Map',
        events: 'Event Bus Explorer'
      };
      const titleEl = document.getElementById('header-title');
      if (titleEl) {
        titleEl.textContent = titles[name] || name;
      }

      if (name === 'services') {
        renderServices();
      }
      if (name === 'security') {
        runSecurityAudit();
      }
      if (name === 'events') {
        renderEvents();
      }
      if (name === 'architecture') {
        renderArchitecture();
      }

      if (name === 'config') {
        if (typeof window.startSysStatsPolling === 'function') {
          window.startSysStatsPolling();
        }
      } else {
        if (typeof window.stopSysStatsPolling === 'function') {
          window.stopSysStatsPolling();
        }
      }

      if (name === 'errors') {
        startErrorsPolling();
      } else {
        stopErrorsPolling();
      }

      if (name === 'ws-analytics') {
        startWsAnalyticsPolling();
      } else {
        stopWsAnalyticsPolling();
      }

      if (name === 'tester') {
        fetchReplays();
      }
    }

    // ── Method Filters & Action Helpers ───────────────────────────
    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(el => el.classList.remove('active'));
        pill.classList.add('active');
        activeMethodFilter = pill.getAttribute('data-method') || 'ALL';
        renderRoutes();
      });
    });

    function quickTest(method, path) {
      switchPanel('tester');
      const select = document.getElementById('tester-route-select');
      if (select) {
        select.value = method + ' ' + path;
        select.dispatchEvent(new Event('change'));
      }
    }
    window.quickTest = quickTest;

    function copyRawSpec(btn) {
      const specText = JSON.stringify(discovery.openapi, null, 2);
      navigator.clipboard.writeText(specText).then(() => {
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = original, 1500);
      });
    }
    window.copyRawSpec = copyRawSpec;

    function downloadRawSpec() {
      const specText = JSON.stringify(discovery.openapi, null, 2);
      const blob = new Blob([specText], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'openapi.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    window.downloadRawSpec = downloadRawSpec;

    // ── Fetch Discovery ───────────────────────────────────────────
    async function fetchDiscovery() {
      try {
        const res = await fetch('/__studio/api/discovery');
        discovery = await res.json();
        hideLoading();
        renderAll();
      } catch (err) {
        document.getElementById('loading-state').innerHTML =
          '<div class="error-banner">Failed to load discovery data: ' + err.message + '</div>';
      }
    }

    function hideLoading() {
      document.getElementById('loading-state').style.display = 'none';
      document.getElementById('panel-' + activePanel).classList.add('active');
    }

    // ── Render Functions ──────────────────────────────────────────
    function renderAll() {
      if (!discovery) return;
      renderHeaderStats();
      renderBadges();
      renderRoutes();
      renderSchemas();
      renderOpenApi();
      renderHooks();
      renderHealth();
      renderConfig();
      renderTester();
      renderServices();
      runSecurityAudit();
      renderEvents();
      renderArchitecture();
      fetchErrors();
      fetchReplays();
    }

    function renderHeaderStats() {
      const c = discovery.config;
      document.getElementById('header-stats').innerHTML =
        '<span><span class="header-stat-value">' + c.httpRouteCount + '</span>HTTP</span>' +
        '<span><span class="header-stat-value">' + c.wsRouteCount + '</span>WS</span>' +
        '<span><span class="header-stat-value">' + c.hookCount + '</span>Hooks</span>';
    }

    function renderBadges() {
      document.getElementById('badge-routes').textContent = discovery.routes.length;
      document.getElementById('badge-schemas').textContent = discovery.schemas.length;
      const hookTotal = discovery.hooks.reduce((s, h) => s + h.count, 0);
      document.getElementById('badge-hooks').textContent = hookTotal;
      document.getElementById('badge-services').textContent = (discovery.services || []).length;

      if (discovery.health) {
        const badge = document.getElementById('badge-health');
        const totalIssues = discovery.health.summary.failures + discovery.health.summary.warnings;
        badge.textContent = totalIssues;
        if (discovery.health.summary.failures > 0) {
          badge.style.background = 'rgba(255, 107, 107, 0.2)';
          badge.style.color = 'var(--error)';
        } else if (discovery.health.summary.warnings > 0) {
          badge.style.background = 'rgba(255, 193, 7, 0.2)';
          badge.style.color = 'var(--warning)';
        } else {
          badge.style.background = 'var(--bg-tertiary)';
          badge.style.color = 'var(--text-muted)';
        }
      }
    }

    // ── Routes ────────────────────────────────────────────────────
    function renderRoutes(filter) {
      const text = filter !== undefined
        ? filter
        : (document.getElementById('route-search')?.value.toLowerCase().trim() || '');

      let routes = discovery.routes;

      if (activeMethodFilter !== 'ALL') {
        routes = routes.filter(r => r.method === activeMethodFilter);
      }

      if (text) {
        routes = routes.filter(r =>
          r.path.toLowerCase().includes(text) ||
          r.method.toLowerCase().includes(text) ||
          (r.tags || []).some(t => t.toLowerCase().includes(text))
        );
      }

      if (routes.length === 0) {
        document.getElementById('routes-content').innerHTML =
          '<div class="empty-state"><div class="empty-state-icon">🧭</div>' +
          '<div class="empty-state-message">No routes found</div></div>';
        return;
      }

      let html = '<table class="route-table"><thead><tr>' +
        '<th>Method</th><th>Path</th><th>Validation</th><th>Tags</th><th>Details</th><th>Actions</th>' +
        '</tr></thead><tbody>';

      for (const r of routes) {
        const pathHtml = r.path.replace(/:([a-zA-Z0-9_]+)/g, '<span class="route-param">:$1</span>');
        const pills = r.validation.map(v =>
          '<span class="validation-pill">' + v + '</span>').join('');
        const tags = (r.tags || []).map(t =>
          '<span class="tag-pill">' + escapeHtml(t) + '</span>').join(' ');
        const details = [];
        if (r.deprecated) details.push('<span class="deprecated-badge">deprecated</span>');
        if (r.operationId) details.push('<span style="color:var(--text-muted);font-size:12px">op:' + escapeHtml(r.operationId) + '</span>');
        if (r.plugins && r.plugins.length > 0) {
          const mws = r.plugins.map(p =>
            '<span class="validation-pill" style="text-transform:none;background:var(--bg-tertiary);border:1px solid var(--border);font-size:10px;" title="Middleware: ' + escapeHtml(p) + '">' + escapeHtml(p) + '</span>'
          ).join('');
          details.push('<div style="display:inline-flex;flex-wrap:wrap;gap:4px;vertical-align:middle;margin-top:2px;">' + mws + '</div>');
        }

        const testBtn = r.isWs
          ? '<span style="color:var(--text-muted)">—</span>'
          : '<button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="event.stopPropagation(); quickTest(\\\'' + r.method + '\\\', \\\'' + r.path + '\\\')">⚡ Test</button>';

        html += '<tr style="cursor:pointer;" onclick="toggleRouteDetail(\\\'' + r.method + '\\\', \\\'' + r.path + '\\\')">' +
          '<td><span class="method-badge method-' + r.method + '">' + r.method + '</span></td>' +
          '<td class="route-path">' + pathHtml + '</td>' +
          '<td><div class="validation-pills">' + (pills || '<span style="color:var(--text-muted)">—</span>') + '</div></td>' +
          '<td>' + (tags || '<span style="color:var(--text-muted)">—</span>') + '</td>' +
          '<td>' + (details.join(' ') || '<span style="color:var(--text-muted)">—</span>') + '</td>' +
          '<td>' + testBtn + '</td>' +
          '</tr>';

        // Render Route Dependency Graph row
        const controllerNode = (discovery.archMap || []).find(n => n.id === 'controller:' + r.method + ':' + r.path);
        const depFlow = [];
        depFlow.push({ name: 'Route: ' + r.method + ' ' + r.path, type: 'route', icon: '🧭' });
        
        if (r.plugins && r.plugins.length > 0) {
          for (const p of r.plugins) {
            depFlow.push({ name: 'Middleware: ' + p, type: 'middleware', icon: '🛡️' });
          }
        }
        if (r.validation && r.validation.length > 0) {
          depFlow.push({ name: 'Validation: ' + r.validation.join(', '), type: 'validation', icon: '📐' });
        }
        depFlow.push({ name: r.operationId || 'Handler', type: 'controller', icon: '⚙️' });

        if (controllerNode && controllerNode.dependencies) {
          for (const dep of controllerNode.dependencies) {
            const sToken = dep.split(':')[1];
            depFlow.push({ name: 'Service: ' + sToken, type: 'service', icon: '🧩' });
            
            const sNode = (discovery.archMap || []).find(n => n.id === dep);
            if (sNode && sNode.dependencies) {
              for (const sDep of sNode.dependencies) {
                const subToken = sDep.split(':')[1];
                const subNode = (discovery.archMap || []).find(n => n.id === sDep);
                const subType = subNode ? subNode.type : 'service';
                const subIcon = subType === 'repository' ? '📦' : subType === 'database' ? '🛢️' : '🧩';
                depFlow.push({ name: subType.toUpperCase() + ': ' + subToken, type: subType, icon: subIcon });
              }
            }
          }
        }

        const flowCards = depFlow.map(f => {
          let badgeColor = 'var(--info)';
          if (f.type === 'route') badgeColor = 'var(--accent)';
          else if (f.type === 'middleware') badgeColor = 'var(--method-head)';
          else if (f.type === 'validation') badgeColor = 'var(--warning)';
          else if (f.type === 'controller') badgeColor = 'var(--success)';
          else if (f.type === 'repository') badgeColor = 'var(--method-ws)';
          else if (f.type === 'database') badgeColor = 'var(--error)';

          return '<div style="background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-sm); padding:10px; display:flex; align-items:center; gap:8px; box-shadow:var(--shadow-sm); min-width:180px;">' +
            '<span style="font-size:16px;">' + f.icon + '</span>' +
            '<div style="display:flex; flex-direction:column;">' +
            '<span style="font-size:10px; font-weight:700; text-transform:uppercase; color:' + badgeColor + ';">' + f.type + '</span>' +
            '<span style="font-family:var(--font-mono); font-size:11px; font-weight:600; color:var(--text-primary);">' + escapeHtml(f.name) + '</span>' +
            '</div>' +
            '</div>';
        }).join('<div style="font-size:18px; color:var(--text-muted); font-weight:bold; user-select:none;">→</div>');

        const detailRowId = 'detail-' + r.method.replace(/:/g, '-') + '-' + r.path.replace(/\\//g, '-').replace(/:/g, '-');
        html += '<tr id="' + detailRowId + '" class="route-detail-row" style="display:none; background:var(--bg-tertiary);">' +
          '<td colspan="6" style="padding:16px; border-bottom:1px solid var(--border);">' +
          '<div style="display:flex; flex-direction:column; gap:12px;">' +
          '<div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted);">Route Pipeline Dependency Graph</div>' +
          '<div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px; overflow-x:auto;">' +
          flowCards +
          '</div>' +
          '</div>' +
          '</td>' +
          '</tr>';
      }

      html += '</tbody></table>';
      document.getElementById('routes-content').innerHTML = html;
    }

    function toggleRouteDetail(method, path) {
      const id = 'detail-' + method.replace(/:/g, '-') + '-' + path.replace(/\\//g, '-').replace(/:/g, '-');
      const el = document.getElementById(id);
      if (el) {
        el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
      }
    }
    window.toggleRouteDetail = toggleRouteDetail;

    document.getElementById('route-search')?.addEventListener('input', (e) => {
      renderRoutes(e.target.value.toLowerCase().trim());
    });

    // ── Schemas ───────────────────────────────────────────────────
    function renderSchemas() {
      if (discovery.schemas.length === 0) {
        document.getElementById('schemas-content').innerHTML =
          '<div class="empty-state"><div class="empty-state-icon">📐</div>' +
          '<div class="empty-state-message">No schemas found — add Zod schemas to your routes</div></div>';
        return;
      }

      let html = '';
      for (const s of discovery.schemas) {
        const sections = [];
        if (s.body) sections.push({ label: 'Body', data: s.body });
        if (s.query) sections.push({ label: 'Query', data: s.query });
        if (s.params) sections.push({ label: 'Params', data: s.params });
        if (s.response) sections.push({ label: 'Response', data: s.response });
        if (s.message) sections.push({ label: 'Message', data: s.message });
        if (s.files) sections.push({ label: 'Files', data: s.files });

        const sectionsHtml = sections.map(sec =>
          '<div class="schema-section-label">' + sec.label + '</div>' +
          '<pre class="schema-json">' + escapeHtml(JSON.stringify(sec.data, null, 2)) + '</pre>'
        ).join('');

        html += '<div class="schema-card" onclick="this.classList.toggle(\\\'open\\\')">' +
          '<div class="schema-card-header">' +
          '<span class="schema-card-chevron">▶</span>' +
          '<span class="method-badge method-' + s.method + '">' + s.method + '</span>' +
          '<span class="route-path">' + escapeHtml(s.path) + '</span>' +
          '<span style="color:var(--text-muted);font-size:12px;margin-left:auto">' + sections.length + ' schema' + (sections.length === 1 ? '' : 's') + '</span>' +
          '</div>' +
          '<div class="schema-card-body">' + sectionsHtml + '</div>' +
          '</div>';
      }

      document.getElementById('schemas-content').innerHTML = html;
    }

    // ── OpenAPI ───────────────────────────────────────────────────
    async function syncOpenApiSpec(btn) {
      const originalText = btn.textContent;
      btn.textContent = 'Syncing...';
      btn.disabled = true;
      try {
        const res = await fetch('/__studio/api/openapi/sync', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          alert('Successfully synced OpenAPI specification to openapi.json.');
          await fetchDiscovery();
        } else {
          alert('Error: ' + data.message);
        }
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }
    window.syncOpenApiSpec = syncOpenApiSpec;

    function renderOpenApi() {
      const spec = discovery.openapi;
      
      let driftHtml = '';
      if (discovery.drift) {
        const drift = discovery.drift;
        if (!drift.hasFile) {
          driftHtml = '<div style="background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">' +
            '<div>' +
            '<div style="font-weight:600;font-size:14px;color:var(--text-primary);">OpenAPI File Sync</div>' +
            '<div style="font-size:13px;color:var(--text-secondary);">No local <code style="font-family:var(--font-mono);">openapi.json</code> file exists in the project root.</div>' +
            '</div>' +
            '<button class="search-input" style="flex:none;width:auto;cursor:pointer;background:var(--accent);color:#fff;border-color:var(--accent);" onclick="syncOpenApiSpec(this)">Create & Sync File</button>' +
            '</div>';
        } else if (!drift.synced) {
          let diffItems = '';
          for (const d of drift.diffs) {
            diffItems += '<li style="margin-bottom:4px;">' + escapeHtml(d) + '</li>';
          }
          driftHtml = '<div style="background:rgba(245,158,11,0.06);border:1px solid var(--warning);border-radius:var(--radius-md);padding:16px;margin-bottom:16px;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
            '<div>' +
            '<div style="font-weight:600;font-size:14px;color:var(--warning);">⚠️ OpenAPI Spec Drift Detected</div>' +
            '<div style="font-size:13px;color:var(--text-secondary);">The local <code style="font-family:var(--font-mono);">openapi.json</code> file has diverged from the live API.</div>' +
            '</div>' +
            '<button class="search-input" style="flex:none;width:auto;cursor:pointer;background:var(--warning);color:#000;border-color:var(--warning);" onclick="syncOpenApiSpec(this)">Sync Schema to File</button>' +
            '</div>' +
            '<ul style="margin-left:20px;font-size:13px;color:var(--text-secondary);">' + diffItems + '</ul>' +
            '</div>';
        } else {
          driftHtml = '<div style="background:rgba(16,185,129,0.06);border:1px solid var(--success);border-radius:var(--radius-md);padding:16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">' +
            '<div>' +
            '<div style="font-weight:600;font-size:14px;color:var(--success);">✅ OpenAPI Spec Synced</div>' +
            '<div style="font-size:13px;color:var(--text-secondary);">The local <code style="font-family:var(--font-mono);">openapi.json</code> matches the live API spec perfectly.</div>' +
            '</div>' +
            '<button class="search-input" style="flex:none;width:auto;cursor:pointer;border-color:var(--success);color:var(--success);" onclick="syncOpenApiSpec(this)">Force Sync</button>' +
            '</div>';
        }
      }

      if (!spec || !spec.paths || Object.keys(spec.paths).length === 0) {
        document.getElementById('openapi-content').innerHTML =
          (driftHtml || '') +
          '<div class="empty-state"><div class="empty-state-icon">📄</div>' +
          '<div class="empty-state-message">OpenAPI spec not available or has no paths. Install @axiomify/openapi to enable.</div></div>';
        return;
      }

      let html = '';
      for (const [path, pathItem] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(pathItem)) {
          if (['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].indexOf(method.toLowerCase()) === -1) {
            continue;
          }
          const mUpper = method.toUpperCase();
          const summary = op.summary || (mUpper + ' ' + path);
          const description = op.description || '';
          
          let bodyHtml = '';
          
          if (description) {
            bodyHtml += '<div style="margin-bottom:12px;color:var(--text-secondary);font-size:13px;">' + escapeHtml(description) + '</div>';
          }

          // Parameters
          const params = op.parameters || [];
          if (params.length > 0) {
            bodyHtml += '<div class="schema-section-label">Parameters</div>';
            bodyHtml += '<table class="route-table" style="margin-bottom:16px;"><thead><tr><th>Name</th><th>In</th><th>Type</th><th>Required</th><th>Description</th></tr></thead><tbody>';
            for (const p of params) {
              const reqBadge = p.required ? '<span style="color:var(--error);font-size:11px;">required</span>' : '<span style="color:var(--text-muted);font-size:11px;">optional</span>';
              const pType = p.schema ? (p.schema.type || 'any') : 'any';
              bodyHtml += '<tr>' +
                '<td style="font-family:var(--font-mono);font-weight:600;">' + escapeHtml(p.name) + '</td>' +
                '<td><span class="validation-pill">' + p.in + '</span></td>' +
                '<td style="font-family:var(--font-mono);">' + pType + '</td>' +
                '<td>' + reqBadge + '</td>' +
                '<td style="color:var(--text-secondary);">' + escapeHtml(p.description || '—') + '</td>' +
                '</tr>';
            }
            bodyHtml += '</tbody></table>';
          }

          // Request Body
          if (op.requestBody) {
            bodyHtml += '<div class="schema-section-label">Request Body</div>';
            const content = op.requestBody.content || {};
            for (const [mime, media] of Object.entries(content)) {
              bodyHtml += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">Content-Type: <code style="font-family:var(--font-mono);color:var(--accent-text);">' + mime + '</code></div>';
              if (media.schema) {
                bodyHtml += '<pre class="schema-json">' + escapeHtml(JSON.stringify(media.schema, null, 2)) + '</pre>';
              }
            }
          }

          // Responses
          const responses = op.responses || {};
          if (Object.keys(responses).length > 0) {
            bodyHtml += '<div class="schema-section-label">Responses</div>';
            for (const [code, r] of Object.entries(responses)) {
              const codeStyle = code.startsWith('2') ? 'color:var(--success)' : code.startsWith('4') || code.startsWith('5') ? 'color:var(--error)' : 'color:var(--warning)';
              bodyHtml += '<div style="margin-top:8px;">' +
                '<span style="font-family:var(--font-mono);font-weight:600;' + codeStyle + ';margin-right:8px;">' + code + '</span>' +
                '<span style="font-size:13px;color:var(--text-secondary);">' + escapeHtml(r.description || '') + '</span>' +
                '</div>';
              const content = r.content || {};
              for (const [mime, media] of Object.entries(content)) {
                if (media.schema) {
                  bodyHtml += '<pre class="schema-json">' + escapeHtml(JSON.stringify(media.schema, null, 2)) + '</pre>';
                }
              }
            }
          }

          html += '<div class="schema-card" onclick="this.classList.toggle(\\\'open\\\')">' +
            '<div class="schema-card-header">' +
            '<span class="schema-card-chevron">▶</span>' +
            '<span class="method-badge method-' + mUpper + '">' + mUpper + '</span>' +
            '<span class="route-path">' + escapeHtml(path) + '</span>' +
            '<span style="color:var(--text-secondary);font-size:13px;margin-left:8px;">' + escapeHtml(summary) + '</span>' +
            '</div>' +
            '<div class="schema-card-body">' + bodyHtml + '</div>' +
            '</div>';
        }
      }

      // Add a raw spec download/toggle button at the top
      let toggleHtml = '<div style="margin-bottom:16px;display:flex;gap:12px;justify-content:flex-end;">' +
        '<button class="search-input" style="flex:none;width:auto;cursor:pointer;" onclick="event.stopPropagation(); toggleRawSpec()">Toggle Raw JSON</button>' +
        '<button class="search-input" style="flex:none;width:auto;cursor:pointer;" onclick="event.stopPropagation(); copyRawSpec(this)">Copy JSON</button>' +
        '<button class="search-input" style="flex:none;width:auto;cursor:pointer;" onclick="event.stopPropagation(); downloadRawSpec()">Download JSON</button>' +
        '</div>';

      toggleHtml += '<div id="raw-spec-container" style="display:none;margin-bottom:24px;">' +
        '<div class="schema-section-label">Raw OpenAPI Spec</div>' +
        '<pre class="schema-json" style="max-height:50vh;overflow:auto;">' + escapeHtml(JSON.stringify(spec, null, 2)) + '</pre>' +
        '</div>';

      document.getElementById('openapi-content').innerHTML = driftHtml + toggleHtml + html;
    }

    function toggleRawSpec() {
      const container = document.getElementById('raw-spec-container');
      if (container) {
        container.style.display = container.style.display === 'none' ? 'block' : 'none';
      }
    }
    window.toggleRawSpec = toggleRawSpec;

    function renderServices(filter) {
      const searchVal = (filter || document.getElementById('services-search')?.value || '').toLowerCase().trim();
      let services = discovery.services || [];
      
      if (searchVal) {
        services = services.filter(s => 
          s.token.toLowerCase().includes(searchVal) || 
          s.type.toLowerCase().includes(searchVal) ||
          s.methods.some(m => m.toLowerCase().includes(searchVal))
        );
      }

      if (services.length === 0) {
        document.getElementById('services-content').innerHTML =
          '<div class="empty-state"><div class="empty-state-icon">🧩</div>' +
          '<div class="empty-state-message">No services found in the DI container.</div></div>';
        return;
      }

      let html = '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:16px;">';
      for (const s of services) {
        let methodsHtml = '';
        if (s.methods.length > 0) {
          methodsHtml = '<div style="margin-top:10px;">' +
            '<div class="schema-section-label">Public Methods</div>' +
            '<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">' +
            s.methods.map(m => '<span class="validation-pill" style="font-family:var(--font-mono); font-size:11px;">' + escapeHtml(m) + '()</span>').join('') +
            '</div>' +
            '</div>';
        } else {
          methodsHtml = '<div style="margin-top:10px; font-size:12px; color:var(--text-muted); font-style:italic;">No public methods exposed.</div>';
        }

        html += '<div class="info-card" style="display:flex; flex-direction:column; justify-content:space-between;">' +
          '<div>' +
          '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">' +
          '<span class="info-card-label" style="margin-bottom:0;">Service Token</span>' +
          '<span class="tag-pill" style="font-family:var(--font-mono);">' + escapeHtml(s.type) + '</span>' +
          '</div>' +
          '<div style="font-size:16px; font-weight:700; font-family:var(--font-mono); color:var(--text-primary); margin-bottom:12px; word-break:break-all;">' + escapeHtml(s.token) + '</div>' +
          '<div style="border-top:1px dashed var(--border); padding-top:8px;">' + methodsHtml + '</div>' +
          '</div>' +
          '</div>';
      }
      html += '</div>';

      document.getElementById('services-content').innerHTML = html;
    }
    window.renderServices = renderServices;

    function runSecurityAudit() {
      const findings = [];
      const routes = discovery.routes || [];
      const config = discovery.config || {};

      const hasRateLimit = routes.some(r => r.plugins && r.plugins.some(p => p.toLowerCase().includes(\'rate-limit\') || p.toLowerCase().includes(\'ratelimit\')));
      if (!hasRateLimit) {
        findings.push({
          severity: \'warn\',
          area: \'Rate Limiting\',
          message: \'No Rate Limiting middleware detected on any routes.\',
          hint: \'Exposing routes without rate limiting can make your application vulnerable to Denial of Service (DoS) and brute force attacks. Integrate \\\'@axiomify/rate-limit\\\' to protect your endpoints.\'
        });
      } else {
        findings.push({
          severity: \'ok\',
          area: \'Rate Limiting\',
          message: \'Rate Limiting middleware is active on some routes.\',
          hint: \'Good practice. Ensure critical endpoints (like authentication and submission forms) are covered by rate limiting.\'
        });
      }

      const hasCors = routes.some(r => r.plugins && r.plugins.some(p => p.toLowerCase().includes(\'cors\')));
      if (hasCors) {
        findings.push({
          severity: \'warn\',
          area: \'CORS\',
          message: \'CORS middleware is registered on your routes.\',
          hint: \'Verify that your CORS configuration does not allow permissive origins (\\\'*\\\') in production. Restrict \\\'Access-Control-Allow-Origin\\\' to trusted domains.\'
        });
      } else {
        findings.push({
          severity: \'ok\',
          area: \'CORS\',
          message: \'No global permissive CORS configuration detected.\',
          hint: \'If this is a private API accessed from other domains, configure restricted CORS. If it\\\'s a server-to-server or web-first application, leaving CORS disabled is a secure default.\'
        });
      }

      const schemaLessRoutes = routes.filter(r => !r.isWs && !r.hasResponseSchema && r.validation.length === 0);
      if (schemaLessRoutes.length > 0) {
        findings.push({
          severity: \'fail\',
          area: \'Input Validation\',
          message: schemaLessRoutes.length + \' route(s) are missing validation schemas.\',
          hint: \'Routes without Zod validation schemas are susceptible to SQL Injection, cross-site scripting (XSS), and malicious inputs. Add Zod schemas to: \' + 
            schemaLessRoutes.slice(0, 3).map(r => \'\\\'\' + r.method + \' \' + r.path + \'\\\'\').join(\', \') + 
            (schemaLessRoutes.length > 3 ? \' and \' + (schemaLessRoutes.length - 3) + \' more\' : \'\') + \'.\'
        });
      } else {
        findings.push({
          severity: \'ok\',
          area: \'Input Validation\',
          message: \'All HTTP routes have input or response validation schemas configured.\',
          hint: \'Great! Validating inputs at the controller boundary ensures application integrity and blocks malformed payloads.\'
        });
      }

      const metricsRoute = routes.find(r => r.path === \'/metrics\' || r.path === \'/__metrics\');
      if (metricsRoute) {
        const hasAuth = metricsRoute.plugins && metricsRoute.plugins.some(p => p.toLowerCase().includes(\'auth\') || p.toLowerCase().includes(\'jwt\') || p.toLowerCase().includes(\'session\'));
        if (!hasAuth) {
          findings.push({
            severity: \'fail\',
            area: \'Exposed Telemetry\',
            message: \'Public metrics endpoint (\\\'\' + metricsRoute.path + \'\\\') is exposed without authentication.\',
            hint: \'Exposing Prometheus metrics to the public internet leaks information about application memory, traffic volume, and server internals. Restrict access or use authentication middleware on this route.\'
          });
        } else {
          findings.push({
            severity: \'ok\',
            area: \'Exposed Telemetry\',
            message: \'Metrics endpoint is protected with authentication.\',
            hint: \'Perfect. Your server statistics are secured against public enumeration.\'
          });
        }
      }

      let passes = 0, warnings = 0, failures = 0;
      let findingsHtml = \'\';

      for (const f of findings) {
        if (f.severity === \'ok\') passes++;
        else if (f.severity === \'warn\') warnings++;
        else if (f.severity === \'fail\') failures++;

        findingsHtml += \'<div class="finding-card severity-\' + f.severity + \'">\' +
          \'<div class="finding-card-header" onclick="this.parentElement.classList.toggle(\\\'open\\\')">\' +
          \'<div class="finding-card-status-icon">\' + (f.severity === \'ok\' ? \'✓\' : f.severity === \'warn\' ? \'⚠️\' : \'❌\') + \'</div>\' +
          \'<div class="finding-card-title">\' + escapeHtml(f.message) + \'</div>\' +
          \'<div class="finding-card-area">\' + escapeHtml(f.area) + \'</div>\' +
          \'</div>\' +
          \'<div class="finding-card-body">\' +
          \'<div class="finding-card-hint">\' + f.hint + \'</div>\' +
          \'</div>\' +
          \'</div>\';
      }

      const summaryHtml = \'<div style="display:flex; gap:16px; margin-bottom:20px;">\' +
        \'<div class="info-card" style="flex:1; border-left:4px solid var(--success);">\' +
        \'<div class="info-card-label">Passed Checks</div>\' +
        \'<div class="info-card-value" style="color:var(--success);">\' + passes + \'</div>\' +
        \'</div>\' +
        \'<div class="info-card" style="flex:1; border-left:4px solid var(--warning);">\' +
        \'<div class="info-card-label">Warnings</div>\' +
        \'<div class="info-card-value" style="color:var(--warning);">\' + warnings + \'</div>\' +
        \'</div>\' +
        \'<div class="info-card" style="flex:1; border-left:4px solid var(--error);">\' +
        \'<div class="info-card-label">Critical Vulnerabilities</div>\' +
        \'<div class="info-card-value" style="color:var(--error);">\' + failures + \'</div>\' +
        \'</div>\' +
        \'</div>\';

      document.getElementById(\'security-content\').innerHTML = summaryHtml + findingsHtml;
    }
    window.runSecurityAudit = runSecurityAudit;

    // ── Hooks ─────────────────────────────────────────────────────
    function renderHooks() {
      const hookDescriptions = {
        onRequest: 'Runs immediately when a request is received, before routing',
        onPreHandler: 'Runs after routing but before the route handler',
        onPostHandler: 'Runs after the route handler completes successfully',
        onError: 'Runs when an error is thrown during request processing',
        onClose: 'Runs after the response is sent (cleanup)'
      };

      let html = '<div class="info-grid">';
      for (const h of discovery.hooks) {
        const color = h.count > 0 ? 'var(--success)' : 'var(--text-muted)';
        
        let handlersHtml = '';
        if (h.handlers && h.handlers.length > 0) {
          handlersHtml = '<div class="hook-handlers-list">' +
            h.handlers.map(name => 
              '<div class="hook-handler-item">' +
              '<span class="hook-handler-icon">ƒ</span>' +
              '<span>' + escapeHtml(name) + '</span>' +
              '</div>'
            ).join('') +
            '</div>';
        }

        html += '<div class="info-card" style="display:flex;flex-direction:column;justify-content:space-between;">' +
          '<div>' +
          '<div class="info-card-label">' + h.type + '</div>' +
          '<div class="info-card-value" style="color:' + color + '">' + h.count + '</div>' +
          '<div class="info-card-sub" style="margin-bottom:8px;">' + (hookDescriptions[h.type] || '') + '</div>' +
          '</div>' +
          handlersHtml +
          '</div>';
      }
      html += '</div>';
      document.getElementById('hooks-content').innerHTML = html;
    }

    // ── Config ────────────────────────────────────────────────────
    let sysStatsInterval = null;

    function startSysStatsPolling() {
      if (sysStatsInterval) return;
      fetchSysStats();
      sysStatsInterval = setInterval(fetchSysStats, 3000);
    }

    function stopSysStatsPolling() {
      if (sysStatsInterval) {
        clearInterval(sysStatsInterval);
        sysStatsInterval = null;
      }
    }

    async function fetchSysStats() {
      try {
        const res = await fetch('/__studio/api/system');
        const stats = await res.json();
        renderSysStats(stats);
      } catch (err) {
        console.error('Failed to fetch system stats:', err);
      }
    }

    function renderSysStats(stats) {
      const grid = document.getElementById('system-stats-grid');
      if (!grid) return;

      const heapUsedMb = Math.round(stats.memory.heapUsed / 1024 / 1024);
      const heapTotalMb = Math.round(stats.memory.heapTotal / 1024 / 1024);
      const heapPct = Math.round((stats.memory.heapUsed / stats.memory.heapTotal) * 100) || 0;
      
      const rssMb = Math.round(stats.memory.rss / 1024 / 1024);
      const sysMemUsedGb = ((stats.systemMemory.total - stats.systemMemory.free) / 1024 / 1024 / 1024).toFixed(1);
      const sysMemTotalGb = (stats.systemMemory.total / 1024 / 1024 / 1024).toFixed(1);
      const sysMemPct = Math.round(((stats.systemMemory.total - stats.systemMemory.free) / stats.systemMemory.total) * 100) || 0;

      let heapColorClass = 'success';
      if (heapPct > 85) heapColorClass = 'error';
      else if (heapPct > 70) heapColorClass = 'warning';

      let sysColorClass = 'success';
      if (sysMemPct > 90) sysColorClass = 'error';
      else if (sysMemPct > 75) sysColorClass = 'warning';

      grid.innerHTML = 
        '<div class="info-card">' +
        '  <div class="info-card-label">Node Process Memory</div>' +
        '  <div class="info-card-value">' + heapUsedMb + ' <span style="font-size:14px;color:var(--text-secondary);font-weight:500;">/ ' + heapTotalMb + ' MB Heap</span></div>' +
        '  <div class="info-card-sub">RSS Memory: ' + rssMb + ' MB</div>' +
        '  <div class="metric-progress-container" title="Heap Memory Usage: ' + heapPct + '%">' +
        '    <div class="metric-progress-bar ' + heapColorClass + '" style="width: ' + heapPct + '%;"></div>' +
        '  </div>' +
        '</div>' +
        
        '<div class="info-card">' +
        '  <div class="info-card-label">System Host Memory</div>' +
        '  <div class="info-card-value">' + sysMemUsedGb + ' <span style="font-size:14px;color:var(--text-secondary);font-weight:500;">/ ' + sysMemTotalGb + ' GB Used</span></div>' +
        '  <div class="info-card-sub">CPU Cores: ' + stats.systemCpuCount + '</div>' +
        '  <div class="metric-progress-container" title="System Memory Usage: ' + sysMemPct + '%">' +
        '    <div class="metric-progress-bar ' + sysColorClass + '" style="width: ' + sysMemPct + '%;"></div>' +
        '  </div>' +
        '</div>' +
        
        '<div class="info-card">' +
        '  <div class="info-card-label">Process Uptime</div>' +
        '  <div class="info-card-value">' + formatUptime(stats.uptime) + '</div>' +
        '  <div class="info-card-sub">Process PID: ' + stats.pid + '</div>' +
        '</div>' +
        
        '<div class="info-card">' +
        '  <div class="info-card-label">Node Runtime & OS</div>' +
        '  <div class="info-card-value" style="font-size: 18px; padding-top: 4px;">' + stats.nodeVersion + '</div>' +
        '  <div class="info-card-sub" style="font-family:var(--font-mono);">' + stats.platform + ' (' + stats.arch + ')</div>' +
        '</div>';
    }

    function formatUptime(sec) {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
      if (m > 0) return m + 'm ' + s + 's';
      return s + 's';
    }

    function renderEnvVars(filter = '') {
      const tbody = document.getElementById('env-table-body');
      if (!tbody) return;
      if (!discovery || !discovery.env) {
        tbody.innerHTML = '<tr><td colspan="2" style="color:var(--text-muted);text-align:center;">No environment variables available</td></tr>';
        return;
      }
      
      const query = filter.toLowerCase().trim();
      let keys = Object.keys(discovery.env).sort();
      
      if (query) {
        keys = keys.filter(k => 
          k.toLowerCase().includes(query) || 
          discovery.env[k].toLowerCase().includes(query)
        );
      }
      
      if (keys.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" style="color:var(--text-muted);text-align:center;">No matching environment variables</td></tr>';
        return;
      }
      
      tbody.innerHTML = keys.map(k => 
        '<tr>' +
        '  <td class="env-key">' + escapeHtml(k) + '</td>' +
        '  <td class="env-val">' + escapeHtml(discovery.env[k]) + '</td>' +
        '</tr>'
      ).join('');
    }

    window.startSysStatsPolling = startSysStatsPolling;
    window.stopSysStatsPolling = stopSysStatsPolling;

    function renderConfig() {
      const c = discovery.config;
      const cards = [
        { label: 'HTTP Routes', value: c.httpRouteCount, sub: 'Registered endpoints' },
        { label: 'WebSocket Routes', value: c.wsRouteCount, sub: 'Real-time endpoints' },
        { label: 'Total Hooks', value: c.hookCount, sub: 'Lifecycle handlers' },
        { label: 'DI Services', value: c.serviceCount, sub: 'Registered services' },
        { label: 'Request Timeout', value: c.timeout > 0 ? c.timeout + 'ms' : 'None', sub: 'Default timeout' },
        { label: 'Route Conflict', value: c.routeConflict, sub: 'Collision strategy' },
        { label: 'Strict Schema', value: c.strictSchema ? 'Enabled' : 'Disabled', sub: 'Schema enforcement' },
      ];

      let html = '<div class="info-grid">';
      for (const card of cards) {
        html += '<div class="info-card">' +
          '<div class="info-card-label">' + card.label + '</div>' +
          '<div class="info-card-value">' + card.value + '</div>' +
          '<div class="info-card-sub">' + card.sub + '</div>' +
          '</div>';
      }
      html += '</div>';

      // System stats grid
      html += '<div class="panel-header" style="margin-top: 32px; margin-bottom: 16px;">' +
        '  <div class="panel-title" style="font-size:18px;">System Resource Monitor</div>' +
        '  <div class="panel-subtitle">Real-time performance metrics (updates every 3s)</div>' +
        '</div>' +
        '<div class="info-grid" id="system-stats-grid">Loading system stats...</div>';

      // Environment variables table
      html += '<div class="panel-header" style="margin-top: 32px; margin-bottom: 16px;">' +
        '  <div class="panel-title" style="font-size:18px;">Environment Variables</div>' +
        '  <div class="panel-subtitle">Current process environment variables (sensitive values masked)</div>' +
        '</div>' +
        '<div class="env-table-container">' +
        '  <div class="env-search-bar">' +
        '    <input class="search-input" id="env-search" type="text" placeholder="Search environment variables by name or value..." />' +
        '  </div>' +
        '  <table class="env-table">' +
        '    <thead><tr><th>Variable</th><th>Value</th></tr></thead>' +
        '    <tbody id="env-table-body"></tbody>' +
        '  </table>' +
        '</div>';

      html += '<div class="info-card" style="margin-top:24px">' +
        '<div class="info-card-label">Discovery Timestamp</div>' +
        '<div style="font-size:13px;color:var(--text-secondary);font-family:var(--font-mono)">' +
        discovery.discoveredAt + '</div></div>';

      document.getElementById('config-content').innerHTML = html;

      // Populate environment variables table
      renderEnvVars();

      // Bind search handler
      document.getElementById('env-search')?.addEventListener('input', (e) => {
        renderEnvVars(e.target.value);
      });
    }

    // ── Health ────────────────────────────────────────────────────
    function renderHealth() {
      const h = discovery.health;
      if (!h) {
        document.getElementById('health-content').innerHTML =
          '<div class="empty-state"><div class="empty-state-icon">❤️</div>' +
          '<div class="empty-state-message">Health data not available</div></div>';
        return;
      }

      const summaryCards = [
        { label: 'Passes', value: h.summary.passes, color: 'var(--success)', sub: 'Ready for production' },
        { label: 'Warnings', value: h.summary.warnings, color: h.summary.warnings > 0 ? 'var(--warning)' : 'var(--text-muted)', sub: 'Action recommended' },
        { label: 'Failures', value: h.summary.failures, color: h.summary.failures > 0 ? 'var(--error)' : 'var(--text-muted)', sub: 'Must fix before ship' }
      ];

      let html = '<div class="info-grid">';
      for (const card of summaryCards) {
        html += '<div class="info-card">' +
          '<div class="info-card-label">' + card.label + '</div>' +
          '<div class="info-card-value" style="color:' + card.color + '">' + card.value + '</div>' +
          '<div class="info-card-sub">' + card.sub + '</div>' +
          '</div>';
      }
      html += '</div>';

      if (h.findings.length === 0) {
        html += '<div class="empty-state"><div class="empty-state-icon">🎉</div>' +
          '<div class="empty-state-message">All checks passed! Your app is ready for production.</div></div>';
        document.getElementById('health-content').innerHTML = html;
        return;
      }

      const sevOrder = { fail: 0, warn: 1, ok: 2 };
      const sortedFindings = [...h.findings].sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || a.area.localeCompare(b.area));

      html += '<div style="margin-top: 24px;">';
      for (const f of sortedFindings) {
        const icon = f.severity === 'ok' ? '✓' : f.severity === 'warn' ? '⚠' : '✗';
        const hasHint = !!f.hint;
        const clickAttr = hasHint ? ' onclick="this.classList.toggle(\\\'open\\\')"' : '';
        const cursorStyle = hasHint ? ' style="cursor:pointer"' : ' style="cursor:default"';

        html += '<div class="finding-card severity-' + f.severity + '"' + clickAttr + '>' +
          '<div class="finding-card-header"' + cursorStyle + '>' +
          (hasHint ? '<span class="schema-card-chevron">▶</span>' : '') +
          '<div class="finding-card-status-icon">' + icon + '</div>' +
          '<div class="finding-card-title">' + escapeHtml(f.message) + '</div>' +
          '<div class="finding-card-area">' + f.area + '</div>' +
          '</div>';

        if (hasHint) {
          html += '<div class="finding-card-body">' +
            '<div class="finding-card-hint">' + escapeHtml(f.hint) + '</div>' +
            '</div>';
        }
        html += '</div>';
      }
      html += '</div>';

      document.getElementById('health-content').innerHTML = html;
    }

    // ── Live Sync (WebSockets) ────────────────────────────────────
    let socket = null;
    const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/__studio/ws';
    let reconnectTimeout = null;

    function connectWs() {
      if (socket) {
        socket.close();
      }

      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log('Studio Live Sync connected');
        clearTimeout(reconnectTimeout);
        updateWsStatus('connected');
        removeErrorBanner('reload-error');
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'reload') {
            removeErrorBanner('reload-error');
            removeErrorBanner('build-error');
            fetchDiscovery();
          } else if (data.type === 'build-error') {
            showErrorBanner('build-error', 'Build Failed: ' + data.errors.map(e => e.text).join('<br/>'));
          } else if (data.type === 'reload-error') {
            showErrorBanner('reload-error', 'Reload Failed: ' + data.message);
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      socket.onclose = () => {
        console.log('Studio Live Sync disconnected, reconnecting...');
        updateWsStatus('disconnected');
        reconnectTimeout = setTimeout(connectWs, 2000);
      };

      socket.onerror = () => {
        socket.close();
      };
    }

    function updateWsStatus(status) {
      const statsEl = document.getElementById('header-stats');
      if (!statsEl) return;
      let statusDot = document.getElementById('ws-status-dot');
      if (!statusDot) {
        statusDot = document.createElement('span');
        statusDot.id = 'ws-status-dot';
        statusDot.style.display = 'inline-flex';
        statusDot.style.alignItems = 'center';
        statusDot.style.gap = '6px';
        statusDot.style.marginLeft = '16px';
        statsEl.appendChild(statusDot);
      }
      if (status === 'connected') {
        statusDot.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:var(--success);box-shadow:0 0 8px var(--success)"></span><span style="font-size:11px;color:var(--text-secondary)">Sync Live</span>';
      } else {
        statusDot.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:var(--error);box-shadow:0 0 8px var(--error);animation:pulse 1s infinite"></span><span style="font-size:11px;color:var(--text-secondary)">Offline</span>';
      }
    }

    function showErrorBanner(id, htmlContent) {
      let banner = document.getElementById('banner-' + id);
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'banner-' + id;
        banner.className = 'error-banner';
        banner.style.margin = '0 0 20px 0';
        const mainEl = document.getElementById('main-content');
        if (mainEl) {
          mainEl.insertBefore(banner, mainEl.firstChild);
        }
      }
      banner.innerHTML = htmlContent;
    }

    // ── Utilities ─────────────────────────────────────────────────
    function removeErrorBanner(id) {
      const banner = document.getElementById('banner-' + id);
      if (banner) {
        banner.remove();
      }
    }

    function escapeHtml(str) {
      if (typeof str !== 'string') return str;
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // ── Request Tester ────────────────────────────────────────────
    let testerInitialised = false;

    function renderTester() {
      const select = document.getElementById('tester-route-select');
      if (!select) return;

      const prevVal = select.value;
      select.innerHTML = '<option value="">-- Choose a discovered route to pre-fill --</option>';

      const httpRoutes = discovery.routes.filter(r => !r.isWs);
      for (const r of httpRoutes) {
        const opt = document.createElement('option');
        opt.value = r.method + ' ' + r.path;
        opt.textContent = r.method + ' ' + r.path + (r.summary ? ' - ' + r.summary : '');
        select.appendChild(opt);
      }

      if (prevVal) {
        select.value = prevVal;
      }

      if (!testerInitialised) {
        initTesterListeners();
      }
    }

    function initTesterListeners() {
      testerInitialised = true;
      const select = document.getElementById('tester-route-select');

      select.addEventListener('change', () => {
        const val = select.value;
        if (!val) return;
        const parts = val.split(' ');
        const method = parts[0];
        const path = parts[1];

        document.getElementById('tester-method').value = method;
        document.getElementById('tester-path').value = path;

        const schema = discovery.schemas.find(s => s.method === method && s.path === path);
        const bodyTextarea = document.getElementById('tester-body');

        if (schema && schema.body) {
          const template = generateJsonTemplate(schema.body);
          bodyTextarea.value = JSON.stringify(template, null, 2);
        } else {
          bodyTextarea.value = '';
        }

        const queryContainer = document.getElementById('tester-query-container');
        queryContainer.innerHTML = '';
        if (schema && schema.query && schema.query.properties) {
          for (const propName of Object.keys(schema.query.properties)) {
            addQueryParam(propName, '');
          }
        }
      });

      document.getElementById('btn-add-query').addEventListener('click', (e) => {
        e.preventDefault();
        addQueryParam('', '');
      });

      document.getElementById('btn-add-header').addEventListener('click', (e) => {
        e.preventDefault();
        addHeader('', '');
      });

      document.getElementById('btn-send-request').addEventListener('click', async () => {
        const btn = document.getElementById('btn-send-request');
        const method = document.getElementById('tester-method').value;
        const path = document.getElementById('tester-path').value.trim();

        if (!path) {
          alert('Please enter a request path');
          return;
        }

        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin-right: 8px;"></div> Sending...';

        const query = {};
        document.getElementById('tester-query-container').querySelectorAll('.kv-row').forEach(row => {
          const key = row.querySelector('[data-type="key"]').value.trim();
          const val = row.querySelector('[data-type="value"]').value.trim();
          if (key) query[key] = val;
        });

        const headers = {};
        document.getElementById('tester-headers-container').querySelectorAll('.kv-row').forEach(row => {
          const key = row.querySelector('[data-type="key"]').value.trim();
          const val = row.querySelector('[data-type="value"]').value.trim();
          if (key) headers[key] = val;
        });

        let body = undefined;
        const bodyText = document.getElementById('tester-body').value.trim();
        if (bodyText) {
          try {
            body = JSON.parse(bodyText);
          } catch (err) {
            alert('Invalid JSON request body: ' + err.message);
            btn.disabled = false;
            btn.innerHTML = '<span>⚡</span> Send Request';
            return;
          }
        }

        try {
          const res = await fetch('/__studio/api/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method, path, headers, query, body })
          });

          const result = await res.json();
          btn.disabled = false;
          btn.innerHTML = '<span>⚡</span> Send Request';
          fetchReplays();

          if (result.error) {
            showResponseError(result.error + (result.message ? ': ' + result.message : ''));
            return;
          }

          showResponse(result);
        } catch (err) {
          btn.disabled = false;
          btn.innerHTML = '<span>⚡</span> Send Request';
          showResponseError('Network error sending request: ' + err.message);
        }
      });

      document.getElementById('btn-copy-response').addEventListener('click', () => {
        const bodyText = document.getElementById('response-body-pre').textContent;
        navigator.clipboard.writeText(bodyText).then(() => {
          const btn = document.getElementById('btn-copy-response');
          const original = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => btn.textContent = original, 1500);
        });
      });
    }

    function addQueryParam(key, val) {
      const container = document.getElementById('tester-query-container');
      const row = document.createElement('div');
      row.className = 'kv-row';
      row.innerHTML =
        '<input class="text-input" type="text" placeholder="Key" value="' + escapeHtml(key) + '" data-type="key" />' +
        '<input class="text-input" type="text" placeholder="Value" value="' + escapeHtml(val) + '" data-type="value" />' +
        '<button class="btn btn-danger" onclick="this.parentElement.remove()">Remove</button>';
      container.appendChild(row);
    }

    function addHeader(key, val) {
      const container = document.getElementById('tester-headers-container');
      const row = document.createElement('div');
      row.className = 'kv-row';
      row.innerHTML =
        '<input class="text-input" type="text" placeholder="Header" value="' + escapeHtml(key) + '" data-type="key" />' +
        '<input class="text-input" type="text" placeholder="Value" value="' + escapeHtml(val) + '" data-type="value" />' +
        '<button class="btn btn-danger" onclick="this.parentElement.remove()">Remove</button>';
      container.appendChild(row);
    }

    function generateJsonTemplate(schema) {
      if (!schema) return null;
      if (schema.type === 'object' && schema.properties) {
        const obj = {};
        for (const [k, prop] of Object.entries(schema.properties)) {
          obj[k] = generateJsonTemplate(prop);
        }
        return obj;
      }
      if (schema.type === 'array') {
        return [generateJsonTemplate(schema.items)];
      }
      if (schema.type === 'string') {
        return schema.description || 'string';
      }
      if (schema.type === 'number' || schema.type === 'integer') {
        return 0;
      }
      if (schema.type === 'boolean') {
        return true;
      }
      return null;
    }

    function showResponse(result) {
      document.getElementById('tester-response-placeholder').style.display = 'none';
      const contentEl = document.getElementById('tester-response-content');
      contentEl.style.display = 'flex';

      const badge = document.getElementById('response-status-badge');
      badge.textContent = result.status + ' ' + getStatusText(result.status);
      badge.className = 'response-status-badge';
      if (result.status >= 200 && result.status < 300) {
        badge.style.background = 'rgba(0, 210, 160, 0.15)';
        badge.style.color = 'var(--success)';
      } else if (result.status >= 300 && result.status < 400) {
        badge.style.background = 'rgba(255, 193, 7, 0.15)';
        badge.style.color = 'var(--warning)';
      } else {
        badge.style.background = 'rgba(255, 107, 107, 0.15)';
        badge.style.color = 'var(--error)';
      }

      const headersBody = document.getElementById('response-headers-body');
      headersBody.innerHTML = '';
      if (result.headers) {
        for (const [k, v] of Object.entries(result.headers)) {
          const tr = document.createElement('tr');
          tr.innerHTML =
            '<td class="response-headers-key">' + escapeHtml(k) + '</td>' +
            '<td class="response-headers-value">' + escapeHtml(String(v)) + '</td>';
          headersBody.appendChild(tr);
        }
      }

      const bodyPre = document.getElementById('response-body-pre');
      if (result.body !== null && result.body !== undefined) {
        if (typeof result.body === 'object') {
          bodyPre.textContent = JSON.stringify(result.body, null, 2);
        } else {
          bodyPre.textContent = String(result.body);
        }
      } else {
        bodyPre.textContent = '[Empty Response Body]';
      }

      // Render validation errors
      const validationGroup = document.getElementById('response-validation-errors-group');
      const validationContainer = document.getElementById('response-validation-errors');
      if (result.profile && result.profile.validationErrors && result.profile.validationErrors.length > 0) {
        validationGroup.style.display = 'block';
        validationContainer.innerHTML = '';
        for (const err of result.profile.validationErrors) {
          const row = document.createElement('div');
          row.style.cssText = 'background:rgba(239, 68, 68, 0.05); border:1px solid rgba(239, 68, 68, 0.15); border-radius:var(--radius-sm); padding:10px; font-size:12px; display:flex; flex-direction:column; gap:4px; margin-bottom:8px;';
          row.innerHTML = '<div><strong style="color:var(--error)">Field:</strong> <code style="font-family:var(--font-mono); font-weight:600; color:var(--error);">' + escapeHtml(err.field) + '</code> (<span style="text-transform:uppercase; font-size:10px; font-weight:600; color:var(--text-secondary);">' + escapeHtml(err.location) + '</span>)</div>' +
            '<div><strong>Reason:</strong> ' + escapeHtml(err.reason) + '</div>' +
            '<div><strong>Received:</strong> <code style="font-family:var(--font-mono); background:var(--bg-tertiary); padding:2px 4px; border-radius:3px; font-size:11px;">' + escapeHtml(JSON.stringify(err.received)) + '</code></div>';
          validationContainer.appendChild(row);
        }
      } else {
        validationGroup.style.display = 'none';
      }

      // Render timeline
      const timelineGroup = document.getElementById('response-profile-timeline-group');
      const timelineContainer = document.getElementById('response-profile-timeline');
      if (result.profile && result.profile.timeline && result.profile.timeline.length > 0) {
        timelineGroup.style.display = 'block';
        timelineContainer.innerHTML = '';
        const maxDuration = Math.max(...result.profile.timeline.map(t => t.duration), 1);
        for (const item of result.profile.timeline) {
          const percentage = Math.max((item.duration / maxDuration) * 100, 2);
          const row = document.createElement('div');
          row.className = 'timeline-row';
          let typeClass = 'timeline-type-middleware';
          if (item.type === 'hook') typeClass = 'timeline-type-hook';
          else if (item.type === 'handler') typeClass = 'timeline-type-handler';
          row.innerHTML = 
            '<div class="timeline-label-row">' +
            '<div>' +
            '<span style="color:var(--text-primary); font-size:12px;">' + escapeHtml(item.name) + '</span>' +
            '<span class="timeline-type-badge ' + typeClass + '">' + item.type + '</span>' +
            '</div>' +
            '<span class="timeline-duration">' + item.duration.toFixed(2) + ' ms</span>' +
            '</div>' +
            '<div class="timeline-bar-container">' +
            '<div class="timeline-bar" style="width: ' + percentage + '%"></div>' +
            '</div>';
          timelineContainer.appendChild(row);
        }
      } else {
        timelineGroup.style.display = 'none';
      }

      // Render database queries
      const queriesGroup = document.getElementById('response-profile-queries-group');
      const queriesContainer = document.getElementById('response-profile-queries');
      if (result.profile && result.profile.queries && result.profile.queries.length > 0) {
        queriesGroup.style.display = 'block';
        queriesContainer.innerHTML = '';
        for (const item of result.profile.queries) {
          const row = document.createElement('div');
          row.className = 'db-query-row';
          row.innerHTML = 
            '<div class="db-query-header">' +
            '<span class="db-query-badge">DATABASE QUERY</span>' +
            '<span class="db-query-duration">' + item.duration.toFixed(2) + ' ms</span>' +
            '</div>' +
            '<pre class="db-query-sql">' + escapeHtml(item.query) + '</pre>';
          queriesContainer.appendChild(row);
        }
      } else {
        queriesGroup.style.display = 'none';
      }
    }

    function showResponseError(message) {
      document.getElementById('tester-response-placeholder').style.display = 'none';
      const contentEl = document.getElementById('tester-response-content');
      contentEl.style.display = 'flex';

      const badge = document.getElementById('response-status-badge');
      badge.textContent = 'ERROR';
      badge.style.background = 'rgba(255, 107, 107, 0.15)';
      badge.style.color = 'var(--error)';

      document.getElementById('response-headers-body').innerHTML = '<tr><td colspan="2" style="color:var(--error)">Failed to execute request</td></tr>';
      document.getElementById('response-body-pre').textContent = message;
    }

    function getStatusText(code) {
      const statusTexts = {
        200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
        301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
        400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
        500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable'
      };
      return statusTexts[code] || '';
    }

    // ── Observatory, WS Analytics, Replays, Architecture, Events Renderers ──
    let errorsInterval = null;
    function startErrorsPolling() {
      if (errorsInterval) return;
      fetchErrors();
      errorsInterval = setInterval(fetchErrors, 3000);
    }
    function stopErrorsPolling() {
      if (errorsInterval) {
        clearInterval(errorsInterval);
        errorsInterval = null;
      }
    }

    async function fetchErrors() {
      try {
        const res = await fetch('/__studio/api/errors');
        const data = await res.json();
        
        const badge = document.getElementById('badge-errors');
        if (badge) badge.textContent = data.errorsToday;

        if (activePanel === 'errors') {
          renderErrors(data);
        }
      } catch (err) {
        console.error('Failed to fetch errors:', err);
      }
    }

    function renderErrors(data) {
      const container = document.getElementById('errors-content');
      if (!container) return;

      const summaryHtml = '<div style="display:flex; gap:16px; margin-bottom:20px;">' +
        '<div class="info-card" style="flex:1;">' +
        '<div class="info-card-label">Errors Today</div>' +
        '<div class="info-card-value">' + data.errorsToday + '</div>' +
        '</div>' +
        '<div class="info-card" style="flex:1;">' +
        '<div class="info-card-label">Top Error</div>' +
        '<div class="info-card-value" style="font-size:18px; color:var(--error); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + escapeHtml(data.topError) + '</div>' +
        '<div class="info-card-sub">Occurred ' + data.topErrorCount + ' times</div>' +
        '</div>' +
        '</div>';

      if (data.errors.length === 0) {
        container.innerHTML = summaryHtml + 
          '<div class="empty-state">' +
          '<div class="empty-state-icon">👁️</div>' +
          '<div class="empty-state-message">No errors recorded yet. Good job!</div>' +
          '</div>';
        return;
      }

      let listHtml = '<div style="display:flex; flex-direction:column; gap:12px;">';
      const errors = [...data.errors].reverse();
      for (const err of errors) {
        let detailsHtml = '';
        if (err.payload) {
          detailsHtml += '<div style="margin-top:8px;">';
          if (err.payload.body && Object.keys(err.payload.body).length > 0) {
            detailsHtml += '<div style="font-size:11px; font-weight:600; color:var(--text-muted); margin-bottom:4px;">Request Body</div>' +
              '<pre class="schema-json" style="margin-top:0; margin-bottom:8px;">' + escapeHtml(JSON.stringify(err.payload.body, null, 2)) + '</pre>';
          }
          if (err.payload.query && Object.keys(err.payload.query).length > 0) {
            detailsHtml += '<div style="font-size:11px; font-weight:600; color:var(--text-muted); margin-bottom:4px;">Query Params</div>' +
              '<pre class="schema-json" style="margin-top:0; margin-bottom:8px;">' + escapeHtml(JSON.stringify(err.payload.query, null, 2)) + '</pre>';
          }
          if (err.payload.validationErrors && err.payload.validationErrors.length > 0) {
            detailsHtml += '<div style="font-size:11px; font-weight:600; color:var(--error); margin-bottom:4px;">Validation Details</div>';
            let vHtml = '<div style="display:flex; flex-direction:column; gap:6px; margin-bottom:8px;">';
            for (const ve of err.payload.validationErrors) {
              vHtml += '<div style="background:rgba(239, 68, 68, 0.05); border:1px solid rgba(239, 68, 68, 0.15); border-radius:var(--radius-sm); padding:8px; font-size:12px;">' +
                '<div><strong>Field:</strong> <code style="font-family:var(--font-mono); color:var(--error);">' + escapeHtml(ve.field) + '</code> (' + escapeHtml(ve.location) + ')</div>' +
                '<div><strong>Reason:</strong> ' + escapeHtml(ve.reason) + '</div>' +
                '<div><strong>Received:</strong> <code style="font-family:var(--font-mono);">' + escapeHtml(JSON.stringify(ve.received)) + '</code></div>' +
                '</div>';
            }
            vHtml += '</div>';
            detailsHtml += vHtml;
          }
          detailsHtml += '</div>';
        }

        listHtml += '<div class="schema-card" onclick="this.classList.toggle(\\\'open\\\')">' +
          '<div class="schema-card-header" style="border-left: 4px solid var(--error);">' +
          '<span class="schema-card-chevron">▶</span>' +
          '<span class="method-badge method-' + err.method + '" style="flex:none;">' + err.method + '</span>' +
          '<span class="route-path" style="margin-left:8px; word-break:break-all;">' + escapeHtml(err.path) + '</span>' +
          '<span style="font-weight:600; color:var(--error); margin-left:12px; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:40%;">' + escapeHtml(err.name) + '</span>' +
          '<span style="color:var(--text-muted); font-size:11px; margin-left:auto; font-family:var(--font-mono);">' + new Date(err.timestamp).toLocaleTimeString() + '</span>' +
          '</div>' +
          '<div class="schema-card-body" style="padding-top:12px;">' +
          '<div style="font-size:13px; font-weight:500; margin-bottom:8px; color:var(--text-primary); font-family:var(--font-mono);">' + escapeHtml(err.message) + '</div>' +
          detailsHtml +
          '<div class="schema-section-label">Stack Trace</div>' +
          '<pre class="schema-json" style="background:#1a1a24; color:#a6accd; max-height:250px; overflow-y:auto; font-size:11px; font-family:var(--font-mono); padding:10px;">' + escapeHtml(err.stack) + '</pre>' +
          '</div>' +
          '</div>';
      }
      listHtml += '</div>';

      container.innerHTML = summaryHtml + listHtml;
    }

    let wsAnalyticsInterval = null;
    function startWsAnalyticsPolling() {
      if (wsAnalyticsInterval) return;
      fetchWsAnalytics();
      wsAnalyticsInterval = setInterval(fetchWsAnalytics, 2000);
    }
    function stopWsAnalyticsPolling() {
      if (wsAnalyticsInterval) {
        clearInterval(wsAnalyticsInterval);
        wsAnalyticsInterval = null;
      }
    }

    async function fetchWsAnalytics() {
      try {
        const res = await fetch('/__studio/api/ws-analytics');
        const data = await res.json();
        if (activePanel === 'ws-analytics') {
          renderWsAnalytics(data);
        }
      } catch (err) {
        console.error('Failed to fetch WS analytics:', err);
      }
    }

    function renderWsAnalytics(data) {
      const container = document.getElementById('ws-analytics-content');
      if (!container) return;

      const m = data.metrics;
      const rates = data.rates || [];
      const currentRate = rates.length > 0 ? rates[rates.length - 1].rate : 0;

      const summaryHtml = '<div class="info-grid">' +
        '<div class="info-card">' +
        '<div class="info-card-label">Messages Received</div>' +
        '<div class="info-card-value">' + m.messagesReceived + '</div>' +
        '<div class="info-card-sub">Throughput: ' + currentRate + ' msg/sec</div>' +
        '</div>' +
        '<div class="info-card">' +
        '<div class="info-card-label">Total Data Size</div>' +
        '<div class="info-card-value">' + formatBytes(m.totalPayloadSize) + '</div>' +
        '<div class="info-card-sub">Largest: ' + formatBytes(m.largestPayloadSize) + '</div>' +
        '</div>' +
        '<div class="info-card">' +
        '<div class="info-card-label">Slowest Handler</div>' +
        '<div class="info-card-value" style="font-size:18px; font-family:var(--font-mono); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' +
        (m.slowestHandler ? escapeHtml(m.slowestHandler.event) : 'None') +
        '</div>' +
        '<div class="info-card-sub">' + (m.slowestHandler ? m.slowestHandler.duration.toFixed(2) + ' ms' : '—') + '</div>' +
        '</div>' +
        '</div>';

      let eventsHtml = '<div style="margin-top:24px;">' +
        '  <div class="panel-header" style="margin-bottom:12px;">' +
        '    <div class="panel-title" style="font-size:16px;">Top WebSocket Events</div>' +
        '    <div class="panel-subtitle">Frequency count by event name</div>' +
        '  </div>' +
        '  <div style="background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px; box-shadow:var(--shadow-sm);">';

      const eventPairs = Object.entries(m.eventsCount).sort((a, b) => b[1] - a[1]);
      if (eventPairs.length === 0) {
        eventsHtml += '<div style="color:var(--text-muted); font-size:13px; text-align:center; padding:16px;">No event traffic recorded yet</div>';
      } else {
        eventsHtml += '<table class="route-table"><thead><tr><th>Event Name</th><th>Count</th></tr></thead><tbody>';
        for (const [ev, count] of eventPairs) {
          eventsHtml += '<tr>' +
            '<td style="font-family:var(--font-mono); font-weight:600; color:var(--accent-text);">' + escapeHtml(ev) + '</td>' +
            '<td style="font-family:var(--font-mono); font-weight:600;">' + count + '</td>' +
            '</tr>';
        }
        eventsHtml += '</tbody></table>';
      }
      eventsHtml += '</div></div>';

      let failuresHtml = '<div style="margin-top:24px;">' +
        '  <div class="panel-header" style="margin-bottom:12px;">' +
        '    <div class="panel-title" style="font-size:16px; color:var(--error);">WebSocket Errors & Failures</div>' +
        '    <div class="panel-subtitle">History of unhandled exceptions in event handlers</div>' +
        '  </div>' +
        '  <div style="background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px; box-shadow:var(--shadow-sm);">';

      if (m.failedEvents.length === 0) {
        failuresHtml += '<div style="color:var(--text-muted); font-size:13px; text-align:center; padding:16px;">No WebSocket handler errors recorded</div>';
      } else {
        failuresHtml += '<table class="route-table"><thead><tr><th>Timestamp</th><th>Event</th><th>Error Message</th></tr></thead><tbody>';
        for (const f of [...m.failedEvents].reverse()) {
          failuresHtml += '<tr>' +
            '<td style="font-family:var(--font-mono); font-size:11px; color:var(--text-secondary);">' + new Date(f.timestamp).toLocaleTimeString() + '</td>' +
            '<td style="font-family:var(--font-mono); font-weight:600; color:var(--error);">' + escapeHtml(f.event) + '</td>' +
            '<td style="color:var(--text-secondary);">' + escapeHtml(f.error) + '</td>' +
            '</tr>';
        }
        failuresHtml += '</tbody></table>';
      }
      failuresHtml += '</div></div>';

      container.innerHTML = summaryHtml + eventsHtml + failuresHtml;
    }

    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function renderEvents() {
      const container = document.getElementById('events-content');
      if (!container) return;

      const events = discovery.events || [];

      if (events.length === 0) {
        container.innerHTML = '<div class="empty-state">' +
          '<div class="empty-state-icon">📣</div>' +
          '<div class="empty-state-message">No active Event Emitters or Listeners found in the DI Container.</div>' +
          '</div>';
        return;
      }

      let html = '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:16px;">';
      for (const e of events) {
        let listenersHtml = '';
        if (e.listeners && e.listeners.length > 0) {
          listenersHtml = '<div class="hook-handlers-list">' +
            e.listeners.map(name => 
              '<div class="hook-handler-item">' +
              '<span class="hook-handler-icon">ƒ</span>' +
              '<span>' + escapeHtml(name) + '</span>' +
              '</div>'
            ).join('') +
            '</div>';
        } else {
          listenersHtml = '<div style="margin-top:8px; font-size:12px; color:var(--text-muted); font-style:italic;">No active listeners.</div>';
        }

        html += '<div class="info-card" style="display:flex; flex-direction:column; justify-content:space-between;">' +
          '<div>' +
          '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">' +
          '<span class="info-card-label" style="margin-bottom:0;">Emitter Token</span>' +
          '<span class="tag-pill" style="font-family:var(--font-mono);">' + escapeHtml(e.emitterToken) + '</span>' +
          '</div>' +
          '<div style="font-size:15px; font-weight:700; font-family:var(--font-mono); color:var(--accent-text); margin-bottom:12px; word-break:break-all;">Event: "' + escapeHtml(e.event) + '"</div>' +
          '<div style="border-top:1px dashed var(--border); padding-top:8px;">' +
          '<div class="schema-section-label">Active Listeners (' + e.listenerCount + ')</div>' +
          listenersHtml +
          '</div>' +
          '</div>' +
          '</div>';
      }
      html += '</div>';
      container.innerHTML = html;
    }

    function renderArchitecture() {
      const container = document.getElementById('architecture-content');
      if (!container) return;

      const nodes = discovery.archMap || [];

      if (nodes.length === 0) {
        container.innerHTML = '<div class="empty-state">' +
          '<div class="empty-state-icon">🗺️</div>' +
          '<div class="empty-state-message">Architecture mapping is not available. Ensure DI container is configured.</div>' +
          '</div>';
        return;
      }

      const controllers = nodes.filter(n => n.type === 'controller');
      const services = nodes.filter(n => n.type === 'service');
      const repositories = nodes.filter(n => n.type === 'repository');
      const databases = nodes.filter(n => n.type === 'database');

      let html = '<div style="display:flex; flex-direction:column; gap:32px; align-items:center; margin-top:20px;">';

      const renderColumn = (title, items, emoji) => {
        if (items.length === 0) return '';
        let itemsHtml = '<div style="display:flex; flex-wrap:wrap; gap:16px; justify-content:center;">';
        for (const item of items) {
          let depsHtml = '';
          if (item.dependencies && item.dependencies.length > 0) {
            const depNames = item.dependencies.map(d => {
              const target = nodes.find(n => n.id === d);
              return target ? target.label : d.split(':')[1];
            });
            depsHtml = '<div style="font-size:11px; color:var(--text-secondary); margin-top:6px; font-family:var(--font-sans);"><strong>Depends on:</strong> ' + depNames.map(n => '<code style="font-family:var(--font-mono); color:var(--accent-text); background:var(--bg-tertiary); padding:2px 4px; border-radius:3px;">' + escapeHtml(n) + '</code>').join(', ') + '</div>';
          }

          itemsHtml += '<div class="info-card" style="min-width:240px; border-top: 4px solid var(--accent); box-shadow:var(--shadow-md);">' +
            '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">' +
            '<span class="info-card-label" style="margin-bottom:0;">' + title.toUpperCase() + '</span>' +
            '<span>' + emoji + '</span>' +
            '</div>' +
            '<div style="font-weight:700; font-family:var(--font-mono); font-size:13px; color:var(--text-primary); word-break:break-all;">' + escapeHtml(item.label) + '</div>' +
            depsHtml +
            '</div>';
        }
        itemsHtml += '</div>';

        return '<div style="width:100%; display:flex; flex-direction:column; align-items:center; gap:12px;">' +
          '<div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-muted); background:var(--bg-secondary); border:1px solid var(--border); border-radius:20px; padding:4px 16px;">' + title + ' Layer</div>' +
          itemsHtml +
          '</div>';
      };

      const layers = [
        { title: 'Controllers (Endpoints)', items: controllers, emoji: '🧭' },
        { title: 'Services', items: services, emoji: '🧩' },
        { title: 'Repositories', items: repositories, emoji: '📦' },
        { title: 'Database', items: databases, emoji: '🛢️' }
      ];

      const activeLayers = layers.filter(l => l.items.length > 0);
      for (let i = 0; i < activeLayers.length; i++) {
        const layer = activeLayers[i];
        html += renderColumn(layer.title, layer.items, layer.emoji);
        if (i < activeLayers.length - 1) {
          html += '<div style="font-size:24px; color:var(--text-muted); display:flex; flex-direction:column; align-items:center; line-height:1; user-select:none; margin: -10px 0;">' +
            '<span>↓</span>' +
            '</div>';
        }
      }

      html += '</div>';
      container.innerHTML = html;
    }

    async function fetchReplays() {
      try {
        const res = await fetch('/__studio/api/request/replays');
        const data = await res.json();
        renderReplays(data.history || []);
      } catch (err) {
        console.error('Failed to fetch replays:', err);
      }
    }

    function renderReplays(history) {
      const container = document.getElementById('tester-replay-history');
      if (!container) return;

      if (history.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:12px; text-align:center; padding:12px; border:1px dashed var(--border); border-radius:var(--radius-sm);">No history yet</div>';
        return;
      }

      window.replayHistory = history;

      container.innerHTML = history.slice().reverse().map(item => {
        return '<div style="display:flex; align-items:stretch; gap:6px; width:100%;">' +
          '<button class="nav-item" style="text-align:left; flex-grow:1; padding:8px 10px; font-size:12px; display:flex; flex-direction:column; gap:4px; border:1px solid var(--border); background:var(--bg-secondary); border-radius:var(--radius-sm); margin:0;" onclick="restoreReplay(\\\'' + item.id + '\\\')">' +
          '<div style="display:flex; align-items:center; gap:6px; width:100%;">' +
          '<span class="method-badge method-' + item.method + '" style="padding:2px 4px; font-size:9px; flex-shrink:0;">' + item.method + '</span>' +
          '<span style="font-family:var(--font-mono); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-grow:1; color:var(--text-primary);">' + escapeHtml(item.path) + '</span>' +
          '</div>' +
          '<div style="color:var(--text-muted); font-size:9px; font-family:var(--font-mono);">' + new Date(item.timestamp).toLocaleTimeString() + '</div>' +
          '</button>' +
          '<button class="btn btn-secondary" style="border:1px solid var(--border); background:var(--bg-secondary); border-radius:var(--radius-sm); padding:0 8px; color:var(--error); cursor:pointer; margin:0;" onclick="deleteReplay(\\\'' + item.id + '\\\', event)">' +
          '🗑️' +
          '</button>' +
          '</div>';
      }).join('');
    }

    async function deleteReplay(id, event) {
      if (event) event.stopPropagation();
      try {
        const res = await fetch('/__studio/api/request/replay?id=' + encodeURIComponent(id), {
          method: 'DELETE'
        });
        if (res.ok) {
          fetchReplays();
        } else {
          console.error('Failed to delete replay');
        }
      } catch (err) {
        console.error('Error deleting replay:', err);
      }
    }
    window.deleteReplay = deleteReplay;

    async function clearAllReplays() {
      if (!confirm('Are you sure you want to clear all request replays?')) return;
      try {
        const res = await fetch('/__studio/api/request/replays', {
          method: 'DELETE'
        });
        if (res.ok) {
          fetchReplays();
        } else {
          console.error('Failed to clear replays');
        }
      } catch (err) {
        console.error('Error clearing replays:', err);
      }
    }
    window.clearAllReplays = clearAllReplays;

    function restoreReplay(id) {
      const item = (window.replayHistory || []).find(r => r.id === id);
      if (!item) return;

      document.getElementById('tester-method').value = item.method;
      document.getElementById('tester-path').value = item.path;

      const bodyTextarea = document.getElementById('tester-body');
      if (item.body) {
        bodyTextarea.value = typeof item.body === 'object' ? JSON.stringify(item.body, null, 2) : String(item.body);
      } else {
        bodyTextarea.value = '';
      }

      const queryContainer = document.getElementById('tester-query-container');
      queryContainer.innerHTML = '';
      if (item.query && typeof item.query === 'object') {
        for (const [k, v] of Object.entries(item.query)) {
          addQueryParam(k, v);
        }
      }

      const headersContainer = document.getElementById('tester-headers-container');
      headersContainer.innerHTML = '';
      if (item.headers && typeof item.headers === 'object') {
        for (const [k, v] of Object.entries(item.headers)) {
          addHeader(k, v);
        }
      }
    }
    window.restoreReplay = restoreReplay;

    // ── Initialise ────────────────────────────────────────────────
    fetchDiscovery();
    connectWs();
  </script>
</body>
</html>`;
}
