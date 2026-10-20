import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RouteSelector } from '../src/components/RouteSelector';
import { RouteItem } from '../src/types';

describe('RouteSelector component', () => {
  const mockRoutes: RouteItem[] = [
    {
      method: 'GET',
      path: '/api/v1/users',
      tags: ['users'],
      summary: 'List all users',
      description: 'Returns all system users.',
      validation: ['query'],
    },
    {
      method: 'POST',
      path: '/api/v1/users',
      tags: ['users', 'auth'],
      summary: 'Register user',
      description: 'Creates new user account.',
      validation: ['body'],
    },
  ];

  it('renders route launcher when no route is active', () => {
    const markup = renderToStaticMarkup(
      <RouteSelector
        routes={mockRoutes}
        selectedMethod="GET"
        selectedPath=""
        onSelectRoute={() => {}}
      />,
    );
    expect(markup).toContain('Choose a discovered route to pre-fill request');
    expect(markup).toContain('2 routes');
    expect(markup).toContain('Browse Routes');
  });

  it('renders active route banner with method, path, tag, summary, and description', () => {
    const markup = renderToStaticMarkup(
      <RouteSelector
        routes={mockRoutes}
        selectedMethod="GET"
        selectedPath="/api/v1/users"
        onSelectRoute={() => {}}
        onClearRoute={() => {}}
        onResetPrefill={() => {}}
      />,
    );
    expect(markup).toContain('/api/v1/users');
    expect(markup).toContain('#users');
    expect(markup).toContain('List all users');
    expect(markup).toContain('Returns all system users.');
    expect(markup).toContain('Change Route');
    expect(markup).toContain('↻ Reset Mock Data');
  });

  it('renders route discovery modal palette when defaultOpen is true', () => {
    const parameterizedRoutes: RouteItem[] = [
      ...mockRoutes,
      {
        method: 'PUT',
        path: '/api/v1/users/:userId',
        tags: ['users'],
        summary: 'Update user',
        description: 'Updates specified user.',
        validation: ['params', 'body'],
      },
    ];

    const markup = renderToStaticMarkup(
      <RouteSelector
        routes={parameterizedRoutes}
        selectedMethod="GET"
        selectedPath=""
        defaultOpen={true}
        onSelectRoute={() => {}}
      />,
    );
    expect(markup).toContain('Select API Route');
    expect(markup).toContain(
      'Filter by path, method, tag, summary, or description...',
    );
    expect(markup).toContain(':userId');
    expect(markup).toContain('3 routes');
    expect(markup).toContain('to navigate');
  });
});
