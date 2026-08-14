import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { instrumentEventRecording } from '../../src/studio/api/events';
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
});
