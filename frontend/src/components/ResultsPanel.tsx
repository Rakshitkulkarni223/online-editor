import React from 'react';
import type { RunResponse, TestResult } from '../types';

export function ResultsPanel({ results, onPick }: { results: TestResult[]; onPick: (i: number) => void }) {
  const passed = results.filter(r => r.passed).length;
  if (!results.length) {
    return <div className="output-content"><Empty icon="🧪" title="No tests run" text="Add cases on the left, then press Submit." /></div>;
  }
  return (
    <div className="output-content">
      <div className="score">
        <div><strong>{passed}/{results.length}</strong><span>test cases passed</span></div>
        <div className={passed === results.length ? 'score-good' : 'score-bad'}>
          {passed === results.length ? 'Accepted' : 'Wrong Answer'}
        </div>
      </div>
      {results.map((r, i) => (
        <div className="result-row" key={r.id}>
          <span className={r.passed ? 'dot pass-bg' : 'dot fail-bg'} />
          <div>
            <b>Case {i + 1}{r.hidden ? ' · hidden' : ''}</b>
            <small>{r.passed ? 'Passed' : 'Failed'} {r.time ? `· ${r.time}s` : ''}</small>
          </div>
          <button onClick={() => onPick(i)}>{r.passed ? '✓' : 'View'}</button>
        </div>
      ))}
    </div>
  );
}

export function ConsolePanel({ runResult }: { runResult: RunResponse | null }) {
  return (
    <div className="output-content">
      <div className="console-head">Output</div>
      <pre className="console">{runResult?.stdout || runResult?.stderr || 'Run your program to see stdout/stderr here.'}</pre>
      {runResult && (
        <div className="metrics">
          Status: {runResult.status || 'Done'} · Time: {runResult.time || '—'} · Memory: {runResult.memory ?? '—'} KB
        </div>
      )}
    </div>
  );
}

function Empty({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><strong>{title}</strong><p>{text}</p></div>;
}
