import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  handleGetEvents,
  instrumentEventRecording,
} from '../../src/studio/api/events';
import { getSessionData } from '../../src/studio/api/recorder';

describe('Studio runtime event recording', () => {
  afterEach(() => {
    getSessionData().events.length = 0;
  });

  it('records emitted service events with a correlated, redacted payload', () => {
    const bus = new EventEmitter();
    instrumentEventRecording({ _services: new Map([['paymentBus', bus]]) });

    bus.emit('payment.completed', { id: 'pay-1', token: 'private' });

    expect(getSessionData().events).toContainEqual(
      expect.objectContaining({
        type: 'paymentBus:payment.completed',
        payload: { id: 'pay-1', token: '••••••••' },
      }),
    );
  });

  it('returns recorded events newest first', () => {
    const bus = new EventEmitter();
    instrumentEventRecording({ _services: new Map([[Symbol('bus'), bus]]) });
    bus.emit('first', 1);
    bus.emit('second', 2, 3);
    let payload: any;
    handleGetEvents(
      {} as any,
      {
        writeHead() {},
        end(body: string) {
          payload = JSON.parse(body);
        },
      } as any,
    );
    expect(payload.events.map((event: any) => event.type)).toEqual([
      'bus:second',
      'bus:first',
    ]);
  });

  it('ignores invalid, non-emitter, and already instrumented services', () => {
    instrumentEventRecording({});
    const bus = new EventEmitter();
    instrumentEventRecording({
      _services: new Map([
        ['empty', null],
        ['plain', {}],
        ['bus', bus],
      ]),
    });
    instrumentEventRecording({ _services: new Map([['bus', bus]]) });
    bus.emit('once');
    expect(
      getSessionData().events.filter((event) => event.type === 'bus:once'),
    ).toHaveLength(1);
  });
});
