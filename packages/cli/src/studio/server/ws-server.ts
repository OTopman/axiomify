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

    socket.on('close', () => {
      this.sockets.delete(socket);
    });

    socket.on('error', () => {
      this.sockets.delete(socket);
      socket.destroy();
    });

    // Consume incoming data to avoid buffering, but ignore client messages
    // as Studio communication is strictly server -> client (push model).
    socket.on('data', () => {});
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
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
  }
}
