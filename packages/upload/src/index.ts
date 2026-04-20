import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  UploadedFile,
} from '@axiomify/core';
import Busboy from 'busboy';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';

// 🚀 2. Inject it into the Core Request
declare module '@axiomify/core' {
  interface AxiomifyRequest<Body, Query, Params> {
    files?: Record<string, UploadedFile>;
  }
}

/**
 * Strips path separators and parent-directory segments from a user-supplied
 * filename so it can be safely joined with the upload directory. Returns a
 * leaf-name only — never a path.
 *
 * Defends against Busboy filenames like `../../etc/cron.d/pwn` which,
 * path.join'd with `autoSaveTo`, would otherwise escape the upload root.
 */
function sanitizeFilename(name: string): string {
  // Basename strips POSIX separators. Windows backslashes aren't separators
  // on POSIX, so handle them explicitly.
  const leaf = path.basename(name).replace(/\\/g, '_');
  // Reject anything that still looks like traversal or a hidden control char.
  const cleaned = leaf
    .replace(/^\.+/, '') // no leading dots (.., ., .hidden)
    .replace(/\0/g, '') // drop NUL
    .trim();
  // Final fallback for edge cases (empty name, name that was only dots).
  return cleaned || `upload-${Date.now()}`;
}

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
                throw new Error(`Invalid or unexpected file: ${fieldname}`);
              }

              // Always sanitize the user-supplied filename before use. If the
              // caller provides a `rename`, run it on the sanitized original
              // and sanitize its output too — a custom `rename` shouldn't be
              // able to escape the upload root either.
              const safeOriginal = sanitizeFilename(info.filename);
              let finalName = safeOriginal;
              if (config.rename) {
                const renamed = await config.rename(
                  safeOriginal,
                  info.mimeType,
                );
                finalName = sanitizeFilename(renamed);
              }

              if (!existsSync(config.autoSaveTo))
                mkdirSync(config.autoSaveTo, { recursive: true });

              // Defense in depth: after join, confirm the resolved path is
              // still inside autoSaveTo. sanitizeFilename should already
              // guarantee this, but the check costs nothing.
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

              // Register the file early so the cleanup hook can find it if we abort!
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
                      `File ${fieldname} exceeds limit of ${config.maxSize} bytes`,
                    ),
                  );
                }
              });

              await pipeline(file, createWriteStream(savePath));

              // Update the final size
              mutableReq.files[fieldname].size = byteCount;
            } catch (err) {
              file.resume(); // drain buffer
              if (savePath) await unlink(savePath).catch(() => {}); // Delete partial file

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
            /* already rejected via safeReject, avoid uncaught promise rejection */
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
        for (const key of Object.keys(req.files)) {
          const file = req.files[key];
          if (existsSync(file.path)) {
            await unlink(file.path).catch(() => {}); // Clean up orphaned files
          }
        }
      }
    },
  );
}
