import React, { useEffect, useMemo, useState } from 'react';
import { api, type SavedProblem } from '../api';

type Props = {
  collapsed: boolean;
  onToggle: () => void;
  onLoadProblem: (p: SavedProblem) => void;
  onNewProblem: () => void;
  onDeleteProblem: (id: number) => void;
  refreshKey: number;
  currentProblemId: number | null;
};

const STATUS_COLORS: Record<string, string> = {
  solved: '#4caf50',
  in_progress: '#ffa726',
  failed: '#ef5350',
};

const STATUS_LABELS: Record<string, string> = {
  solved: 'Solved',
  in_progress: 'In Progress',
  failed: 'Failed',
};

const STATUS_ICONS: Record<string, string> = {
  solved: '✓',
  in_progress: '◐',
  failed: '✕',
};

export function Sidebar(props: Props) {
  const { collapsed, onToggle, onLoadProblem, onNewProblem, onDeleteProblem, refreshKey, currentProblemId } = props;
  const [problems, setProblems] = useState<SavedProblem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    try {
      if (collapsed) return;
      setLoading(true);
      api.listProblems()
        .then(res => setProblems(res.problems))
        .catch(() => setProblems([]))
        .finally(() => setLoading(false));
    } catch { /* ignore */ }
  }, [collapsed, refreshKey]);

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    try {
      e.stopPropagation();
      await api.deleteProblem(id);
      setProblems(prev => prev.filter(p => p.id !== id));
      onDeleteProblem(id);
    } catch { /* ignore */ }
  };

  const handleLoad = async (p: SavedProblem) => {
    try {
      const full = await api.getProblem(p.id);
      onLoadProblem(full);
      onToggle(); // collapse sidebar after selecting a problem
    } catch { /* ignore */ }
  };

  const filtered = useMemo(() => {
    try {
      if (!search.trim()) return problems;
      const q = search.toLowerCase();
      return problems.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.status.toLowerCase().includes(q) ||
        (p.language || '').toLowerCase().includes(q)
      );
    } catch { return problems; }
  }, [problems, search]);

  const solved = problems.filter(p => p.status === 'solved').length;

  return (
    <>
      {/* Floating toggle button — always visible */}
      <button
        className={`sidebar-toggle-btn ${!collapsed ? 'active' : ''}`}
        onClick={onToggle}
        title={collapsed ? 'Show problem list' : 'Hide problem list'}
      >
        {collapsed ? '≡' : '✕'}
      </button>

      {/* Backdrop — click to close */}
      {!collapsed && <div className="sidebar-backdrop" onClick={onToggle} />}

      {/* Sidebar panel — slides in/out */}
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        {/* Header */}
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="sidebar-brand-icon">≡</span>
            <span className="sidebar-brand-text">Problems</span>
          </div>
        </div>

        {/* New Problem button */}
        <button className="sidebar-new-btn" onClick={() => { onNewProblem(); onToggle(); }}>
          <span className="sidebar-new-icon">+</span>
          <span>New Problem</span>
        </button>

        {/* Search box */}
        {problems.length > 0 && (
          <div className="sidebar-search">
            <span className="sidebar-search-icon">🔍</span>
            <input
              type="text"
              className="sidebar-search-input"
              placeholder="Search problems..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="sidebar-search-clear" onClick={() => setSearch('')}>✕</button>
            )}
          </div>
        )}

        {/* Stats bar */}
        {problems.length > 0 && (
          <div className="sidebar-stats">
            <span className="sidebar-stat">
              <span className="sidebar-stat-num">{solved}</span>
              <span className="sidebar-stat-label">Solved</span>
            </span>
            <span className="sidebar-stat">
              <span className="sidebar-stat-num">{problems.length - solved}</span>
              <span className="sidebar-stat-label">Remaining</span>
            </span>
            <span className="sidebar-stat">
              <span className="sidebar-stat-num">{problems.length}</span>
              <span className="sidebar-stat-label">Total</span>
            </span>
          </div>
        )}

        {/* Problem list */}
        <div className="sidebar-list">
          {loading && (
            <div className="sidebar-empty">
              <div className="sidebar-empty-icon">⟳</div>
              <span>Loading…</span>
            </div>
          )}
          {!loading && problems.length === 0 && (
            <div className="sidebar-empty">
              <div className="sidebar-empty-icon">📋</div>
              <span>No problems yet</span>
              <span className="sidebar-empty-sub">Click "New Problem" to start</span>
            </div>
          )}
          {!loading && problems.length > 0 && filtered.length === 0 && (
            <div className="sidebar-empty">
              <div className="sidebar-empty-icon">🔍</div>
              <span>No matches found</span>
              <span className="sidebar-empty-sub">Try a different search</span>
            </div>
          )}
          {!loading && filtered.map((p, idx) => (
            <div
              key={p.id}
              className={`sidebar-item ${currentProblemId === p.id ? 'active' : ''}`}
              onClick={() => handleLoad(p)}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setTooltip({ text: p.title, x: rect.right + 8, y: rect.top + rect.height / 2 });
              }}
              onMouseLeave={() => setTooltip(null)}
            >
              <span className="sidebar-item-num">{idx + 1}</span>
              <div className="sidebar-item-status" style={{ background: STATUS_COLORS[p.status] || '#666' }}>
                {STATUS_ICONS[p.status] || '○'}
              </div>
              <div className="sidebar-item-info">
                <div className="sidebar-item-title">{p.title}</div>
                <div className="sidebar-item-meta">
                  <span className={`sidebar-item-badge ${p.status}`}>
                    {STATUS_LABELS[p.status] || p.status}
                  </span>
                  {p.total > 0 && <span className="sidebar-item-tests">{p.passed}/{p.total} tests</span>}
                </div>
              </div>
              <button
                className="sidebar-item-delete"
                onClick={(e) => handleDelete(e, p.id)}
                title="Delete"
              >
                <span>🗑</span>
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Floating tooltip — fixed position so it's never clipped */}
      {tooltip && (
        <div
          className="sidebar-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </>
  );
}
