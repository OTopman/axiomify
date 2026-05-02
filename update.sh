 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/packages/ws/src/index.ts b/packages/ws/src/index.ts
index 0347e3a7369c223e7e3b82c30ba91b91f298ad4c..cc334874fb73756eb184bc96419609350d4bb670 100644
--- a/packages/ws/src/index.ts
+++ b/packages/ws/src/index.ts
@@ -1,38 +1,31 @@
-import { Axiomify } from '@axiomify/core';
+import type { Axiomify } from '@axiomify/core';
 import crypto from 'crypto';
 import type { IncomingMessage, Server } from 'http';
 import { WebSocket, WebSocketServer } from 'ws';
 import type { ZodTypeAny } from 'zod';
 
-// Make the WsManager type-safe on the Axiomify instance.
-declare module '@axiomify/core' {
-  interface Axiomify {
-    ws?: WsManager<unknown>;
-  }
-}
-
 export interface WsClient<TUser = unknown> extends WebSocket {
   id: string;
   rooms: Set<string>;
   user?: TUser;
   _lastPong: number;
 }
 
 export interface WsOptions<TUser = unknown> {
   server: Server;
   path?: string;
   heartbeatIntervalMs?: number;
   maxMessageBytes?: number;
   /**
    * Maximum number of simultaneous WebSocket connections.
    * Upgrade requests beyond this limit are rejected with 503.
    * Default: 10_000. Set higher for large deployments, or Infinity explicitly to disable.
    */
   maxConnections?: number;
   /**
    * Maximum queued outbound bytes before broadcasts to a client are skipped.
    * Prevents slow consumers from growing memory without bound.
    */
   maxBufferedBytes?: number;
   authenticate?: (req: IncomingMessage) => Promise<TUser | null>;
   onBinary?: (client: WsClient<TUser>, data: Buffer) => void;
@@ -235,28 +228,44 @@ export class WsManager<TUser = unknown> {
   public close(): void {
     if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
     this.wss.close();
   }
 }
 
 export function useWebSockets<TUser = unknown>(app: Axiomify, options: WsOptions<TUser>): void {
   if (!options.server) {
     console.warn(
       '[axiomify/ws] No server provided. WebSocket upgrade listeners will not be attached.',
     );
   }
 
   if (
     options.maxConnections === undefined &&
     process.env.NODE_ENV === 'production'
   ) {
     console.warn(
       '[axiomify/ws] No `maxConnections` limit set. ' +
         'Defaulting to 10000 in production. Set an explicit value appropriate ' +
         'for your available memory.',
     );
   }
 
   const manager = new WsManager<TUser>(options);
-  // Type-safe assignment via module augmentation (no `as any` cast).
-  (app as any).ws = manager;
+  setWsManager(app, manager);
+}
+
+const WS_MANAGER_KEY = Symbol.for('axiomify.ws.manager');
+
+export function setWsManager<TUser = unknown>(
+  app: Axiomify,
+  manager: WsManager<TUser>,
+): void {
+  (app as unknown as Record<symbol, unknown>)[WS_MANAGER_KEY] = manager;
+}
+
+export function getWsManager<TUser = unknown>(
+  app: Axiomify,
+): WsManager<TUser> | undefined {
+  return (app as unknown as Record<symbol, unknown>)[
+    WS_MANAGER_KEY
+  ] as WsManager<TUser> | undefined;
 }
 
EOF
)