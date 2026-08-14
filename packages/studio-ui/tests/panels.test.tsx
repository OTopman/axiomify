import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EventsPanel, PerformancePanel } from '../src/components/OtherPanels';

describe('Studio panels', () => {
  it('renders discovered event names and emitters', () => {
    const markup = renderToStaticMarkup(
      <EventsPanel
        discovery={
          {
            events: [
              {
                emitterToken: 'paymentBus',
                event: 'payment.completed',
                listenerCount: 2,
                listeners: [],
              },
            ],
          } as any
        }
      />,
    );
    expect(markup).toContain('payment.completed');
    expect(markup).toContain('from paymentBus');
  });

  it('renders the performance reset control', () => {
    expect(renderToStaticMarkup(<PerformancePanel />)).toContain(
      'Clear performance data',
    );
  });
});
