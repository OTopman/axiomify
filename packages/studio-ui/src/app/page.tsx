'use client';

import dynamic from 'next/dynamic';
import React from 'react';

const App = dynamic(() => import('../App'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#09090b',
        color: '#a1a1aa',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
      }}
    >
      Loading Axiomify Studio...
    </div>
  ),
});

export default function StudioPage() {
  return <App />;
}
