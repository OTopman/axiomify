import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sendJson } from '../server/http-server';

export interface StudioPrivacyOptions {
  /** Record request/response bodies after key-based redaction. */
  includeBodies: boolean;
  /** Additional case-insensitive field names to redact. */
  sensitiveKeys: string[];
}

const DEFAULT_SENSITIVE_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'secret',
  'token',
  'api-key',
  'apikey',
  'x-api-key',
  'credit_card',
  'ssn',
];

let options: StudioPrivacyOptions = {
  includeBodies: true,
  sensitiveKeys: [],
};

function sensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return [
    ...DEFAULT_SENSITIVE_KEYS,
    ...options.sensitiveKeys.map((v) => v.toLowerCase()),
  ].some((needle) => lower === needle || lower.includes(needle));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Redact secret-looking values embedded in error messages, stacks, or query text. */
export function redactTextForStudio(value: unknown): string {
  let text = String(value ?? '');
  const keys = [...DEFAULT_SENSITIVE_KEYS, ...options.sensitiveKeys]
    .filter(Boolean)
    .map(escapeRegex)
    .join('|');
  if (!keys) return text;

  const assignment = new RegExp(
    `(\\b(?:${keys})\\b\\s*[:=]\\s*)(["']?)([^\\s,;"'\\]}\\)]+)\\2`,
    'gi',
  );
  text = text.replace(assignment, '$1••••••••');
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ••••••••');
  const queryValue = new RegExp(`([?&](?:${keys})=)[^&#\\s]+`, 'gi');
  return text.replace(queryValue, '$1••••••••');
}

/** Redact objects recursively before they enter Studio's in-memory recorder. */
export function redactForStudio(
  value: unknown,
  key = '',
  seen = new WeakSet<object>(),
): unknown {
  if (key && sensitiveKey(key)) return '••••••••';
  if (Array.isArray(value))
    return value.map((item) => redactForStudio(item, '', seen));
  if (value && typeof value === 'object') {
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([entryKey, entryValue]) => [
          entryKey,
          redactForStudio(entryValue, entryKey, seen),
        ],
      ),
    );
  }
  return value;
}

export function sanitizeRecordedBody(value: unknown): unknown {
  return options.includeBodies
    ? redactForStudio(value)
    : '[Body recording disabled]';
}

export function sanitizeRecordedHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      sensitiveKey(key)
        ? '••••••••'
        : Array.isArray(value)
          ? value.join(', ')
          : (value ?? ''),
    ]),
  );
}

export function getStudioPrivacyOptions(): StudioPrivacyOptions {
  return { ...options, sensitiveKeys: [...options.sensitiveKeys] };
}

export function setStudioPrivacyOptions(
  next: Partial<StudioPrivacyOptions>,
): StudioPrivacyOptions {
  options = {
    includeBodies: next.includeBodies ?? options.includeBodies,
    sensitiveKeys: next.sensitiveKeys
      ? next.sensitiveKeys.filter(
          (value) => typeof value === 'string' && value.trim().length > 0,
        )
      : options.sensitiveKeys,
  };
  return getStudioPrivacyOptions();
}

export function handleGetPrivacy(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  sendJson(res, getStudioPrivacyOptions());
}

export async function handlePostPrivacy(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const payload = JSON.parse(
      await readBody(req),
    ) as Partial<StudioPrivacyOptions>;
    if (
      payload.sensitiveKeys !== undefined &&
      !Array.isArray(payload.sensitiveKeys)
    ) {
      sendJson(
        res,
        { error: 'sensitiveKeys must be an array of strings' },
        400,
      );
      return;
    }
    sendJson(res, setStudioPrivacyOptions(payload));
  } catch {
    sendJson(res, { error: 'Invalid JSON privacy configuration' }, 400);
  }
}
