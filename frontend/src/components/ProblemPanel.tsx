import React, { useState } from 'react';
import type { ParsedProblem, TestCase, TestResult, Language } from '../types';
import { parseProblem } from '../problemParser';

type Props = {
  problem: string;
  onProblem: (s: string) => void;
  parsed: ParsedProblem | null;
  onParsed: (p: ParsedProblem | null) => void;
  tests: TestCase[];
  onTests: (t: TestCase[]) => void;
  results: TestResult[];
  activeTest: number;
  onActiveTest: (i: number) => void;
  onRunOne: (i: number) => void;
  language: Language;
  onUseSignature: (code: string) => void;
  parseError: string;
  genTestsLoading: boolean;
  onGenerateTests: () => void;
  onCancelGenerate: () => void;
  initialPreview?: boolean; // start in preview mode (for sidebar loads)
  aiTitle?: string; // AI-generated human-readable title
};

let nextId = 100;

export function ProblemPanel(props: Props) {
  const { problem, onProblem, parsed, onParsed, tests, onTests, results, activeTest, onActiveTest, onRunOne, onUseSignature, parseError, genTestsLoading, onGenerateTests, onCancelGenerate, initialPreview, aiTitle } = props;
  const [showRaw, setShowRaw] = useState(!initialPreview);

  // Generate: parse the problem, show preview, and trigger AI code stub + test cases
  const doGenerate = () => {
    try {
      const p = parseProblem(problem);
      onParsed(p);
      setShowRaw(false);
    } catch (e) {
      onParsed({
        title: 'Invalid Problem',
        description: '',
        examples: [],
        constraints: [],
      });
    }
  };

  // Edit: go back to the raw textarea
  const doEdit = () => setShowRaw(true);

  const addTest = () => onTests([...tests, { id: nextId++, input: '', expected: '' }]);
  const updateTest = (i: number, key: keyof TestCase, value: string | boolean) =>
    onTests(tests.map((t, idx) => (idx === i ? { ...t, [key]: value } : t)));
  const deleteTest = (i: number) => onTests(tests.filter((_, idx) => idx !== i));

  return (
    <aside className="problem-panel">
      <div className="panel-header">
        <span>Problem</span>
        <div className="panel-header-actions">
          {showRaw ? (
            <button className="icon-button" onClick={doGenerate} title="Parse problem, generate code stub & test cases">Generate</button>
          ) : (
            <button className="icon-button" onClick={doEdit} title="Edit raw problem text">Edit</button>
          )}
        </div>
      </div>

      {showRaw ? (
        <textarea value={problem} onChange={e => onProblem(e.target.value)} className="problem-editor" placeholder="Paste a LeetCode problem here — test cases & code stub auto-generate." />
      ) : parsed ? (
        <div className="parsed-problem">
          <h3 className="problem-title">{aiTitle || parsed.title}</h3>
          {parseError ? (
            <div className="parse-error-box">⚠️ {parseError}</div>
          ) : (
            <p className="problem-desc">{parsed.description}</p>
          )}
          {parsed.examples.length > 0 && (
            <div className="parsed-section">
              <div className="section-heading"><span>Examples</span></div>
              {parsed.examples.map((ex, i) => (
                <div key={i} className="example-card">
                  <b>Example {i + 1}</b>
                  <div><span className="ex-label">Input:</span> <code>{ex.input}</code></div>
                  <div><span className="ex-label">Output:</span> <code>{ex.output}</code></div>
                  {ex.explanation && <div><span className="ex-label">Explanation:</span> {ex.explanation}</div>}
                </div>
              ))}
            </div>
          )}
          {parsed.constraints.length > 0 && (
            <div className="parsed-section">
              <div className="section-heading"><span>Constraints</span></div>
              <ul className="constraints-list">
                {parsed.constraints.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
          {parsed.signature && (
            <div className="parsed-section">
              <div className="section-heading"><span>Detected signature</span></div>
              <div className="signature-card">
                <code>{parsed.signature.raw}</code>
                <button className="icon-button" onClick={() => onUseSignature(stubFromSignature(parsed.signature!))}>Use stub</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="muted">Click Parse to extract examples & constraints.</div>
      )}

      <div className="section-heading">
        <span>Test Cases</span>
        <div className="test-actions">
          {genTestsLoading ? (
            <button className="icon-button stop-btn" onClick={onCancelGenerate}>✕ Stop</button>
          ) : (
            <button className="icon-button" onClick={onGenerateTests} disabled={!parsed} title="Generate 10 more test cases with AI">⚡ Generate</button>
          )}
          <button className="icon-button" onClick={addTest} disabled={genTestsLoading}>＋ Add</button>
        </div>
      </div>
      <div className="tests-list">
        {genTestsLoading && (
          <div className="gen-tests-loader">
            <div className="spinner" />
            <span>Generating test cases from problem statement…</span>
          </div>
        )}
        {!genTestsLoading && tests.length === 0 && (
          <div className="muted" style={{ padding: '12px', textAlign: 'center' }}>No test cases yet. Click ⚡ Generate to add 10 cases with AI, or ＋ Add manually.</div>
        )}
        {!genTestsLoading && tests.map((t, i) => (
          <div key={t.id} className={'test-card' + (activeTest === i ? ' active' : '')} onClick={() => onActiveTest(i)}>
            <div className="test-title">
              <span>Case {i + 1}{t.hidden ? ' · hidden' : ''}</span>
              <div className="test-title-actions">
                {results[i] && <span className={results[i].passed ? 'pass' : 'fail'}>{results[i].passed ? '✓' : '×'}</span>}
                <button className="icon-button mini" title="Run this case" onClick={e => { e.stopPropagation(); onRunOne(i); }}>▶</button>
                <button className="icon-button mini" title="Toggle hidden" onClick={e => { e.stopPropagation(); updateTest(i, 'hidden', !t.hidden); }}>{t.hidden ? '👁' : '🙈'}</button>
                <button className="icon-button mini" title="Delete" onClick={e => { e.stopPropagation(); deleteTest(i); }}>✕</button>
              </div>
            </div>
            <label>Input<textarea value={t.input} onChange={e => { e.stopPropagation(); updateTest(i, 'input', e.target.value); }} placeholder="stdin / function input" /></label>
            <label>Expected<textarea value={t.expected} onChange={e => { e.stopPropagation(); updateTest(i, 'expected', e.target.value); }} placeholder="expected stdout" /></label>
            {results[i] && <div className="actual"><b>Actual:</b> {results[i].actual || '∅'}</div>}
          </div>
        ))}
      </div>
    </aside>
  );
}

function stubFromSignature(sig: ParsedProblem['signature']): string {
  if (!sig) return '';
  if (sig.language === 'python') {
    const body = sig.params.length ? '    ' : '    pass';
    return `${sig.raw}\n${body}\n`;
  }
  return sig.raw + '\n';
}
