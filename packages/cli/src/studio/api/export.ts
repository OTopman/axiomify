/**
 * Studio Export — Report Generator.
 *
 * Generates self-contained HTML, PDF, and Markdown reports aggregating
 * quality, security, contract, and performance data for sharing.
 *
 * GET  /__studio/api/export/html      — downloadable HTML report
 * GET  /__studio/api/export/pdf       — downloadable PDF report
 * GET  /__studio/api/export/markdown   — downloadable Markdown report
 */
import type { ServerResponse } from 'node:http';
import type { StudioDiscoveryResult } from '../discovery/types';
import { getContractResults, type ContractTestResult } from './contracts';
import { getRouteLatenciesMap } from './perf';
import { computeQualityScore, type QualityReport } from './quality';
import { getSecurityFindings, type SecurityFinding } from './security';

// ── Shared helpers ───────────────────────────────────────────────────────────

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function severityBadge(severity: string): string {
  const colors: Record<string, string> = {
    critical: '#ef4444',
    high: '#f97316',
    medium: '#eab308',
    low: '#3b82f6',
  };
  return `<span style="display:inline-block;background:${colors[severity] || '#64748b'};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase;">${escHtml(severity)}</span>`;
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    passed: '#22c55e',
    failed: '#ef4444',
    'missing-schema': '#94a3b8',
    'not-run': '#64748b',
  };
  return `<span style="display:inline-block;background:${colors[status] || '#64748b'};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">${escHtml(status.toUpperCase())}</span>`;
}

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#eab308';
  return '#ef4444';
}

// ── HTML Report Generator ────────────────────────────────────────────────────

