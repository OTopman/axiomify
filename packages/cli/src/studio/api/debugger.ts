/**
 * Studio Debugger — Source Inspector & AI Debug Proxy.
 *
 * Provides endpoints for reading source code context around errors
 * and parsing stack traces into structured, linkable frames.
 *
 * POST /__studio/api/debug/source    — Read source file lines around a target line
 * POST /__studio/api/debug/frames    — Parse a raw stack trace into structured frames
 */
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, relative, resolve } from 'node:path';
import { sendJson } from '../server/http-server';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SourceFrame {
  file: string;
  relativePath: string;
  line: number;
  column?: number;
  functionName: string;
  isInternal: boolean;
  isNodeModule: boolean;
}

export interface SourceContext {
  file: string;
  targetLine: number;
  startLine: number;
  endLine: number;
  lines: Array<{ num: number; text: string; isTarget: boolean }>;
}

// ── Stack Trace Parser ───────────────────────────────────────────────────────

const STACK_FRAME_REGEX =
  /at\s+(?:(?:new\s+)?([^\s()]+)\s+)?\(?(.*?):(\d+)(?::(\d+))?\)?$/;

export function parseStackTrace(stack: string): SourceFrame[] {
  const cwd = process.cwd();
  const lines = stack.split('\n');
  const frames: SourceFrame[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = STACK_FRAME_REGEX.exec(trimmed);
    if (!match) continue;

    const functionName = match[1] || '(anonymous)';
    let filePath = match[2];
    const lineNum = parseInt(match[3], 10);
    const colNum = match[4] ? parseInt(match[4], 10) : undefined;

    // Strip file:// prefix
    if (filePath.startsWith('file://')) {
      filePath = filePath.substring(7);
    }

    const isNodeModule = filePath.includes('node_modules');
    const isInternal =
      filePath.includes('node:') ||
      filePath.includes('node:internal') ||
      filePath.includes('packages/cli/src/studio/') ||
      (!isAbsolute(filePath) && !filePath.startsWith('.'));

    const relativePath = isAbsolute(filePath)
      ? relative(cwd, filePath)
      : filePath;

    frames.push({
      file: filePath,
      relativePath,
      line: lineNum,
      column: colNum,
      functionName,
      isInternal,
      isNodeModule,
    });
  }

  return frames;
}

// ── Source Reader ─────────────────────────────────────────────────────────────

export async function readSourceContext(
  filePath: string,
  targetLine: number,
  contextLines: number = 10,
): Promise<SourceContext | null> {
  try {
    const absPath = isAbsolute(filePath)
      ? filePath
      : resolve(process.cwd(), filePath);

    // Security: only read files within the project directory
    const cwd = process.cwd();
    const resolved = resolve(absPath);
    if (!resolved.startsWith(cwd) && !resolved.includes('node_modules')) {
      return null;
    }

    const content = await readFile(resolved, 'utf-8');
    const allLines = content.split('\n');
    const startLine = Math.max(1, targetLine - contextLines);
    const endLine = Math.min(allLines.length, targetLine + contextLines);

    const lines: Array<{ num: number; text: string; isTarget: boolean }> = [];
    for (let i = startLine; i <= endLine; i++) {
      lines.push({
        num: i,
        text: allLines[i - 1] || '',
        isTarget: i === targetLine,
      });
    }

    return { file: resolved, targetLine, startLine, endLine, lines };
  } catch {
    return null;
  }
}

// ── HTTP Handlers ────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', () => resolve(''));
  });
}

export async function handlePostDebugSource(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw);
    const { file, line, context } = body;

    if (!file || !line) {
      sendJson(res, { error: 'Missing file or line parameter' }, 400);
      return;
    }

    const result = await readSourceContext(file, line, context || 10);
    if (!result) {
      sendJson(res, { error: 'Unable to read source file', file }, 404);
      return;
    }

    sendJson(res, result);
  } catch (err: any) {
    sendJson(res, { error: err.message || 'Failed to read source' }, 500);
  }
}

export async function handlePostDebugFrames(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw);
    const { stack } = body;

    if (!stack) {
      sendJson(res, { error: 'Missing stack parameter' }, 400);
      return;
    }

    const frames = parseStackTrace(stack);
    sendJson(res, { frames });
  } catch (err: any) {
    sendJson(res, { error: err.message || 'Failed to parse stack trace' }, 500);
  }
}
