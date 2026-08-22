import React from 'react';
import type { RunResponse, TestResult } from '../types';

export function ResultsPanel({ results, onPick }: { results: TestResult[]; onPick: (i: number) => void }) {
  // Only count tests that actually have results (have been run)
  const runResults = results.filter(r => r && r.actual !== undefined && r.actual !== '');
  const passed = runResults.filter(r => r.passed).length;
  if (!runResults.length) {
    return <div className="output-content"><Empty icon="🧪" title="No tests run" text="Add cases on the left, then press Submit." /></div>;
  }
  const allPassed = passed === runResults.length;
  return (
    <div className="output-content">
      <div className="score">
        <div><strong>{passed}/{runResults.length}</strong><span>test cases passed</span></div>
        <div className={allPassed ? 'score-good' : 'score-bad'}>
          {allPassed ? 'Accepted' : 'Wrong Answer'}
        </div>
      </div>
      {results.map((r, i) => r && r.actual !== undefined && r.actual !== '' && (
        <div className="result-row" key={r.id}>
          <span className={r.passed ? 'dot pass-bg' : 'dot fail-bg'} />
          <div>
            <b>Case {i + 1}</b>
            <small>{r.passed ? 'Passed' : 'Failed'} {r.time ? `· ${r.time}s` : ''}</small>
          </div>
          <button onClick={() => onPick(i)}>{r.passed ? '✓' : 'View'}</button>
        </div>
      ))}
    </div>
  );
}

export function ConsolePanel({ runResult, expected, activeTest }: { runResult: RunResponse | null; expected?: string; activeTest?: number }) {
  const isWrong = runResult?.status === 'Wrong Answer';
  const isAccepted = runResult?.status === 'Accepted';
  return (
    <div className="output-content">
      {runResult && (
        <div className={`run-status ${isAccepted ? 'accepted' : isWrong ? 'wrong' : ''}`}>
          {isAccepted ? '✓ Accepted' : isWrong ? '✕ Wrong Answer' : runResult.status || 'Done'}
        </div>
      )}
      <div className="console-head">Your Output</div>
      <pre className="console">{runResult?.stdout || runResult?.stderr || 'Run your program to see output here.'}</pre>
      {isWrong && expected !== undefined && (
        <>
          <div className="console-head expected">Expected Output</div>
          <pre className="console expected">{expected || '(empty)'}</pre>
        </>
      )}
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