function buildHtmlReport(
  discovery: StudioDiscoveryResult,
  quality: QualityReport,
  security: SecurityFinding[],
  contracts: ContractTestResult[],
): string {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const httpRoutes = discovery.routes.filter((r) => !r.isWs);
  const wsRoutes = discovery.routes.filter((r) => r.isWs);

  // Quality dimensions HTML
  const dims = quality.dimensions;
  const dimRows = [
    { name: 'Schema Coverage', ...dims.schemaCoverage },
    { name: 'Documentation', ...dims.documentation },
    { name: 'Performance', ...dims.performance },
    { name: 'Security', ...dims.security },
    { name: 'Contract Compliance', ...dims.contractCompliance },
  ]
    .map(
      (d) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escHtml(d.name)}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;"><strong style="color:${scoreColor(d.score)};">${d.score}</strong>/100</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${d.weight}%</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;">${escHtml(d.detail)}</td></tr>`,
    )
    .join('\n');

  // Security findings HTML
  let securityHtml = '<p style="color:#64748b;font-style:italic;">No security findings.</p>';
  if (security.length > 0) {
    securityHtml = security
      .map(
        (f) =>
          `<div style="border:1px solid #e2e8f0;border-left:4px solid ${f.severity === 'critical' ? '#ef4444' : f.severity === 'high' ? '#f97316' : f.severity === 'medium' ? '#eab308' : '#3b82f6'};padding:12px 16px;margin-bottom:8px;border-radius:0 6px 6px 0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">${severityBadge(f.severity)}<strong>${escHtml(f.title)}</strong>${f.cwe ? `<span style="font-size:11px;color:#94a3b8;">${escHtml(f.cwe)}</span>` : ''}</div>
            <p style="margin:4px 0;font-size:13px;color:#475569;">${escHtml(f.description)}</p>
            ${f.route ? `<p style="margin:2px 0;font-size:12px;color:#94a3b8;">Route: <code>${escHtml(f.method || '')} ${escHtml(f.route)}</code></p>` : ''}
            <p style="margin:4px 0;font-size:12px;color:#3b82f6;">💡 ${escHtml(f.remediation)}</p>
          </div>`,
      )
      .join('\n');
  }

  // Contract results HTML
  let contractsHtml = '<p style="color:#64748b;font-style:italic;">No contract tests run.</p>';
  if (contracts.length > 0) {
    const rows = contracts
      .map(
        (c) =>
          `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;"><code>${escHtml(c.method)}</code></td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;"><code>${escHtml(c.route)}</code></td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${statusBadge(c.status)}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;">${c.violations.length > 0 ? escHtml(c.violations.join('; ')) : '—'}</td></tr>`,
      )
      .join('\n');
    const passCount = contracts.filter((c) => c.passed).length;
    contractsHtml = `<p style="margin-bottom:12px;font-size:14px;"><strong>${passCount}</strong> of <strong>${contracts.length}</strong> contracts passing.</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#f8fafc;"><th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0;">Method</th><th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0;">Route</th><th style="padding:8px 12px;text-align:center;border-bottom:2px solid #e2e8f0;">Status</th><th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0;">Violations</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // Route performance HTML
  const routeLatencies = getRouteLatenciesMap();
  let perfRows = '';
  for (const r of httpRoutes) {
    const bucket = routeLatencies.get(`${r.method}:${r.path}`);
    if (bucket && bucket.count > 0) {
      const p95Color = bucket.p95 <= 200 ? '#22c55e' : bucket.p95 <= 500 ? '#eab308' : '#ef4444';
      perfRows += `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;"><code>${escHtml(r.method)}</code></td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;"><code>${escHtml(r.path)}</code></td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${bucket.count}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">${bucket.p50.toFixed(1)}ms</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;"><strong style="color:${p95Color};">${bucket.p95.toFixed(1)}ms</strong></td></tr>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Axiomify Studio Report — ${now}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif; color: #1e293b; background: #f8fafc; padding: 32px; line-height: 1.6; }
    .container { max-width: 960px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 40px; padding-bottom: 24px; border-bottom: 2px solid #e2e8f0; }
    .header h1 { font-size: 28px; font-weight: 800; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .header p { color: #64748b; margin-top: 6px; font-size: 14px; }
    .section { margin-bottom: 36px; }
    .section h2 { font-size: 20px; font-weight: 700; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0; color: #334155; }
    .gauge { display: flex; align-items: center; gap: 20px; margin-bottom: 20px; }
    .gauge-score { font-size: 56px; font-weight: 800; line-height: 1; }
    .gauge-label { font-size: 14px; color: #64748b; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .summary-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }
    .summary-card .number { font-size: 28px; font-weight: 800; color: #6366f1; }
    .summary-card .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; background: #f1f5f9; padding: 1px 4px; border-radius: 3px; }
    .footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✨ Axiomify Studio Report</h1>
      <p>Generated on ${escHtml(now)} • Node ${escHtml(process.version)} • ${escHtml(process.platform)}</p>
    </div>

    <div class="section">
      <h2>📊 Discovery Summary</h2>
      <div class="summary-grid">
        <div class="summary-card"><div class="number">${httpRoutes.length}</div><div class="label">HTTP Routes</div></div>
        <div class="summary-card"><div class="number">${wsRoutes.length}</div><div class="label">WebSocket Routes</div></div>
        <div class="summary-card"><div class="number">${discovery.schemas.length}</div><div class="label">Schemas</div></div>
        <div class="summary-card"><div class="number">${discovery.hooks.length}</div><div class="label">Hooks</div></div>
        <div class="summary-card"><div class="number">${discovery.services?.length ?? 0}</div><div class="label">DI Services</div></div>
      </div>
    </div>

    <div class="section">
      <h2>🏆 API Quality Score</h2>
      <div class="gauge">
        <div class="gauge-score" style="color:${scoreColor(quality.total)};">${quality.total}</div>
        <div><div class="gauge-label">Composite Score (0–100)</div><div style="font-size:13px;color:#475569;">Weighted average across 5 quality dimensions</div></div>
      </div>
      <table>
        <thead><tr style="background:#f8fafc;"><th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0;">Dimension</th><th style="padding:8px 12px;text-align:center;border-bottom:2px solid #e2e8f0;">Score</th><th style="padding:8px 12px;text-align:center;border-bottom:2px solid #e2e8f0;">Weight</th><th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0;">Detail</th></tr></thead>
        <tbody>${dimRows}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>🛡️ Security Audit</h2>
      <p style="margin-bottom:12px;font-size:14px;"><strong>${security.length}</strong> finding(s) — <strong style="color:#ef4444;">${security.filter((f) => f.severity === 'critical' || f.severity === 'high').length}</strong> critical/high</p>
      ${securityHtml}
    </div>

    <div class="section">
      <h2>📋 Contract Compliance</h2>
      ${contractsHtml}
    </div>

    ${perfRows ? `<div class="section">
      <h2>⚡ Performance Summary</h2>
      <table>
        <thead><tr style="background:#f8fafc;"><th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0;">Method</th><th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0;">Path</th><th style="padding:8px 12px;text-align:center;border-bottom:2px solid #e2e8f0;">Calls</th><th style="padding:8px 12px;text-align:center;border-bottom:2px solid #e2e8f0;">P50</th><th style="padding:8px 12px;text-align:center;border-bottom:2px solid #e2e8f0;">P95</th></tr></thead>
        <tbody>${perfRows}</tbody>
      </table>
    </div>` : ''}

    <div class="footer">
      Axiomify Studio v1.0 • Report generated automatically
    </div>
  </div>
</body>
</html>`;
}

// ── Markdown Report Generator ────────────────────────────────────────────────

function buildMarkdownReport(
  discovery: StudioDiscoveryResult,
  quality: QualityReport,
  security: SecurityFinding[],
  contracts: ContractTestResult[],
): string {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const httpRoutes = discovery.routes.filter((r) => !r.isWs);
  const wsRoutes = discovery.routes.filter((r) => r.isWs);

  let md = `# ✨ Axiomify Studio Report\n\n`;
  md += `> Generated on ${now} • Node ${process.version} • ${process.platform}\n\n`;
  md += `---\n\n`;

  // Discovery summary
  md += `## 📊 Discovery Summary\n\n`;
  md += `| Metric | Count |\n|--------|-------|\n`;
  md += `| HTTP Routes | ${httpRoutes.length} |\n`;
  md += `| WebSocket Routes | ${wsRoutes.length} |\n`;
  md += `| Schemas | ${discovery.schemas.length} |\n`;
  md += `| Hooks | ${discovery.hooks.length} |\n`;
  md += `| DI Services | ${discovery.services?.length ?? 0} |\n\n`;

  // Quality score
  md += `## 🏆 API Quality Score: **${quality.total}/100**\n\n`;
  md += `| Dimension | Score | Weight | Detail |\n|-----------|-------|--------|--------|\n`;
  const dims = quality.dimensions;
  const dimList = [
    { name: 'Schema Coverage', ...dims.schemaCoverage },
    { name: 'Documentation', ...dims.documentation },
    { name: 'Performance', ...dims.performance },
    { name: 'Security', ...dims.security },
    { name: 'Contract Compliance', ...dims.contractCompliance },
  ];
  for (const d of dimList) {
    md += `| ${d.name} | ${d.score}/100 | ${d.weight}% | ${d.detail} |\n`;
  }
  md += `\n`;

  // Security audit
  md += `## 🛡️ Security Audit (${security.length} findings)\n\n`;
  if (security.length === 0) {
    md += `_No security findings._\n\n`;
  } else {
    for (const f of security) {
      md += `### [${f.severity.toUpperCase()}] ${f.title}${f.cwe ? ` (${f.cwe})` : ''}\n\n`;
      md += `${f.description}\n\n`;
      if (f.route) md += `- **Route**: \`${f.method || ''} ${f.route}\`\n`;
      md += `- **Remediation**: ${f.remediation}\n\n`;
    }
  }

  // Contract compliance
  md += `## 📋 Contract Compliance\n\n`;
  if (contracts.length === 0) {
    md += `_No contract tests run._\n\n`;
  } else {
    const passCount = contracts.filter((c) => c.passed).length;
    md += `**${passCount}** of **${contracts.length}** contracts passing.\n\n`;
    md += `| Method | Route | Status | Violations |\n|--------|-------|--------|------------|\n`;
    for (const c of contracts) {
      md += `| \`${c.method}\` | \`${c.route}\` | ${c.status.toUpperCase()} | ${c.violations.length > 0 ? c.violations.join('; ') : '—'} |\n`;
    }
    md += `\n`;
  }

  // Performance
  const routeLatencies = getRouteLatenciesMap();
  const measuredRoutes = httpRoutes.filter((r) => {
    const b = routeLatencies.get(`${r.method}:${r.path}`);
    return b && b.count > 0;
  });
  if (measuredRoutes.length > 0) {
    md += `## ⚡ Performance Summary\n\n`;
    md += `| Method | Path | Calls | P50 | P95 |\n|--------|------|-------|-----|-----|\n`;
    for (const r of measuredRoutes) {
      const b = routeLatencies.get(`${r.method}:${r.path}`)!;
      md += `| \`${r.method}\` | \`${r.path}\` | ${b.count} | ${b.p50.toFixed(1)}ms | ${b.p95.toFixed(1)}ms |\n`;
    }
    md += `\n`;
  }

  // Per-route quality
  const flaggedRoutes = quality.perRoute.filter((r) => r.issues.length > 0);
  if (flaggedRoutes.length > 0) {
    md += `## 🔍 Route-Level Issues\n\n`;
    for (const r of flaggedRoutes) {
      md += `### \`${r.method} ${r.route}\` (Score: ${r.score}/100)\n\n`;
      for (const issue of r.issues) {
        md += `- ${issue}\n`;
      }
      md += `\n`;
    }
  }

  md += `---\n\n_Axiomify Studio v1.0 • Report generated automatically_\n`;
  return md;
}

// ── PDF Report Generator ────────────────────────────────────────────────────

function sanitizePdfText(text: string): string {
  return text
    .replace(/[\u{1f300}-\u{1faff}]/gu, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^>\s*/gm, '')
    .replace(/\|/g, '  ')
    .replace(/^-{3,}$/gm, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
}

function wrapPdfLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];

  const wrapped: string[] = [];
  let current = '';
  for (const word of line.split(/\s+/)) {
    if (!word) continue;
    if (!current) {
      current = word;
      continue;
    }
    if ((current + ' ' + word).length > width) {
      wrapped.push(current);
      current = word;
    } else {
      current += ' ' + word;
    }
  }
  if (current) wrapped.push(current);
  return wrapped;
}

function buildPdfReport(markdown: string): Buffer {
  const plainLines = stripMarkdown(markdown)
    .split('\n')
    .flatMap((line) => wrapPdfLine(line, 94));

  const linesPerPage = 48;
  const pages: string[][] = [];
  for (let i = 0; i < plainLines.length; i += linesPerPage) {
    pages.push(plainLines.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) pages.push(['Axiomify Studio Report']);

  const objects: string[] = [];
  const pageObjectIds: number[] = [];

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = '';
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let nextObjectId = 4;
  for (const pageLines of pages) {
    const pageObjectId = nextObjectId++;
    const contentObjectId = nextObjectId++;
    pageObjectIds.push(pageObjectId);

    const textCommands = pageLines
      .map((line, index) =>
        index === 0
          ? `(${sanitizePdfText(line)}) Tj`
          : `0 -14 Td (${sanitizePdfText(line)}) Tj`,
      )
      .join('\n');
    const content = `BT\n/F1 10 Tf\n50 760 Td\n${textCommands}\nET`;

    objects[pageObjectId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId - 1] =
      `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`;
  }

  objects[1] =
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets[i + 1] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

// ── HTTP Handlers ────────────────────────────────────────────────────────────

export function handleExportHtml(
  _req: any,
  res: ServerResponse,
  app: any,
  getDiscovery: () => StudioDiscoveryResult,
): void {
  const discovery = getDiscovery();
  const quality = computeQualityScore(discovery, app);
  const security = getSecurityFindings();
  const contracts = getContractResults();
  const html = buildHtmlReport(discovery, quality, security, contracts);

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': `attachment; filename="axiomify-report-${Date.now()}.html"`,
  });
  res.end(html);
}

export function handleExportPdf(
  _req: any,
  res: ServerResponse,
  app: any,
  getDiscovery: () => StudioDiscoveryResult,
): void {
  const discovery = getDiscovery();
  const quality = computeQualityScore(discovery, app);
  const security = getSecurityFindings();
  const contracts = getContractResults();
  const markdown = buildMarkdownReport(discovery, quality, security, contracts);
  const pdf = buildPdfReport(markdown);

  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': String(pdf.length),
    'Content-Disposition': `attachment; filename="axiomify-report-${Date.now()}.pdf"`,
  });
  res.end(pdf);
}

export function handleExportMarkdown(
  _req: any,
  res: ServerResponse,
  app: any,
  getDiscovery: () => StudioDiscoveryResult,
): void {
  const discovery = getDiscovery();
  const quality = computeQualityScore(discovery, app);
  const security = getSecurityFindings();
  const contracts = getContractResults();
  const markdown = buildMarkdownReport(discovery, quality, security, contracts);

  res.writeHead(200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="axiomify-report-${Date.now()}.md"`,
  });
  res.end(markdown);
}
