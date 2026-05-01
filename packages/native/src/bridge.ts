import type { AxiomifyRequest, AxiomifyResponse } from '@axiomify/core';

export function createNodeReqPolyfill(req: AxiomifyRequest) {
  return {
    headers: req.headers,
    method: req.method,
    url: req.url,
    originalUrl: req.url,
    ip: req.ip,
    socket: { remoteAddress: req.ip },
    connection: { remoteAddress: req.ip },
    on: (event: string, callback: any) => {
      // Stream stub for standard middleware compatibility
      if (event === 'data' && req.body) {
        callback(Buffer.from(JSON.stringify(req.body)));
      }
      if (event === 'end') {
        callback();
      }
    },
  };
}

export function createNodeResPolyfill(res: AxiomifyResponse) {
  return {
    get statusCode() {
      return res.statusCode;
    },
    set statusCode(code: number) {
      res.status(code);
    },

    setHeader(name: string, value: string | string[]) {
      if (Array.isArray(value)) {
        res.header(name, value.join(', '));
      } else {
        res.header(name, value);
      }
      return this;
    },

    getHeader(name: string) {
      // In a full implementation, you'd track this in AxiomifyResponse
      return undefined;
    },

    removeHeader(name: string) {
      res.removeHeader(name);
      return this;
    },

    end(chunk?: any) {
      res.sendRaw(chunk || '');
      return this;
    },

    write(chunk: any) {
      throw new Error(
        'Chunked encoding via res.write() is not supported in the Native Bridge yet.',
      );
    },
  };
}

// The Universal Wrapper
export function adaptMiddleware(middleware: Function) {
  return async (req: AxiomifyRequest, res: AxiomifyResponse) => {
    return new Promise<void>((resolve, reject) => {
      const nodeReq = createNodeReqPolyfill(req);
      const nodeRes = createNodeResPolyfill(res);

      try {
        middleware(nodeReq, nodeRes, (err?: any) => {
          if (err) return reject(err);
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  };
}
