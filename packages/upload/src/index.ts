// packages/upload/src/index.ts
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
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

// 🚀 2. Inject it into the Core Request
declare module '@axiomify/core' {
  interface AxiomifyRequest<Body, Query, Params> {
    files?: Record<string, UploadedFile>;
  }
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

      await new Promise<void>((resolve, reject) => {
        const busboy = Busboy({ headers: req.headers as any });
        const fileWrites: Promise<void>[] = [];

        busboy.on('file', (fieldname, file, info) => {
          const writeTask = (async () => {
            try {
              const config = fileSchema[fieldname];
              if (!config || !config.accept.includes(info.mimeType)) {
                throw new Error(`Invalid or unexpected file: ${fieldname}`);
              }

              let finalName = info.filename;
              if (config.rename)
                finalName = await config.rename(info.filename, info.mimeType);

              if (!existsSync(config.autoSaveTo))
                mkdirSync(config.autoSaveTo, { recursive: true });

              const savePath = path.join(config.autoSaveTo, finalName);
              let byteCount = 0;

              // 🚀 THE FIX: Register the file early so the cleanup hook can find it if we abort!
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

              // 🚀 THE FIX: Destroy the underlying TCP socket to prevent memory bombs
              const rawSocket =
                (req.raw as any).socket || (req.raw as any).connection;
              if (rawSocket && typeof rawSocket.destroy === 'function') {
                rawSocket.destroy();
              }

              reject(err);
            }
          })();

          fileWrites.push(writeTask);
        });

        busboy.on('field', (name, val) => {
          mutableReq.body[name] = val;
        });

        busboy.on('finish', async () => {
          await Promise.all(fileWrites);
          resolve();
        });

        busboy.on('error', reject);
        (req.raw as Readable).pipe(busboy);
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
