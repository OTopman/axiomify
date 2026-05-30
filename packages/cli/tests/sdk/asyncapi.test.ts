import { describe, expect, it } from 'vitest';
import { CompilerPipeline } from '../../src/sdk/compiler/pipeline';
import { TsClientEmitter } from '../../src/sdk/generator/targets/typescript/client-emitter';
import { ingestAsyncApi } from '../../src/sdk/ingest/asyncapi';

describe('AsyncAPI Ingestion & Client Generation', () => {
  it('should ingest a valid AsyncAPI spec and compile into event IR', async () => {
    const rawAsyncApi = {
      asyncapi: '2.4.0',
      info: { title: 'Chat Room API', version: '1.0.0' },
      channels: {
        '/rooms/{roomId}': {
          parameters: {
            roomId: {
              description: 'The ID of the room',
              schema: { type: 'string' }
            }
          },
          publish: {
            operationId: 'sendChatMessage',
            message: {
              name: 'ChatMessage',
              payload: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  sender: { type: 'string' }
                },
                required: ['text', 'sender']
              }
            }
          },
          subscribe: {
            operationId: 'onChatMessage',
            message: {
              name: 'ChatMessage',
              payload: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  sender: { type: 'string' },
                  timestamp: { type: 'number' }
                },
                required: ['text', 'sender', 'timestamp']
              }
            }
          }
        }
      }
    };

    // 1. Ingest
    const ingestResult = ingestAsyncApi(rawAsyncApi, {});
    expect(ingestResult.diagnostics).toHaveLength(0);
    expect(ingestResult.schema.info.title).toBe('Chat Room API');
    expect(ingestResult.schema.info.version).toBe('1.0.0');

    // 2. Compile (runs normalizer/promoter)
    const pipeline = new CompilerPipeline();
    const compileResult = await pipeline.compile(ingestResult.schema);
    expect(compileResult.hasErrors).toBe(false);

    // Verify promoted types in schema
    const types = compileResult.schema.types;
    expect(types.has('SendChatMessagePayload')).toBe(true);
    expect(types.has('OnChatMessagePayload')).toBe(true);

    const sendType = types.get('SendChatMessagePayload')!;
    expect(sendType.kind).toBe('object');
    if (sendType.kind === 'object') {
      expect(sendType.fields.map(f => f.name)).toContain('text');
      expect(sendType.fields.map(f => f.name)).toContain('sender');
    }

    // Verify event contracts in schema
    const events = compileResult.schema.events;
    expect(events).toHaveLength(2);

    const sendEvent = events.find(e => e.name === 'sendChatMessage')!;
    expect(sendEvent).toBeDefined();
    expect(sendEvent.direction).toBe('outbound');
    expect(sendEvent.channel).toBe('/rooms/{roomId}');
    expect(sendEvent.payload?.ref).toBe('SendChatMessagePayload');

    const recvEvent = events.find(e => e.name === 'onChatMessage')!;
    expect(recvEvent).toBeDefined();
    expect(recvEvent.direction).toBe('inbound');
    expect(recvEvent.channel).toBe('/rooms/{roomId}');
    expect(recvEvent.payload?.ref).toBe('OnChatMessagePayload');

    // 3. Emit Code
    const clientEmitter = new TsClientEmitter(compileResult.schema, 'ApiClient');
    const clientCode = clientEmitter.emitAll();

    // Verify generated ApiClient factory method
    expect(clientCode).toContain('public roomsRoomId(params: { roomId: string }, options?: WebSocketClientOptions): RoomsRoomIdChannelClient');
    expect(clientCode).toContain('const wsBase = this.config.baseUrl.replace(/^http/, \'ws\');');
    expect(clientCode).toContain('return new RoomsRoomIdChannelClient(`\${wsBase}/rooms/${params.roomId}`, options);');

    // Verify generated ChannelClient class
    expect(clientCode).toContain('export class RoomsRoomIdChannelClient {');
    expect(clientCode).toContain('private ws: WebSocketClient;');
    expect(clientCode).toContain('onMessage: (data: string) => {');

    // Verify event methods
    expect(clientCode).toContain('public onOnChatMessage(callback: (payload: Types.OnChatMessagePayload) => void): () => void');
    expect(clientCode).toContain('public sendSendChatMessage(payload: Types.SendChatMessagePayload): void');
    expect(clientCode).toContain('event: \'sendChatMessage\'');
  });
});
