import React, { useEffect, useRef, useState } from 'react';
import type { TestResponse } from '../types';

type Props = {
  active: boolean;
  onToggle: () => void;
  onSubmit: () => Promise<TestResponse | null>;
  onReveal: () => void;
  minutesDefault?: number;
};

export function InterviewBar({ active, onToggle, onSubmit, onReveal, minutesDefault = 30 }: Props) {
  const [seconds, setSeconds] = useState(minutesDefault * 60);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setRunning(false); setResult(null); setSeconds(minutesDefault * 60);
      if (timerRef.current) window.clearInterval(timerRef.current);
      return;
    }
  }, [active, minutesDefault]);

  useEffect(() => {
    if (!running) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      return;
    }
    timerRef.current = window.setInterval(() => {
      setSeconds(s => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [running]);

  if (!active) return null;
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  const low = seconds <= 60;

  const submit = async () => {
    setBusy(true);
    try {
      const r = await onSubmit();
      setResult(r);
      onReveal();
    } finally { setBusy(false); }
  };

  return (
    <div className="interview-bar">
      <div className="iv-left">
        <span className="iv-badge">INTERVIEW</span>
        <span className={'iv-timer' + (low ? ' low' : '')}>⏱ {mm}:{ss}</span>
        <button onClick={() => setRunning(r => !r)}>{running ? 'Pause' : 'Start'}</button>
        <button onClick={() => setSeconds(minutesDefault * 60)}>Reset</button>
      </div>
      <div className="iv-right">
        {result && (
          <span className={'iv-score' + (result.passed === result.total ? ' good' : ' bad')}>
            Score: {result.passed}/{result.total} {result.passed === result.total ? '— Strong' : '— Review gaps'}
          </span>
        )}
        <button className="success" onClick={submit} disabled={busy}>{busy ? 'Grading…' : 'Submit & Reveal'}</button>
        <button className="secondary" onClick={onToggle}>Exit</button>
      </div>
      {result && <InterviewFeedback result={result} />}
    </div>
  );
}

function InterviewFeedback({ result }: { result: TestResponse }) {
  const passRate = result.total ? result.passed / result.total : 0;
  const failed = result.results.filter(r => !r.passed);
  const tips: string[] = [];
  if (passRate === 1) tips.push('All test cases pass. Discuss time/space complexity and edge cases aloud.');
  else {
    tips.push(`${failed.length} case(s) failed. Re-check logic for the failing inputs before optimizing.`);
    if (failed.some(r => r.error)) tips.push('There are runtime/compile errors — fix those first.');
  }
  if (passRate < 0.5) tips.push('Consider asking clarifying questions and walking through an example by hand first.');
  return (
    <div className="iv-feedback">
      <strong>Interviewer feedback</strong>
      <ul>{tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}
