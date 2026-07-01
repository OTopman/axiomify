import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  UploadedFile,
} from '@axiomify/core';
import Busboy from 'busboy';
import { createWriteStream } from 'fs';
import { randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';

declare module '@axiomify/core' {
  interface AxiomifyRequest<Body, Query, Params> {
    files?: Record<string, UploadedFile>;
    uploadedFiles: string[];
    cleanup(): Promise<void>;
  }
}

/**
 * Strips path separators and parent-directory segments from a user-supplied
 * filename so it can be safely joined with the upload directory.
 */
function sanitizeFilename(name: string): string {
  const leaf = path.basename(name).replace(/\\/g, '_');
  const cleaned = leaf.replace(/^\.+/, '').replace(/\0/g, '').trim();
  return cleaned || `upload-${Date.now()}`;
}

/**
 * Creates the upload directory if it does not exist.
 * Uses `mkdir({ recursive: true })` atomically — no TOCTOU race.
 */
async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

function createGeneratedFilename(originalName: string): string {
  const safeOriginal = sanitizeFilename(originalName);
  const ext = path.extname(safeOriginal).toLowerCase();
  return `${randomUUID()}${ext}`;
}

async function readFileHead(filePath: string): Promise<Buffer> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4100);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function detectMime(buffer: Buffer): string | undefined {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
    buffer.subarray(0, 6).toString('ascii') === 'GIF89a'
  ) {
    return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  ) {
    return 'application/zip';
  }
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return 'application/gzip';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).toString('ascii') === 'ftyp'
  ) {
    return 'video/mp4';
  }

  const asText = buffer.subarray(0, 512).toString('utf8').trimStart();
  if (/^<\?xml[\s\S]*<svg[\s>]/i.test(asText) || /^<svg[\s>]/i.test(asText)) {
    return 'image/svg+xml';
  }

  return undefined;
}

const SNIFFABLE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/zip',
  'application/gzip',
  'video/mp4',
]);

function isSniffableAccept(accept: string): boolean {
  const normalized = accept.toLowerCase();
  if (SNIFFABLE_MIME_TYPES.has(normalized)) return true;
  if (!normalized.endsWith('/*')) return false;
  const prefix = normalized.slice(0, -1);
  return Array.from(SNIFFABLE_MIME_TYPES).some((mime) =>
    mime.startsWith(prefix),
  );
}

function mimeMatches(detected: string, accept: string[]): boolean {
  const normalizedDetected = detected.toLowerCase();
  return accept.some((entry) => {
    const normalized = entry.toLowerCase();
    if (normalized.endsWith('/*')) {
      // Scriptable SVG must never be admitted by a generic wildcard (e.g.
      // `image/*`) — it can carry stored XSS. It is accepted only when
      // explicitly listed as `image/svg+xml` (handled by the exact match below).
      if (normalizedDetected === 'image/svg+xml') return false;
      return normalizedDetected.startsWith(normalized.slice(0, -1));
    }
    return normalizedDetected === normalized;
  });
}

async function validateFileContent(
  filePath: string,
  accept: string[],
): Promise<void> {
  // Always sniff — never trust the client-declared MIME/Content-Type. Types
  // such as application/octet-stream, text/csv or unknown types would
  // otherwise skip magic-byte inspection and be admitted on attacker input.
  const detected = detectMime(await readFileHead(filePath));

  // Content whose type we can positively detect must be consistent with an
  // accepted type; mismatches (e.g. a script disguised as image/png) reject.
  if (detected) {
    if (!mimeMatches(detected, accept)) {
      throw new Error(
        `File content does not match accepted types: ${accept.join(', ')}`,
      );
    }
    return;
  }

  // Undetectable content: fail closed by default. Only accept it when the
  // route explicitly opts into a non-sniffable accept rule (e.g. text/csv,
  // application/octet-stream). Routes that intend to permit arbitrary/opaque
  // uploads can bypass this check entirely via `validateContent: false`.
  const routeAcceptsNonSniffable = accept.some((entry) => {
    const normalized = entry.toLowerCase();
    if (normalized.endsWith('/*')) return !isSniffableAccept(normalized);
    return !SNIFFABLE_MIME_TYPES.has(normalized);
  });
  if (!routeAcceptsNonSniffable) {
    throw new Error(
      `File content does not match accepted types: ${accept.join(', ')}`,
    );
  }
}

/**
 * Validates multipart part MIME headers as a fast pre-check, then verifies the
 * saved file's magic bytes for known content types before route handlers run.
 */
