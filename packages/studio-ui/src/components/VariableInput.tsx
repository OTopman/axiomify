import { Zap } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import {
  AvailableVariable,
  extractVariableReferenceContext,
  filterVariables,
  insertVariableAtCursor,
  VariableTokenContext,
} from '../utils/environment-intellisense';

export interface VariableInputProps {
  value: string;
  onChange: (value: string) => void;
  variables: AvailableVariable[];
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  type?: string;
  readOnly?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
  id?: string;
  multiline?: boolean;
  rows?: number;
}

export const VariableInput: React.FC<VariableInputProps> = ({
  value,
  onChange,
  variables,
  placeholder,
  className = 'text-input',
  style,
  inputStyle,
  type = 'text',
  readOnly = false,
  disabled = false,
  'aria-label': ariaLabel,
  id,
  multiline = false,
  rows = 3,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [tokenContext, setTokenContext] = useState<VariableTokenContext | null>(
    null,
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);

  const filteredVars = tokenContext
    ? filterVariables(variables, tokenContext.query)
    : [];

  const isOpen = isFocused && tokenContext !== null && variables.length > 0;

  // Keep selected index within bounds when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [tokenContext?.query]);

  // Close on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setTokenContext(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const checkContext = (
    text: string,
    target: HTMLInputElement | HTMLTextAreaElement,
  ) => {
    const cursor = target.selectionStart ?? text.length;
    const ctx = extractVariableReferenceContext(text, cursor);
    setTokenContext(ctx);
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const nextVal = e.target.value;
    onChange(nextVal);
    checkContext(nextVal, e.target);
  };

  const handleSelectOrKeyUp = (
    e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    checkContext(value, e.currentTarget);
  };

  const handleApplyVariable = (variableKey: string) => {
    if (!tokenContext) return;
    const { newText, newCursor } = insertVariableAtCursor(
      value,
      tokenContext.tokenStart,
      tokenContext.tokenEnd,
      variableKey,
    );
    onChange(newText);
    setTokenContext(null);

    // Reposition cursor in input after state update
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursor, newCursor);
      }
    });
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (!isOpen || filteredVars.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredVars.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(
        (prev) => (prev - 1 + filteredVars.length) % filteredVars.length,
      );
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (filteredVars[selectedIndex]) {
        e.preventDefault();
        handleApplyVariable(filteredVars[selectedIndex].key);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setTokenContext(null);
    }
  };

  const inputProps = {
    ref: inputRef as any,
    id,
    value,
    placeholder,
    className,
    style: { ...inputStyle, width: '100%' },
    readOnly,
    disabled,
    'aria-label': ariaLabel,
    'aria-autocomplete': 'list' as const,
    'aria-expanded': isOpen,
    onChange: handleInputChange,
    onKeyDown: handleKeyDown,
    onKeyUp: handleSelectOrKeyUp,
    onSelect: handleSelectOrKeyUp,
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setIsFocused(true);
      checkContext(value, e.target);
    },
    onBlur: () => {
      // Delay closing slightly so item click handlers can execute
      setTimeout(() => {
        setIsFocused(false);
      }, 200);
    },
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        ...style,
      }}
    >
      {multiline ? (
        <textarea {...(inputProps as any)} rows={rows} />
      ) : (
        <input {...inputProps} type={type} />
      )}

      {isOpen && (
        <div
          className="var-intellisense-popover"
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxWidth: '100%',
            minWidth: '280px',
            zIndex: 1050,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-md)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '6px 10px',
              fontSize: '11px',
              fontWeight: 600,
              background: 'var(--bg-tertiary)',
              borderBottom: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Zap size={13} style={{ color: 'var(--accent)' }} /> Environment
              Variables
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              Press ↵ or Tab to insert
            </span>
          </div>

          <div
            style={{
              maxHeight: '200px',
              overflowY: 'auto',
            }}
          >
            {filteredVars.length === 0 ? (
              <div
                style={{
                  padding: '12px 14px',
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                }}
              >
                No variables matching &quot;{tokenContext.query}&quot;
              </div>
            ) : (
              filteredVars.map((v, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={`${v.key}-${idx}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => {
                      e.preventDefault(); // Prevents blur before click registers
                      handleApplyVariable(v.key);
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      padding: '7px 12px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      background: isSelected
                        ? 'var(--bg-hover)'
                        : 'transparent',
                      borderLeft: isSelected
                        ? '3px solid var(--accent)'
                        : '3px solid transparent',
                      transition: 'background var(--transition)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        overflow: 'hidden',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: '3px',
                          background: v.isCurrentEnv
                            ? 'rgba(79, 70, 229, 0.15)'
                            : 'rgba(100, 116, 139, 0.15)',
                          color: v.isCurrentEnv
                            ? 'var(--accent)'
                            : 'var(--text-secondary)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        VAR
                      </span>
                      <span
                        style={{
                          fontWeight: 600,
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {v.key}
                      </span>
                      <span
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: '11px',
                          fontFamily: 'var(--font-mono)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '180px',
                        }}
                        title={v.value}
                      >
                        = {v.value}
                      </span>
                    </div>

                    {v.environmentName && (
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: '10px',
                          background: 'var(--bg-tertiary)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border)',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                      >
                        {v.environmentName}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
