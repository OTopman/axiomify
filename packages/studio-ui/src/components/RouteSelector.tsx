import { Bookmark, Layers, Search, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RouteItem } from '../types';
import {
  extractAllTags,
  extractMethodCounts,
  filterRoutes,
  getRouteMetadata,
} from '../utils/route-discovery-helper';

export interface RouteSelectorProps {
  routes: RouteItem[];
  selectedMethod: string;
  selectedPath: string;
  onSelectRoute: (method: string, path: string) => void;
  onResetPrefill?: () => void;
  onClearRoute?: () => void;
  openapi?: any;
  defaultOpen?: boolean;
  onClose?: () => void;
}

export const RouteSelector: React.FC<RouteSelectorProps> = ({
  routes,
  selectedMethod,
  selectedPath,
  onSelectRoute,
  onResetPrefill,
  onClearRoute,
  openapi,
  defaultOpen,
  onClose,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? false);
  const [searchQuery, setSearchQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [tagFilter, setTagFilter] = useState('ALL');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Exclude WS routes from Request Tester (they belong in WebSocketTester)
  const httpRoutes = useMemo(
    () => (routes || []).filter((r) => !r.isWs),
    [routes],
  );

  const methodCounts = useMemo(
    () => extractMethodCounts(httpRoutes),
    [httpRoutes],
  );
  const allTags = useMemo(
    () => extractAllTags(httpRoutes, openapi),
    [httpRoutes, openapi],
  );

  const filteredRoutes = useMemo(() => {
    return filterRoutes(httpRoutes, {
      query: searchQuery,
      method: methodFilter,
      tag: tagFilter,
      openapi,
      excludeWs: true,
    });
  }, [httpRoutes, searchQuery, methodFilter, tagFilter, openapi]);

  // Selected route metadata if a route is currently chosen
  const activeRoute = useMemo(() => {
    return (
      httpRoutes.find(
        (r) =>
          r.method.toUpperCase() === selectedMethod.toUpperCase() &&
          r.path === selectedPath,
      ) || null
    );
  }, [httpRoutes, selectedMethod, selectedPath]);

  const activeMeta = useMemo(() => {
    return activeRoute ? getRouteMetadata(activeRoute, openapi) : null;
  }, [activeRoute, openapi]);

  // Focus search input when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Reset selected index when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery, methodFilter, tagFilter]);

  // Global keyboard shortcut to open route picker ('/' when not focused in an input)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        (activeEl as HTMLElement)?.isContentEditable;

      if (e.key === '/' && !isInput && !isOpen) {
        e.preventDefault();
        setIsOpen(true);
      } else if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'k' &&
        !isOpen
      ) {
        e.preventDefault();
        setIsOpen(true);
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleClose = () => {
    setIsOpen(false);
    onClose?.();
  };

  // Keyboard navigation within the route picker modal
  const handleModalKeyDown = (e: React.KeyboardEvent) => {
    if (filteredRoutes.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = (prev + 1) % filteredRoutes.length;
        scrollIndexIntoView(next);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = (prev - 1 + filteredRoutes.length) % filteredRoutes.length;
        scrollIndexIntoView(next);
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = filteredRoutes[selectedIndex];
      if (picked) {
        handlePickRoute(picked);
      }
    }
  };

  const scrollIndexIntoView = (index: number) => {
    if (!listContainerRef.current) return;
    const items = listContainerRef.current.querySelectorAll('.route-card-item');
    const target = items[index] as HTMLElement;
    if (target) {
      target.scrollIntoView({ block: 'nearest' });
    }
  };

  const handlePickRoute = (r: RouteItem) => {
    onSelectRoute(r.method, r.path);
    handleClose();
  };

  const renderPathSegments = (pathStr: string) => {
    const segments = pathStr.split(/(:[a-zA-Z0-9_]+|{[a-zA-Z0-9_]+})/g);
    return segments.map((seg, i) => {
      if (seg.startsWith(':') || seg.startsWith('{')) {
        return (
          <span
            key={i}
            style={{
              color: 'var(--warning)',
              fontWeight: 700,
              background: 'rgba(245, 158, 11, 0.12)',
              padding: '1px 4px',
              borderRadius: '4px',
            }}
          >
            {seg}
          </span>
        );
      }
      return <span key={i}>{seg}</span>;
    });
  };

  return (
    <div className="route-selector-hub" style={{ marginBottom: '16px' }}>
      {/* ── Active Route Banner or Quick Launcher ─────────────────────── */}
      {activeRoute ? (
        <div
          className="route-active-banner"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 18px',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            transition: 'border-color var(--transition)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                flexWrap: 'wrap',
              }}
            >
              <span
                className={`method-badge method-${activeRoute.method}`}
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: '4px',
                }}
              >
                {activeRoute.method}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                {renderPathSegments(activeRoute.path)}
              </span>

              {activeMeta?.tags && activeMeta.tags.length > 0 && (
                <div
                  style={{ display: 'flex', gap: '4px', alignItems: 'center' }}
                >
                  {activeMeta.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '10px',
                        background: 'rgba(79, 70, 229, 0.1)',
                        color: 'var(--accent)',
                        fontWeight: 600,
                        border: '1px solid rgba(79, 70, 229, 0.2)',
                      }}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              {activeRoute.deprecated && (
                <span
                  style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: 'rgba(239, 68, 68, 0.12)',
                    color: 'var(--error)',
                    fontWeight: 700,
                  }}
                >
                  DEPRECATED
                </span>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {onResetPrefill && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 9px', fontSize: '11px', margin: 0 }}
                  onClick={onResetPrefill}
                  title="Reset request parameters and body to schema mock defaults"
                >
                  ↻ Reset Mock Data
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                onClick={() => setIsOpen(true)}
              >
                <Search size={12} /> Change Route
              </button>
              {onClearRoute && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    margin: 0,
                    color: 'var(--text-muted)',
                  }}
                  onClick={onClearRoute}
                  title="Clear selected route prefill"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {(activeMeta?.summary || activeMeta?.description) && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
                paddingTop: '6px',
                borderTop: '1px solid var(--border)',
                marginTop: '2px',
              }}
            >
              {activeMeta.summary && (
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Bookmark size={12} style={{ color: 'var(--accent)' }} />
                  <span>{activeMeta.summary}</span>
                </div>
              )}
              {activeMeta.description && (
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    lineHeight: '1.45',
                    marginLeft: activeMeta.summary ? '20px' : '0',
                  }}
                >
                  {activeMeta.description}
                </div>
              )}
            </div>
          )}

          {activeRoute.validation && activeRoute.validation.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: '6px',
                alignItems: 'center',
                fontSize: '11px',
                color: 'var(--text-muted)',
                marginTop: '2px',
              }}
            >
              <span style={{ fontSize: '10px', textTransform: 'uppercase' }}>
                Validated Schemas:
              </span>
              {activeRoute.validation.map((v) => (
                <span
                  key={v}
                  style={{
                    fontSize: '10px',
                    padding: '1px 5px',
                    borderRadius: '4px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {v}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : !defaultOpen ? (
        /* Empty launcher state when no route is preselected */
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsOpen(true);
            }
          }}
          className="route-selector-trigger"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px dashed var(--border-active)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 18px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            transition:
              'border-color var(--transition), background var(--transition)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Layers size={18} style={{ color: 'var(--accent)' }} />
            <div>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                Choose a discovered route to pre-fill request
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Search by path, method, tags, summary, or description
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '12px',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
                fontWeight: 600,
              }}
            >
              {httpRoutes.length} route{httpRoutes.length === 1 ? '' : 's'}
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              / or ⌘K
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: '11px', margin: 0 }}
            >
              Browse Routes
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Route Discovery Modal & Search Palette ────────────────────── */}
      {isOpen && (
        <div
          className="route-modal-backdrop"
          onClick={handleClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
        >
          <div
            className="route-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleModalKeyDown}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.45)',
              width: '100%',
              maxWidth: '780px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              animation: 'modalSlideIn 150ms ease-out',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--bg-tertiary)',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <Layers size={16} style={{ color: 'var(--accent)' }} />
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: '14px',
                    color: 'var(--text-primary)',
                  }}
                >
                  Select API Route
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    background: 'rgba(79, 70, 229, 0.12)',
                    color: 'var(--accent)',
                    fontWeight: 600,
                  }}
                >
                  {filteredRoutes.length} of {httpRoutes.length} routes
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  padding: '3px 8px',
                  fontSize: '12px',
                  borderRadius: 'var(--radius-sm)',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onClick={handleClose}
                title="Close (Esc)"
              >
                <X size={14} />
              </button>
            </div>

            {/* Search Input Bar */}
            <div
              style={{
                padding: '12px 18px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-secondary)',
              }}
            >
              <div style={{ position: 'relative', width: '100%' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-muted)',
                  }}
                >
                  <Search size={14} />
                </span>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="text-input"
                  style={{
                    paddingLeft: '36px',
                    paddingRight: '60px',
                    fontSize: '13px',
                    height: '38px',
                  }}
                  placeholder="Filter by path, method, tag, summary, or description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '32px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      padding: '4px',
                    }}
                  >
                    ✕
                  </button>
                )}
                <span
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: '10px',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    background: 'var(--bg-tertiary)',
                    padding: '2px 4px',
                    borderRadius: '3px',
                    border: '1px solid var(--border)',
                  }}
                >
                  ESC
                </span>
              </div>

              {/* Filter Pills: Method & Tags */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  marginTop: '10px',
                }}
              >
                {/* Method Pills */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      marginRight: '4px',
                      fontWeight: 600,
                    }}
                  >
                    Method:
                  </span>
                  {['ALL', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => {
                    const count = methodCounts[m] || 0;
                    if (m !== 'ALL' && count === 0) return null;
                    const isActive = methodFilter === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMethodFilter(m)}
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          border: isActive
                            ? '1px solid var(--accent)'
                            : '1px solid var(--border)',
                          background: isActive
                            ? 'var(--accent)'
                            : 'var(--bg-tertiary)',
                          color: isActive ? '#fff' : 'var(--text-secondary)',
                          fontWeight: isActive ? 700 : 500,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all var(--transition)',
                        }}
                      >
                        <span>{m}</span>
                        <span
                          style={{
                            fontSize: '9px',
                            opacity: isActive ? 0.9 : 0.6,
                          }}
                        >
                          ({count})
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Tag Pills */}
                {allTags.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flexWrap: 'wrap',
                      overflowX: 'auto',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        marginRight: '4px',
                        fontWeight: 600,
                      }}
                    >
                      Tags:
                    </span>
                    <button
                      type="button"
                      onClick={() => setTagFilter('ALL')}
                      style={{
                        fontSize: '10px',
                        padding: '1px 7px',
                        borderRadius: '10px',
                        border:
                          tagFilter === 'ALL'
                            ? '1px solid var(--accent)'
                            : '1px solid var(--border)',
                        background:
                          tagFilter === 'ALL'
                            ? 'var(--accent)'
                            : 'var(--bg-tertiary)',
                        color:
                          tagFilter === 'ALL'
                            ? '#fff'
                            : 'var(--text-secondary)',
                        fontWeight: tagFilter === 'ALL' ? 700 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      All Tags
                    </button>
                    {allTags.map(({ tag, count }) => {
                      const isActive =
                        tagFilter.toLowerCase() === tag.toLowerCase();
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setTagFilter(isActive ? 'ALL' : tag)}
                          style={{
                            fontSize: '10px',
                            padding: '1px 7px',
                            borderRadius: '10px',
                            border: isActive
                              ? '1px solid var(--accent)'
                              : '1px solid var(--border)',
                            background: isActive
                              ? 'var(--accent)'
                              : 'var(--bg-tertiary)',
                            color: isActive ? '#fff' : 'var(--text-secondary)',
                            fontWeight: isActive ? 700 : 500,
                            cursor: 'pointer',
                          }}
                        >
                          #{tag} ({count})
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Routes List */}
            <div
              ref={listContainerRef}
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                maxHeight: '480px',
              }}
            >
              {filteredRoutes.length === 0 ? (
                <div
                  style={{
                    padding: '36px 20px',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      marginBottom: '8px',
                    }}
                  >
                    <Search
                      size={24}
                      style={{ color: 'var(--border-active)' }}
                    />
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>
                    No routes found matching your criteria
                  </div>
                  <div style={{ fontSize: '12px', marginTop: '4px' }}>
                    Try searching for another keyword or clear the active
                    filters.
                  </div>
                  {(searchQuery ||
                    methodFilter !== 'ALL' ||
                    tagFilter !== 'ALL') && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{
                        marginTop: '12px',
                        padding: '4px 12px',
                        fontSize: '11px',
                      }}
                      onClick={() => {
                        setSearchQuery('');
                        setMethodFilter('ALL');
                        setTagFilter('ALL');
                      }}
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              ) : (
                filteredRoutes.map((route, index) => {
                  const meta = getRouteMetadata(route, openapi);
                  const isHighlighted = index === selectedIndex;
                  const isCurrent =
                    route.method.toUpperCase() ===
                      selectedMethod.toUpperCase() &&
                    route.path === selectedPath;

                  return (
                    <div
                      key={`${route.method} ${route.path}`}
                      className="route-card-item"
                      role="button"
                      tabIndex={0}
                      onClick={() => handlePickRoute(route)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      style={{
                        background: isHighlighted
                          ? 'var(--bg-hover)'
                          : 'var(--bg-secondary)',
                        border: isCurrent
                          ? '1px solid var(--accent)'
                          : isHighlighted
                            ? '1px solid var(--border-active)'
                            : '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        padding: '10px 14px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        transition: 'all var(--transition)',
                        position: 'relative',
                      }}
                    >
                      {/* Top Row: Method, Path, Tags, Badges */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span
                            className={`method-badge method-${route.method}`}
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '4px',
                            }}
                          >
                            {route.method}
                          </span>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '13px',
                              fontWeight: 600,
                              color: 'var(--text-primary)',
                            }}
                          >
                            {renderPathSegments(route.path)}
                          </span>

                          {meta.tags.map((t) => (
                            <span
                              key={t}
                              style={{
                                fontSize: '10px',
                                padding: '1px 5px',
                                borderRadius: '8px',
                                background: 'rgba(79, 70, 229, 0.08)',
                                color: 'var(--accent)',
                                border: '1px solid rgba(79, 70, 229, 0.15)',
                                fontWeight: 500,
                              }}
                            >
                              #{t}
                            </span>
                          ))}

                          {route.deprecated && (
                            <span
                              style={{
                                fontSize: '9px',
                                padding: '1px 4px',
                                borderRadius: '3px',
                                background: 'rgba(239, 68, 68, 0.12)',
                                color: 'var(--error)',
                                fontWeight: 700,
                              }}
                            >
                              DEPRECATED
                            </span>
                          )}
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          {route.validation?.map((val) => (
                            <span
                              key={val}
                              style={{
                                fontSize: '9px',
                                padding: '1px 4px',
                                borderRadius: '3px',
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-muted)',
                                fontFamily: 'var(--font-mono)',
                              }}
                            >
                              {val}
                            </span>
                          ))}
                          {isCurrent && (
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                color: 'var(--accent)',
                                background: 'rgba(79, 70, 229, 0.12)',
                                padding: '1px 6px',
                                borderRadius: '4px',
                              }}
                            >
                              ✓ Active
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Middle Row: Summary */}
                      {meta.summary && (
                        <div
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                          }}
                        >
                          <Bookmark
                            size={11}
                            style={{ color: 'var(--accent)', flexShrink: 0 }}
                          />
                          <span>{meta.summary}</span>
                        </div>
                      )}

                      {/* Bottom Row: Description */}
                      {meta.description && (
                        <div
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-secondary)',
                            lineHeight: '1.4',
                            marginLeft: meta.summary ? '18px' : '0',
                          }}
                        >
                          {meta.description}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '10px 18px',
                borderTop: '1px solid var(--border)',
                background: 'var(--bg-tertiary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px',
                color: 'var(--text-muted)',
              }}
            >
              <div style={{ display: 'flex', gap: '14px' }}>
                <span>
                  <kbd
                    style={{
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--bg-secondary)',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      border: '1px solid var(--border)',
                    }}
                  >
                    ↑
                  </kbd>{' '}
                  <kbd
                    style={{
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--bg-secondary)',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      border: '1px solid var(--border)',
                    }}
                  >
                    ↓
                  </kbd>{' '}
                  to navigate
                </span>
                <span>
                  <kbd
                    style={{
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--bg-secondary)',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      border: '1px solid var(--border)',
                    }}
                  >
                    ↵
                  </kbd>{' '}
                  to select
                </span>
                <span>
                  <kbd
                    style={{
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--bg-secondary)',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      border: '1px solid var(--border)',
                    }}
                  >
                    esc
                  </kbd>{' '}
                  to close
                </span>
              </div>
              <div>Click any route to pre-fill request data</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
