 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/packages/express/src/index.ts b/packages/express/src/index.ts
index 0bdc3f20884bff53bc2f18dfec9365a9c01b105c..266b0ab0dee002671e2fdfab69efb5fa1132d03c 100644
--- a/packages/express/src/index.ts
+++ b/packages/express/src/index.ts
@@ -68,53 +68,77 @@ export class ExpressAdapter {
         if (res.headersSent) return next(err);
         const statusCode =
           typeof err?.statusCode === 'number'
             ? err.statusCode
             : typeof err?.status === 'number'
               ? err.status
               : 500;
         const message =
           statusCode === 413
             ? 'Payload Too Large'
             : statusCode === 400
               ? 'Bad Request'
               : 'Internal Server Error';
         const axiomifyReq = translateRequest(req);
         const payload = this.core.serializer(
           null,
           message,
           statusCode,
           true,
           axiomifyReq,
         );
         res.status(statusCode).json(payload);
       },
     );
 
+    for (const route of this.core.registeredRoutes) {
+      this.app[route.method.toLowerCase() as 'get'](
+        route.path,
+        async (req: Request, res: Response) => {
+          const axiomifyReq = translateRequest(req);
+          const axiomifyRes = translateResponse(
+            res,
+            this.core.serializer,
+            axiomifyReq,
+          );
+          await this.core.handleMatchedRoute(
+            axiomifyReq,
+            axiomifyRes,
+            route,
+            req.params as Record<string, string>,
+          );
+        },
+      );
+    }
+
     this.app.all('*', async (req: Request, res: Response) => {
       const axiomifyReq = translateRequest(req);
       const axiomifyRes = translateResponse(
         res,
         this.core.serializer,
         axiomifyReq,
       );
-
-      await this.core.handle(axiomifyReq, axiomifyRes);
+      const match = this.core.router.lookup(req.method as never, req.path);
+      if (match && 'error' in match) {
+        axiomifyRes.header('Allow', match.allowed.join(', '));
+        return axiomifyRes.status(405).send(null, 'Method Not Allowed');
+      }
+      return axiomifyRes.status(404).send(null, 'Route not found');
     });
   }
 
   public listen(port: number, callback?: () => void): Server {
     this.server = this.app.listen(port, callback);
     return this.server;
   }
 
   public async close(): Promise<void> {
     return new Promise((resolve, reject) => {
       if (!this.server) return resolve();
       this.server.close((err) => (err ? reject(err) : resolve()));
     });
   }
 
   public get native(): Express {
     return this.app;
   }
 }
 
EOF
)