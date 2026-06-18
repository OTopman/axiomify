import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';

interface JobItem {
  id: string;
  queue: string;
  name: string;
  payload: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  priority: number;
  runAt: number;
  attempts: number;
  maxAttempts: number;
  error?: string;
  lockedAt?: number;
}

interface JobsResponse {
  available: boolean;
  message?: string;
  error?: string;
  jobs?: JobItem[];
  stats?: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    successRate: number;
  };
}

export const JobsPanel: React.FC = () => {
  const [data, setData] = useState<JobsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedJob, setSelectedJob] = useState<JobItem | null>(null);
  const [pollInterval, setPollInterval] = useState<number>(2000);

  useEffect(() => {
    fetchJobs();
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchJobs, pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval]);

  const fetchJobs = async () => {
    try {
      const res = await apiFetch('/__studio/api/jobs');
      if (res.ok) {
        const json: JobsResponse = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon spinner">⏳</div>
        <div className="empty-state-message">Loading distributed jobs status...</div>
      </div>
    );
  }

  if (data && !data.available) {
    return (
      <div>
        <div className="panel-header">
          <div className="panel-title">Jobs & Background Workers</div>
          <div className="panel-subtitle">Monitor queues, background tasks, and distributed transaction flows</div>
        </div>
        <div className="empty-state" style={{ border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)', padding: '48px 24px', background: 'var(--bg-secondary)' }}>
          <div className="empty-state-icon">💼</div>
          <div className="empty-state-message" style={{ fontWeight: 600, fontSize: '16px', color: 'var(--text-primary)', marginBottom: '8px' }}>
            Jobs Service Inactive
          </div>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '480px', margin: '0 auto 20px', fontSize: '14px', lineHeight: '1.5' }}>
            {data.message || 'The jobs scheduler module is not currently registered in the application container.'}
          </p>
          <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: 'var(--radius-md)', textAlign: 'left', maxWidth: '540px', margin: '0 auto', fontSize: '13px', border: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Enable Queueing:</span>
            <pre style={{ margin: '8px 0 0', fontFamily: 'var(--font-mono)', overflowX: 'auto', background: 'rgba(0,0,0,0.15)', padding: '10px', borderRadius: '4px' }}>
{`import { jobsModule } from '@axiomify/jobs';

app.use(jobsModule({
  storage: 'sql', // or 'memory'
  client: dbClient,
  maxConcurrency: 5
}));`}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  const jobs = data?.jobs || [];
  const stats = data?.stats || { total: 0, pending: 0, running: 0, completed: 0, failed: 0, successRate: 100 };

  // Filter list
  const filteredJobs = jobs.filter(j => {
    const matchesSearch = !searchTerm || j.name.toLowerCase().includes(searchTerm.toLowerCase()) || j.id.includes(searchTerm);
    const matchesStatus = statusFilter === 'ALL' || j.status === statusFilter.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'var(--success)';
      case 'failed': return 'var(--error)';
      case 'running': return 'var(--accent)';
      case 'pending': return 'var(--text-secondary)';
      default: return 'var(--text-muted)';
    }
  };

  return (
    <div style={{ textAlign: 'left' }}>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <div className="panel-title">Jobs & Background Workers</div>
          <div className="panel-subtitle">Monitor queues, background tasks, and distributed transaction flows</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <select 
            className="input-select" 
            style={{ padding: '6px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', cursor: 'pointer' }}
            value={pollInterval}
            onChange={(e) => setPollInterval(Number(e.target.value))}
          >
            <option value={1000}>Auto-refresh (1s)</option>
            <option value={2000}>Auto-refresh (2s)</option>
            <option value={5000}>Auto-refresh (5s)</option>
            <option value={10000}>Auto-refresh (10s)</option>
            <option value={99999999}>Pause refresh</option>
          </select>
          <button className="btn" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }} onClick={fetchJobs}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards Grid */}
      <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Jobs</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '8px' }}>{stats.total}</div>
          <div style={{ position: 'absolute', bottom: '-8px', right: '-8px', fontSize: '64px', opacity: 0.05, userSelect: 'none' }}>💼</div>
        </div>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Running</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--accent)', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {stats.running}
            {stats.running > 0 && <span className="spinner" style={{ fontSize: '18px' }}>⚙️</span>}
          </div>
          <div style={{ position: 'absolute', bottom: '-8px', right: '-8px', fontSize: '64px', opacity: 0.05, userSelect: 'none' }}>⚡</div>
        </div>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pending</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '8px' }}>{stats.pending}</div>
          <div style={{ position: 'absolute', bottom: '-8px', right: '-8px', fontSize: '64px', opacity: 0.05, userSelect: 'none' }}>⏳</div>
        </div>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Completed</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--success)', marginTop: '8px' }}>{stats.completed}</div>
          <div style={{ position: 'absolute', bottom: '-8px', right: '-8px', fontSize: '64px', opacity: 0.05, userSelect: 'none' }}>✅</div>
        </div>
        <div style={{ background: stats.failed > 0 ? 'rgba(239, 68, 68, 0.05)' : 'var(--bg-secondary)', border: stats.failed > 0 ? '1px solid var(--error)' : '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '12px', color: stats.failed > 0 ? 'var(--error)' : 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Failed</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: stats.failed > 0 ? 'var(--error)' : 'var(--text-primary)', marginTop: '8px' }}>{stats.failed}</div>
          <div style={{ position: 'absolute', bottom: '-8px', right: '-8px', fontSize: '64px', opacity: stats.failed > 0 ? 0.08 : 0.05, userSelect: 'none' }}>❌</div>
        </div>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Success Rate</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: stats.successRate > 90 ? 'var(--success)' : stats.successRate > 50 ? 'var(--warning)' : 'var(--error)', marginTop: '8px' }}>{stats.successRate}%</div>
          <div style={{ position: 'absolute', bottom: '-8px', right: '-8px', fontSize: '64px', opacity: 0.05, userSelect: 'none' }}>📈</div>
        </div>
      </div>

      {/* Filter and search bar */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
        <input 
          className="search-input" 
          type="text" 
          placeholder="Search jobs by name or ID..." 
          style={{ flex: 1, padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
          value={searchTerm} 
          onChange={(e) => setSearchTerm(e.target.value)} 
        />
        <div style={{ display: 'flex', gap: '6px' }}>
          {['ALL', 'PENDING', 'RUNNING', 'COMPLETED', 'FAILED'].map(filter => (
            <button 
              key={filter} 
              className={`btn ${statusFilter === filter ? 'active' : ''}`}
              style={{
                background: statusFilter === filter ? 'var(--accent)' : 'var(--bg-secondary)',
                color: statusFilter === filter ? '#fff' : 'var(--text-primary)',
                border: '1px solid var(--border)',
                padding: '6px 12px',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontWeight: 500
              }}
              onClick={() => setStatusFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* Job list table */}
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {filteredJobs.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📂</div>
            <div>No matching jobs found in queue.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', textAlign: 'left' }}>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Job Details</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Queue</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Attempts</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Run At</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map(job => (
                <tr key={job.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s' }}>
                  {/* Status */}
                  <td style={{ padding: '12px 16px' }}>
                    <span 
                      style={{ 
                        display: 'inline-flex', 
                        alignItems: 'center', 
                        gap: '6px', 
                        padding: '4px 8px', 
                        borderRadius: '12px', 
                        background: 'rgba(0,0,0,0.15)', 
                        color: getStatusColor(job.status),
                        fontWeight: 600,
                        fontSize: '11px',
                        textTransform: 'uppercase'
                      }}
                    >
                      <span 
                        className={job.status === 'running' ? 'spinner' : ''} 
                        style={{ 
                          width: '8px', 
                          height: '8px', 
                          borderRadius: '50%', 
                          background: getStatusColor(job.status),
                          display: 'inline-block'
                        }} 
                      />
                      {job.status}
                    </span>
                  </td>

                  {/* Details */}
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{job.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>{job.id}</div>
                  </td>

                  {/* Queue */}
                  <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                    <span style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                      {job.queue}
                    </span>
                  </td>

                  {/* Attempts */}
                  <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                    {job.attempts} / {job.maxAttempts}
                  </td>

                  {/* Run At */}
                  <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                    {new Date(job.runAt).toLocaleTimeString()}
                    {job.status === 'running' && job.lockedAt && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Lease expires: {new Date(job.lockedAt).toLocaleTimeString()}
                      </div>
                    )}
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button 
                        className="btn" 
                        style={{ padding: '4px 8px', fontSize: '12px' }}
                        onClick={() => setSelectedJob(job)}
                      >
                        🔍 Inspect
                      </button>
                      {job.status === 'failed' && (
                        <button 
                          className="btn" 
                          style={{ padding: '4px 8px', fontSize: '12px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)', border: '1px solid var(--error)' }}
                          onClick={() => {
                            setSelectedJob(job);
                          }}
                        >
                          ⚠️ View Error
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Details / Error Inspector Drawer Modal */}
      {selectedJob && (
        <div className="modal-overlay active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="modal-container" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', maxWidth: '640px', width: '90%', padding: '24px', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '16px' }}>
              <div>
                <span 
                  style={{ 
                    padding: '2px 6px', 
                    borderRadius: '4px', 
                    fontSize: '11px', 
                    fontWeight: 600, 
                    marginRight: '8px',
                    background: 'rgba(0,0,0,0.15)',
                    color: getStatusColor(selectedJob.status) 
                  }}
                >
                  {selectedJob.status.toUpperCase()}
                </span>
                <span style={{ fontWeight: 600, fontSize: '16px', color: 'var(--text-primary)' }}>
                  {selectedJob.name}
                </span>
              </div>
              <button 
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '20px', cursor: 'pointer' }}
                onClick={() => setSelectedJob(null)}
              >
                ✕
              </button>
            </div>

            <div style={{ maxHeight: '420px', overflowY: 'auto', textAlign: 'left', fontSize: '13px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 16px', marginBottom: '16px' }}>
                <div style={{ color: 'var(--text-secondary)' }}>Job ID:</div>
                <div style={{ fontFamily: 'var(--font-mono)' }}>{selectedJob.id}</div>

                <div style={{ color: 'var(--text-secondary)' }}>Queue:</div>
                <div>{selectedJob.queue}</div>

                <div style={{ color: 'var(--text-secondary)' }}>Priority:</div>
                <div>{selectedJob.priority}</div>

                <div style={{ color: 'var(--text-secondary)' }}>Execution:</div>
                <div>Attempts: {selectedJob.attempts} of {selectedJob.maxAttempts}</div>
              </div>

              {/* Payload */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>Payload:</div>
                <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', padding: '12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflowX: 'auto' }}>
                  {JSON.stringify(selectedJob.payload, null, 2)}
                </pre>
              </div>

              {/* Error Trace if Failed */}
              {selectedJob.error && (
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--error)', marginBottom: '6px' }}>Error Details:</div>
                  <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', padding: '12px', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid var(--error)', borderRadius: 'var(--radius-md)', color: 'var(--error)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                    {selectedJob.error}
                  </pre>
                </div>
              )}
            </div>

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
              <button className="btn" onClick={() => setSelectedJob(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
