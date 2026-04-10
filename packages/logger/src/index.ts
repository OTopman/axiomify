import { Axiomify } from '@axiomify/core';
import { Maskify } from 'maskify-ts';

declare module '@axiomify/core' {
  interface RequestState {
    startTime?: bigint;
  }
}

export function useLogger(app: Axiomify) {
  const log = (level: string, message: string, data: any) => {
    console.log(
      JSON.stringify({
        level,
        timestamp: new Date().toISOString(),
        message,
        ...Maskify.autoMask(data, {
          sensitiveKeys: [],
          maskChar: '*',
          visibleStart: 0,
          visibleEnd: 2,
        }),
      }),
    );
  };

  app.addHook('onRequest', (req, res) => {
    req.state.startTime = process.hrtime.bigint();
    log('info', 'Incoming Request', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      ip: req.ip,
      headers: req.headers,
    });
  });

  app.addHook('onPreHandler', (req, res) => {
    const originalSend = res.send.bind(res);
    res.send = (data: any, message?: string) => {
      const endTime = process.hrtime.bigint();
      const durationMs = req.state.startTime
        ? Number(endTime - req.state.startTime) / 1_000_000
        : 0;
      log('info', 'Outgoing Response', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        durationMs: durationMs.toFixed(3),
        responseMessage: message,
        payload: data,
      });
      return originalSend(data, message);
    };
  });
}