export function useUpload(
  app: Axiomify,
  options: { autoCleanup?: boolean } = {},
): void {
  app.addHook(
    'onPreHandler',
    async (req: AxiomifyRequest, _res: AxiomifyResponse, match: any) => {
      const fileSchema = match?.route?.schema?.files;
      /* v8 ignore next -- multipart processing requires real Busboy stream */
      const contentType = req.headers['content-type'] || '';

      if (!fileSchema || !contentType.includes('multipart/form-data')) return;

      const mutableReq = req as any;
      if (!mutableReq.uploadedFiles) {
        mutableReq.uploadedFiles = [];
      }
      if (!mutableReq.cleanup) {
        mutableReq.cleanup = async () => {
          if (mutableReq.uploadedFiles.length > 0) {
            await Promise.allSettled(
              mutableReq.uploadedFiles.map((p: string) =>
                unlink(p).catch(() => {}),
              ),
            );
            mutableReq.uploadedFiles = [];
          }
        };
      }

      if (!mutableReq.body) mutableReq.body = {};
      mutableReq.files = {};

      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const safeResolve = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        const safeReject = (err: unknown) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        };

        const totalFileLimit = Object.values(fileSchema).reduce(
          (sum: number, config: any) => sum + (config.maxFiles ?? 1),
          0,
        );
        // Busboy's `fileSize` is a single stream-wide ceiling applied to every
        // file, so it can only be the largest per-field limit and cannot
        // enforce a smaller field's limit on its own. The authoritative
        // per-field limit is enforced by the byte counter in the `data`
        // handler below, which aborts (and unlinks) the moment a field's own
        // `config.maxSize` is exceeded — bounding any overshoot to a single
        // chunk. The Busboy ceiling is kept as a coarse backstop.
        const maxFileSize = Math.max(
          ...Object.values(fileSchema).map((config: any) => config.maxSize),
        );
        const fileCounts = new Map<string, number>();
        const busboy = Busboy({
          headers: req.headers,
          limits: {
            files: totalFileLimit,
            fileSize: maxFileSize,
            fields: 100,
            fieldSize: 64 * 1024,
          },
        });
        const fileWrites: Promise<void>[] = [];

        busboy.on('file', (fieldname, file, info) => {
          const writeTask = (async () => {
            let savePath = '';
            try {
              const config = fileSchema[fieldname];
              if (!config || !mimeMatches(info.mimeType, config.accept)) {
                file.resume();
                throw new Error(
                  `Invalid or unexpected file field "${fieldname}" ` +
                    `(reported MIME: ${info.mimeType})`,
                );
              }

              const safeOriginal = sanitizeFilename(info.filename);
              let finalName = safeOriginal;
              if (config.rename) {
                const renamed = await config.rename(
                  safeOriginal,
                  info.mimeType,
                );
                finalName = sanitizeFilename(renamed);
              } else if (!config.preserveOriginalName) {
                finalName = createGeneratedFilename(safeOriginal);
              }

              const currentCount = (fileCounts.get(fieldname) ?? 0) + 1;
              fileCounts.set(fieldname, currentCount);
              if (currentCount > (config.maxFiles ?? 1)) {
                file.resume();
                throw new Error(
                  `Too many files for field "${fieldname}". Maximum is ${
                    config.maxFiles ?? 1
                  }.`,
                );
              }

              // Atomic directory creation — no TOCTOU race between exists-check and mkdir.
              await ensureDir(config.autoSaveTo);

              savePath = path.join(config.autoSaveTo, finalName);
              const rootResolved = path.resolve(config.autoSaveTo);
              const savePathResolved = path.resolve(savePath);
              if (
                !savePathResolved.startsWith(rootResolved + path.sep) &&
                savePathResolved !== rootResolved
              ) {
                throw new Error(
                  `Refusing to write "${finalName}" outside of "${config.autoSaveTo}"`,
                );
              }

              let byteCount = 0;

              mutableReq.files[fieldname] = {
                originalName: info.filename,
                savedName: finalName,
                path: savePath,
                size: 0,
                mimetype: info.mimeType,
              };

              // Authoritative per-field size enforcement: abort as soon as the
              // field's own limit is crossed (the catch block unlinks the
              // partial file). This is what actually caps a small-limit field,
              // independent of Busboy's stream-wide `fileSize` ceiling.
              file.on('data', (data) => {
                byteCount += data.length;
                if (byteCount > config.maxSize) {
                  file.destroy(
                    new Error(
                      `File "${fieldname}" exceeds limit of ${config.maxSize} bytes`,
                    ),
                  );
                }
              });

              await pipeline(
                file,
                createWriteStream(savePath, { flags: 'wx' }),
              );
              mutableReq.files[fieldname].size = byteCount;
              mutableReq.uploadedFiles.push(savePath);

              if (config.validateContent !== false) {
                await validateFileContent(savePath, config.accept);
              }
            } catch (err) {
              file.resume();
              if (savePath) {
                const idx = mutableReq.uploadedFiles.indexOf(savePath);
                if (idx !== -1) mutableReq.uploadedFiles.splice(idx, 1);
                await unlink(savePath).catch(() => {});
              }
              safeReject(err);
            }
          })();

          fileWrites.push(writeTask);
        });

        busboy.on('field', (name, val) => {
          mutableReq.body[name] = val;
        });

        busboy.on('finish', async () => {
          try {
            await Promise.all(fileWrites);
          } catch {
            /* already rejected via safeReject */
          }
          safeResolve();
        });

        busboy.on('error', (err) => safeReject(err));
        busboy.on('filesLimit', () =>
          safeReject(new Error('Too many uploaded files')),
        );
        busboy.on('fieldsLimit', () =>
          safeReject(new Error('Too many multipart fields')),
        );
        req.stream.pipe(busboy);
      });
    },
  );

  if (options.autoCleanup) {
    app.addHook('onPostHandler', async (req: AxiomifyRequest) => {
      if (req.cleanup) {
        await req.cleanup();
      }
    });
  }

  app.addHook(
    'onError',
    async (err: any, req: AxiomifyRequest, _res: AxiomifyResponse) => {
      if (req.cleanup) {
        await req.cleanup();
      }
      if (req.files) {
        await Promise.allSettled(
          Object.values(req.files).map((file) =>
            unlink(file.path).catch(() => {}),
          ),
        );
      }
    },
  );
}
