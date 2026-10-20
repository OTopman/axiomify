import {
  AlertTriangle,
  CheckCircle2,
  Play,
  Shield,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { DiscoveryData, FindingItem } from '../types';
import { apiFetch } from '../utils/api';

interface SecurityPanelProps {
  discovery: DiscoveryData;
}

export const SecurityPanel: React.FC<SecurityPanelProps> = ({ discovery }) => {
  const [data, setData] = useState<any | null>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    fetchSecurity();
  }, []);

  const fetchSecurity = async () => {
    try {
      const res = await apiFetch('/__studio/api/security');
      if (res.ok) {
        const payload = await res.json();
        setData(payload);
        if (payload.isProbing) {
          setTimeout(fetchSecurity, 1000);
        }
      }
    } catch {}
  };

  const handleProbe = async () => {
    setProbing(true);
    try {
      const res = await apiFetch('/__studio/api/security/probe', {
        method: 'POST',
      });
      if (res.ok) {
        setTimeout(fetchSecurity, 500);
      }
    } catch {
    } finally {
      setProbing(false);
    }
  };

  if (!data) {
    return (
      <div style={{ padding: '24px' }}>
        <div style={{ marginBottom: '16px' }}>
          <h2
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            Security Center
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Static and dynamic security validation tests
          </p>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
          Loading security audit metrics...
        </div>
      </div>
    );
  }

  const staticChecks = data.static || [];
  const dynamicChecks = data.dynamic || [];
  const totalFindings = staticChecks.length + dynamicChecks.length;

  return (
    <div style={{ padding: '24px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
        }}
      >
        <div>
          <h2
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            Security Center
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Static rules, injection vulnerability scanners, and dynamic attack
            probe analysis
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleProbe}
          disabled={probing || data.isProbing}
        >
          <Play size={13} />
          <span>
            {probing || data.isProbing
              ? `Probing (${data.progress || 0}%)...`
              : 'Run Dynamic Probe'}
          </span>
        </button>
      </div>

      {data.isProbing && (
        <div style={{ marginBottom: '20px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              marginBottom: '4px',
              color: 'var(--text-secondary)',
            }}
          >
            <span>Dynamic Vulnerability Scanning in Progress...</span>
            <span>{data.progress || 0}%</span>
          </div>
          <div
            style={{
              height: '4px',
              background: 'var(--bg-tertiary)',
              borderRadius: '2px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${data.progress || 0}%`,
                height: '100%',
                background: 'var(--accent)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      )}

      {/* Metric Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '14px',
          marginBottom: '24px',
        }}
      >
        <div className="card" style={{ margin: 0, padding: '14px' }}>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Static Violations
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginTop: '4px',
            }}
          >
            {staticChecks.length}
          </div>
        </div>
        <div className="card" style={{ margin: 0, padding: '14px' }}>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Probe Violations
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginTop: '4px',
            }}
          >
            {dynamicChecks.length}
          </div>
        </div>
        <div className="card" style={{ margin: 0, padding: '14px' }}>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Security Grade
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              marginTop: '4px',
              color:
                totalFindings > 2
                  ? 'var(--error)'
                  : totalFindings > 0
                    ? 'var(--warning)'
                    : 'var(--success)',
            }}
          >
            {totalFindings > 4
              ? 'F'
              : totalFindings > 2
                ? 'D'
                : totalFindings > 0
                  ? 'B'
                  : 'A'}
          </div>
        </div>
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}
      >
        {/* Static checks */}
        <div>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Shield size={14} style={{ color: 'var(--accent)' }} />
            <span>Static Rule Warnings</span>
          </div>
          {staticChecks.length === 0 ? (
            <div
              className="empty-state"
              style={{
                border: '1px dashed var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <ShieldCheck size={20} style={{ color: 'var(--success)' }} />
              <span>No static violations detected. Excellent!</span>
            </div>
          ) : (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              {staticChecks.map((f: FindingItem) => (
                <div
                  key={f.id}
                  className="card"
                  style={{ margin: 0, padding: '12px' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '6px',
                    }}
                  >
                    <AlertTriangle
                      size={13}
                      style={{ color: 'var(--warning)' }}
                    />
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '12px',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {f.title}
                    </span>
                  </div>
                  {f.cwe && (
                    <div
                      style={{
                        fontSize: '10px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--accent-text)',
                        marginBottom: '4px',
                      }}
                    >
                      CWE: {f.cwe}
                    </div>
                  )}
                  <p
                    style={{
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      marginBottom: '8px',
                    }}
                  >
                    {f.description}
                  </p>
                  <div
                    style={{
                      fontSize: '11px',
                      background: 'var(--bg-primary)',
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-xs)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <strong>Remediation:</strong> {f.remediation}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dynamic checks */}
        <div>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <ShieldAlert size={14} style={{ color: 'var(--error)' }} />
            <span>Dynamic Attack Probe Findings</span>
          </div>
          {dynamicChecks.length === 0 ? (
            <div
              className="empty-state"
              style={{
                border: '1px dashed var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <CheckCircle2 size={20} style={{ color: 'var(--success)' }} />
              <span>No dynamic probe vulnerabilities detected.</span>
            </div>
          ) : (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              {dynamicChecks.map((f: FindingItem) => (
                <div
                  key={f.id}
                  className="card"
                  style={{
                    margin: 0,
                    padding: '12px',
                    borderColor: 'rgba(239, 68, 68, 0.3)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '6px',
                    }}
                  >
                    <XCircle size={13} style={{ color: 'var(--error)' }} />
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '12px',
                        color: 'var(--error)',
                      }}
                    >
                      {f.title}
                    </span>
                  </div>
                  {f.cwe && (
                    <div
                      style={{
                        fontSize: '10px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--accent-text)',
                        marginBottom: '4px',
                      }}
                    >
                      CWE: {f.cwe}
                    </div>
                  )}
                  <p
                    style={{
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      marginBottom: '8px',
                    }}
                  >
                    {f.description}
                  </p>
                  <div
                    style={{
                      fontSize: '11px',
                      background: 'var(--bg-primary)',
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-xs)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <strong>Remediation:</strong> {f.remediation}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SecurityPanel;
