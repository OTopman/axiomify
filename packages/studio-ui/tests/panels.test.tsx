import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Logs } from '../src/components/Logs';
import { EventsPanel, PerformancePanel } from '../src/components/OtherPanels';
import { ProfilerPanel } from '../src/components/ProfilerPanel';
import { Recorder } from '../src/components/Recorder';
import { SecurityPanel } from '../src/components/SecurityPanel';
import { TracingPanel } from '../src/components/Tracing';
import { WebSocketTester } from '../src/components/WebSocketTester';

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

  it('renders the profiler empty state and controls', () => {
    const markup = renderToStaticMarkup(<ProfilerPanel />);
    expect(markup).toContain('Execution Profiler');
    expect(markup).toContain('Clear Profiler');
    expect(markup).toContain('No execution traces captured');
  });

  it('renders WebSocketTester with connection controls and discovery routes', () => {
    const markup = renderToStaticMarkup(
      <WebSocketTester
        discovery={
          {
            routes: [
              {
                method: 'GET',
                path: '/ws/chat',
                isWs: true,
                schema: {},
              },
            ],
          } as any
        }
      />,
    );
    expect(markup).toContain('WS Routes');
    expect(markup).toContain('Composer');
    expect(markup).toContain('Traffic');
  });

  it('renders Recorder panel and traffic capture controls', () => {
    const markup = renderToStaticMarkup(<Recorder />);
    expect(markup).toContain('Session Recorder');
  });

  it('renders TracingPanel and distributed trace search filter', () => {
    const markup = renderToStaticMarkup(<TracingPanel />);
    expect(markup).toContain('Distributed Tracing &amp; Waterfall');
    expect(markup).toContain('Errors Only');
  });

  it('renders Logs panel with stream controls and log level filters', () => {
    const markup = renderToStaticMarkup(
      <Logs filterRequestId={null} onClearFilter={() => {}} />,
    );
    expect(markup).toContain('Logs Observatory');
    expect(markup).toContain('Search logs...');
  });

  it('renders SecurityPanel with vulnerability auditing overview', () => {
    const markup = renderToStaticMarkup(
      <SecurityPanel discovery={{ routes: [] } as any} />,
    );
    expect(markup).toContain('Security Center');
    expect(markup).toContain('Static and dynamic security validation tests');
  });
});
