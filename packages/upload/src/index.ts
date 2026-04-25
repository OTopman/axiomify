import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  UploadedFile,
} from '@axiomify/core';
import Busboy from 'busboy';
import { createWriteStream } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';

declare module '@axiomify/core' {
  interface AxiomifyRequest<Body, Query, Params> {
    files?: Record<string, UploadedFile>;
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

/**
 * ⚠️  MIME TYPE VALIDATION NOTE:
 * The MIME type checked here (`info.mimeType`) comes from the Content-Type
 * header of the multipart part, which the uploader controls entirely.
 * An attacker can upload a PHP or shell script with `Content-Type: image/jpeg`
 * and bypass this check.
 *
 * For production use, validate the actual file content using magic bytes
 * after the upload completes. Install the `file-type` npm package and add:
 *
 *   import { fileTypeFromFile } from 'file-type';
 *   const type = await fileTypeFromFile(savePath);
 *   if (!type || !config.accept.includes(type.mime)) {
 *     await unlink(savePath).catch(() => {});
 *     throw new Error(`File content does not match accepted types`);
 *   }
 */
export function useUpload(app: Axiomify): void {
  app.addHook(
    'onPreHandler',
    async (req: AxiomifyRequest, _res: AxiomifyResponse, match: any) => {
      const fileSchema = match?.route?.schema?.files;
      const contentType = req.headers['content-type'] || '';

      if (!fileSchema || !contentType.includes('multipart/form-data')) return;

      const mutableReq = req as any;
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

        const busboy = Busboy({ headers: req.headers });
        const fileWrites: Promise<void>[] = [];

        busboy.on('file', (fieldname, file, info) => {
          const writeTask = (async () => {
            let savePath = '';
            try {
              const config = fileSchema[fieldname];
              if (!config || !config.accept.includes(info.mimeType)) {
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

              await pipeline(file, createWriteStream(savePath));
              mutableReq.files[fieldname].size = byteCount;

              // ── Magic-byte validation hook point ──────────────────────────
              // If you install `file-type`, add the check here after pipeline
              // completes. See the JSDoc on useUpload for the snippet.
              // ─────────────────────────────────────────────────────────────
            } catch (err) {
              file.resume();
              if (savePath) await unlink(savePath).catch(() => {});

              const rawSocket =
                (req.raw as any).socket || (req.raw as any).connection;
              if (rawSocket && typeof rawSocket.destroy === 'function') {
                rawSocket.destroy();
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
        req.stream.pipe(busboy);
      });
    },
  );

  app.addHook(
    'onError',
    async (err: any, req: AxiomifyRequest, _res: AxiomifyResponse) => {
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
