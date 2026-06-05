import React, { useState } from 'react';
import { DiscoveryData, RouteItem, ArchNode } from '../types';

interface DashboardProps {
  discovery: DiscoveryData;
  onQuickTest: (method: string, path: string) => void;
  onOpenWsTester: (path: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ discovery, onQuickTest, onOpenWsTester }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeMethodFilter, setActiveMethodFilter] = useState('ALL');
  const [expandedRoutes, setExpandedRoutes] = useState<Record<string, boolean>>({});

  const toggleRouteDetail = (method: string, path: string) => {
    const key = `${method}:${path}`;
    setExpandedRoutes(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const getPipelineFlow = (r: RouteItem) => {
    const archMap = discovery.archMap || [];
    const controllerNode = archMap.find(n => n.id === `controller:${r.method}:${r.path}`);
    const depFlow: { name: string; type: string; icon: string }[] = [];

    depFlow.push({ name: `Route: ${r.method} ${r.path}`, type: 'route', icon: '🧭' });

    if (r.plugins && r.plugins.length > 0) {
      for (const p of r.plugins) {
        depFlow.push({ name: `Middleware: ${p}`, type: 'middleware', icon: '🛡️' });
      }
    }

    if (r.validation && r.validation.length > 0) {
      depFlow.push({ name: `Validation: ${r.validation.join(', ')}`, type: 'validation', icon: '📐' });
    }

    depFlow.push({ name: r.operationId || 'Handler', type: 'controller', icon: '⚙️' });

    if (controllerNode && controllerNode.dependencies) {
      for (const dep of controllerNode.dependencies) {
        const sToken = dep.split(':')[1] || dep;
        depFlow.push({ name: `Service: ${sToken}`, type: 'service', icon: '🧩' });

        const sNode = archMap.find(n => n.id === dep);
        if (sNode && sNode.dependencies) {
          for (const sDep of sNode.dependencies) {
            const subToken = sDep.split(':')[1] || sDep;
            const subNode = archMap.find(n => n.id === sDep);
            const subType = subNode ? subNode.type : 'service';
            const subIcon = subType === 'repository' ? '📦' : subType === 'database' ? '🛢️' : '🧩';
            depFlow.push({ name: `${subType.toUpperCase()}: ${subToken}`, type: subType, icon: subIcon });
          }
        }
      }
    }

    return depFlow;
  };

  // Filter routes
  const filteredRoutes = (discovery.routes || []).filter(r => {
    const routeProtocol = r.realtimeProtocol || (r.isWs ? 'ws' : 'http');
    const matchesMethod = activeMethodFilter === 'ALL' || r.method === activeMethodFilter;
    const cleanSearch = searchTerm.toLowerCase().trim();
    const matchesSearch = !cleanSearch || 
      r.path.toLowerCase().includes(cleanSearch) ||
      r.method.toLowerCase().includes(cleanSearch) ||
      (routeProtocol && routeProtocol.toLowerCase().includes(cleanSearch)) ||
      (r.tags || []).some(t => t.toLowerCase().includes(cleanSearch));

    return matchesMethod && matchesSearch;
  });

  const escapeHtml = (text: string) => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const getBadgeColor = (type: string) => {
    switch (type) {
      case 'route': return 'var(--accent)';
      case 'middleware': return 'var(--method-head)';
      case 'validation': return 'var(--warning)';
      case 'controller': return 'var(--success)';
      case 'repository': return 'var(--method-ws)';
      case 'database': return 'var(--error)';
      default: return 'var(--info)';
    }
  };

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">Route Inspector</div>
        <div className="panel-subtitle">All registered HTTP and WebSocket routes</div>
      </div>

      <div className="search-bar">
        <input
          className="search-input"
          type="text"
          placeholder="Search routes by path, method, or tag..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="filter-pills">
        {['ALL', 'GET', 'POST', 'PUT', 'DELETE', 'WS'].map(m => (
          <div
            key={m}
            className={`filter-pill ${activeMethodFilter === m ? 'active' : ''}`}
            onClick={() => setActiveMethodFilter(m)}
          >
            {m}
          </div>
        ))}
      </div>

      {filteredRoutes.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🧭</div>
          <div className="empty-state-message">No routes found</div>
        </div>
      ) : (
        <table className="route-table">
          <thead>
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th>Validation</th>
              <th>Tags</th>
              <th>Details</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRoutes.map((r, idx) => {
              const routeProtocol = r.realtimeProtocol || (r.isWs ? 'ws' : 'http');
              const key = `${r.method}:${r.path}`;
              const isExpanded = !!expandedRoutes[key];
              const flowCards = getPipelineFlow(r);

              // Linkify path params :id -> span
              const pathParts = r.path.split(/(:[a-zA-Z0-9_]+)/g);
              const pathElement = pathParts.map((part, i) => {
                if (part.startsWith(':')) {
                  return <span key={i} className="route-param">{part}</span>;
                }
                return part;
              });

              return (
                <React.Fragment key={key}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => toggleRouteDetail(r.method, r.path)}>
                    <td>
                      <span className={`method-badge method-${r.method}`}>
                        {routeProtocol === 'socket.io' ? 'SIO' : r.method}
                      </span>
                    </td>
                    <td className="route-path">{pathElement}</td>
                    <td>
                      <div className="validation-pills">
                        {r.validation.length > 0 ? (
                          r.validation.map(v => (
                            <span key={v} className="validation-pill">{v}</span>
                          ))
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {r.tags && r.tags.length > 0 ? (
                        r.tags.map(t => (
                          <span key={t} className="tag-pill" style={{ marginRight: '4px' }}>{t}</span>
                        ))
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                          {r.isWs && (
                            <span className="validation-pill" style={{ textTransform: 'none', background: 'rgba(139,92,246,0.08)', color: 'var(--method-ws)', border: '1px solid rgba(139,92,246,0.2)' }}>
                              {routeProtocol}
                            </span>
                          )}
                          {r.deprecated && <span className="deprecated-badge">deprecated</span>}
                          {r.operationId && <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>op:{r.operationId}</span>}
                        </div>
                        {r.plugins && r.plugins.length > 0 && (
                          <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
                            {r.plugins.map(p => (
                              <span
                                key={p}
                                className="validation-pill"
                                style={{ textTransform: 'none', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', fontSize: '10px' }}
                                title={`Middleware: ${p}`}
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      {r.isWs ? (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '11px', margin: 0 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenWsTester(r.path);
                          }}
                        >
                          Test WS
                        </button>
                      ) : (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '11px', margin: 0 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onQuickTest(r.method, r.path);
                          }}
                        >
                          ⚡ Test
                        </button>
                      )}
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="route-detail-row" style={{ background: 'var(--bg-tertiary)' }}>
                      <td colSpan={6} style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                            Route Pipeline Dependency Graph
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px', overflowX: 'auto' }}>
                            {flowCards.map((card, cardIdx) => (
                              <React.Fragment key={cardIdx}>
                                <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: 'var(--shadow-sm)', minWidth: '180px' }}>
                                  <span style={{ fontSize: '16px' }}>{card.icon}</span>
                                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: getBadgeColor(card.type) }}>
                                      {card.type}
                                    </span>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                      {card.name}
                                    </span>
                                  </div>
                                </div>
                                {cardIdx < flowCards.length - 1 && (
                                  <div style={{ fontSize: '18px', color: 'var(--text-muted)', fontWeight: 'bold', userSelect: 'none' }}>
                                    →
                                  </div>
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
