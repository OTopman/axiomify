import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/**
 * A minimal, zero-dependency WebSocket server upgrade handler.
 *
 * Implements the RFC 6455 handshake and server-to-client framing,
 * allowing the Studio backend to broadcast live-reload signals
 * to all connected browser tabs.
 */
export class StudioWsServer {
  private sockets = new Set<Duplex>();
  private awaitingPong = new Set<Duplex>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Upgrades an incoming HTTP connection to a WebSocket connection.
   */
  public handleUpgrade(req: IncomingMessage, socket: Duplex): void {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    // Compute the Sec-WebSocket-Accept handshake header.
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n',
    ];

    socket.write(headers.join('\r\n'));
    this.sockets.add(socket);
    this.awaitingPong.delete(socket);
    this.startHeartbeat();

    socket.on('close', () => {
      this.sockets.delete(socket);
      this.awaitingPong.delete(socket);
    });

    socket.on('error', () => {
      this.sockets.delete(socket);
      this.awaitingPong.delete(socket);
      socket.destroy();
    });

    socket.on('data', (chunk: Buffer) => {
      this.handleFrame(socket, chunk);
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(() => {
      const pingFrame = Buffer.from([0x89, 0x00]);
      for (const socket of this.sockets) {
        if (!socket.writable || this.awaitingPong.has(socket)) {
          this.sockets.delete(socket);
          this.awaitingPong.delete(socket);
          socket.destroy();
          continue;
        }

        this.awaitingPong.add(socket);
        socket.write(pingFrame);
      }
    }, 30_000);
    this.heartbeatInterval.unref?.();
  }

  private handleFrame(socket: Duplex, chunk: Buffer): void {
    if (chunk.length < 2) return;

    const opcode = chunk[0] & 0x0f;
    if (opcode === 0x0a) {
      this.awaitingPong.delete(socket);
      return;
    }

    if (opcode === 0x09 && socket.writable) {
      socket.write(Buffer.from([0x8a, 0x00]));
    }
  }

  /**
   * Broadcasts a text message to all connected clients.
   */
  public broadcast(message: string): void {
    const payload = Buffer.from(message, 'utf8');
    const length = payload.length;

    let header: Buffer;
    if (length <= 125) {
      header = Buffer.alloc(2);
      header[0] = 0x81; // FIN set, Opcode 1 (text)
      header[1] = length;
    } else if (length <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    const frame = Buffer.concat([header, payload]);
    for (const socket of this.sockets) {
      if (socket.writable) {
        socket.write(frame);
      }
    }
  }

  /**
   * Closes all active connections.
   */
  public close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    this.awaitingPong.clear();
  }
}
