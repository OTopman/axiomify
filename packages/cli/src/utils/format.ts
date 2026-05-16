/**
 * Shared formatting utilities for CLI output: HTTP method colouring,
 * terminal-width-aware table rendering, and pluralisation helpers.
 *
 * No external dependencies beyond `picocolors`, which the CLI already
 * pulls in. Anything fancier (cli-table3, chalk-template, etc) is
 * deliberately rejected — the CLI ships in every Axiomify scaffold and
 * its install footprint matters.
 */
import pc from 'picocolors';

// ---------------------------------------------------------------------------
// HTTP method colouring
// ---------------------------------------------------------------------------

/**
 * Returns the canonical Axiomify colour for an HTTP method. Mirrors the
 * conventions used by Insomnia / Postman / Bruno so users carry over an
 * intuition from those tools.
 */
export function colourMethod(method: string): string {
  const m = method.toUpperCase();
  const padded = m.padEnd(7); // longest is 'OPTIONS' = 7
  switch (m) {
    case 'GET':     return pc.bold(pc.green(padded));
    case 'POST':    return pc.bold(pc.blue(padded));
    case 'PUT':     return pc.bold(pc.yellow(padded));
    case 'PATCH':   return pc.bold(pc.magenta(padded));
    case 'DELETE':  return pc.bold(pc.red(padded));
    case 'HEAD':    return pc.dim(padded);
    case 'OPTIONS': return pc.dim(padded);
    case 'WS':      return pc.bold(pc.cyan(padded));
    default:        return padded;
  }
}

// ---------------------------------------------------------------------------
// Status / badge rendering
// ---------------------------------------------------------------------------

export const badge = {
  validation(label: string): string {
    return pc.cyan(label);
  },
  deprecated(): string {
    return pc.bold(pc.red('⊘ DEPRECATED'));
  },
  timeout(ms: number): string {
    return pc.dim(`${ms}ms`);
  },
  tags(tags: string[]): string {
    if (!tags.length) return '';
    return tags.map((t) => pc.dim(`#${t}`)).join(' ');
  },
};

// ---------------------------------------------------------------------------
// Table rendering — terminal-width aware
// ---------------------------------------------------------------------------

export interface Column {
  /** Column heading (rendered bold). */
  header: string;
  /** Minimum width in characters; the column expands beyond this if needed. */
  minWidth?: number;
  /** Maximum width in characters; the cell is truncated with `…` if longer. */
  maxWidth?: number;
  /** Right-pad instead of left-pad (numbers usually want right alignment). */
  align?: 'left' | 'right';
}

/** Count display width of a string — strips ANSI escape sequences. */
export function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function pad(s: string, width: number, align: 'left' | 'right'): string {
  const v = visibleLength(s);
  if (v >= width) return s;
  const filler = ' '.repeat(width - v);
  return align === 'right' ? filler + s : s + filler;
}

function truncate(s: string, max: number): string {
  if (visibleLength(s) <= max) return s;
  // We don't try to be clever with ANSI — truncate the unstyled string and
  // wrap with `pc.dim` so users can tell the cell was clipped.
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, ''); // eslint-disable-line no-control-regex
  return stripped.slice(0, max - 1) + pc.dim('…');
}

/**
 * Render a Unicode-bordered table sized to fit `terminalWidth` columns.
 * Columns whose content exceeds `maxWidth` get truncated; columns with
 * room to grow expand to fill the terminal.
 */
export function renderTable(
  columns: Column[],
  rows: string[][],
  terminalWidth = process.stdout.columns || 100,
): string {
  // Each column starts at the widest of (header, minWidth, longest cell).
  const widths = columns.map((col, i) => {
    const headerW = visibleLength(col.header);
    const cellW = Math.max(
      headerW,
      ...rows.map((r) => visibleLength(r[i] ?? '')),
    );
    let w = Math.max(headerW, cellW);
    if (col.minWidth) w = Math.max(w, col.minWidth);
    if (col.maxWidth) w = Math.min(w, col.maxWidth);
    return w;
  });

  // Total width = widths + separators (` │ `) + outer borders (`│ ` + ` │`).
  // If it exceeds the terminal, shrink columns proportionally — but only
  // those that don't have an explicit minWidth.
  const overheadPerSep = 3; // " │ "
  const overhead = (columns.length + 1) * 2 + overheadPerSep * (columns.length - 1);
  let total = widths.reduce((a, b) => a + b, 0) + overhead;
  if (total > terminalWidth) {
    const flexIdx = columns
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !c.minWidth)
      .map(({ i }) => i);
    let excess = total - terminalWidth;
    for (let pass = 0; pass < 8 && excess > 0; pass++) {
      for (const i of flexIdx) {
        if (excess <= 0) break;
        if (widths[i] > 8) {
          widths[i]--;
          excess--;
          total--;
        }
      }
    }
  }

  const bar = (l: string, m: string, r: string) =>
    l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;

  const lines: string[] = [];
  lines.push(pc.dim(bar('┌', '┬', '┐')));
  lines.push(
    pc.dim('│ ') +
      columns
        .map((c, i) => pc.bold(pad(c.header, widths[i], c.align ?? 'left')))
        .join(pc.dim(' │ ')) +
      pc.dim(' │'),
  );
  lines.push(pc.dim(bar('├', '┼', '┤')));
  for (const row of rows) {
    lines.push(
      pc.dim('│ ') +
        columns
          .map((c, i) => {
            const cell = row[i] ?? '';
            const truncated = c.maxWidth ? truncate(cell, widths[i]) : cell;
            return pad(truncated, widths[i], c.align ?? 'left');
          })
          .join(pc.dim(' │ ')) +
        pc.dim(' │'),
    );
  }
  lines.push(pc.dim(bar('└', '┴', '┘')));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function pluralise(n: number, singular: string, plural?: string): string {
  return n === 1 ? `${n} ${singular}` : `${n} ${plural ?? singular + 's'}`;
}

export const symbols = {
  ok: pc.green('✓'),
  warn: pc.yellow('⚠'),
  fail: pc.red('✗'),
  info: pc.cyan('ℹ'),
  bullet: pc.dim('•'),
  arrow: pc.dim('→'),
};
