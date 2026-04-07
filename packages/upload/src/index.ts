// packages/upload/src/index.ts
import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';
import Busboy from 'busboy';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

export interface UploadedFile {
  originalName: string;
  savedName: string;
  path: string;
  size: number;
  mimetype: string;
}

// 🚀 2. Inject it into the Core Request
declare module '@axiomify/core' {
  interface AxiomifyRequest<Body, Query, Params> {
    files?: Record<string, UploadedFile>;
  }
}

export function useUpload(app: Axiomify): void {
  // We use a 'preHandler' hook so the route is already matched,
  // but the user's handler hasn't executed yet.
  app.addHook(
    'preHandler',
    async (req: AxiomifyRequest, _res: AxiomifyResponse, match: any) => {
      const fileSchema = match?.route?.schema?.files;
      const contentType = req.headers['content-type'] || '';

      if (!fileSchema || !contentType.includes('multipart/form-data')) return;

      const mutableReq = req as any;
      if (!mutableReq.body) mutableReq.body = {};
      mutableReq.files = {};

      await new Promise<void>((resolve, reject) => {
        const busboy = Busboy({ headers: req.headers as any });

        // 🚀 1. The Tracker Array
        const fileWrites: Promise<void>[] = [];

        // ⚠️ Note: Remove 'async' from this callback signature!
        busboy.on('file', (fieldname, file, info) => {
          // 🚀 2. Wrap the background work in a tracked task
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

              // 🚀 3. This now runs safely BEFORE the handler!
              mutableReq.files[fieldname] = {
                originalName: info.filename,
                savedName: finalName,
                path: savePath,
                size: byteCount,
                mimetype: info.mimeType,
              };
            } catch (err) {
              file.resume();
              reject(err); // Instantly abort the main request if a write fails
            }
          })();

          // Add the task to the tracker
          fileWrites.push(writeTask);
        });

        busboy.on('field', (name, val) => {
          mutableReq.body[name] = val;
        });

        // 🚀 4. Wait for the hard drive!
        busboy.on('finish', async () => {
          await Promise.all(fileWrites); // Wait for all pipelines to finish
          resolve(); // NOW it is safe to run the route handler
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
