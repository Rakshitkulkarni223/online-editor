import React, { useEffect, useRef, useState } from 'react';
import type { Step, VisualResponse } from '../types';
import {
  VariablesPanel, PersistentDSAVisualizer,
} from '../visualizers';

type Props = {
  visual: VisualResponse | null;
  step: number;
  onStep: (n: number) => void;
  code: string;
  testInput?: string;
};

export function DebuggerPanel({ visual, step, onStep, code, testInput = '' }: Props) {
  const [auto, setAuto] = useState(false);
  const [speed, setSpeed] = useState(600);
  const timerRef = useRef<number | null>(null);
  const steps = visual?.steps || [];
  const current = steps[step];

  useEffect(() => {
    if (!auto) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      return;
    }
    if (step >= steps.length - 1) { setAuto(false); return; }
    timerRef.current = window.setInterval(() => {
      onStep(step + 1);
    }, speed);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, step, steps.length, speed]);

  if (!steps.length) {
    return (
      <div className="output-content visualizer">
        <Empty icon="⏱" title="No trace yet" text="Visualization supports Python. Click Visualize to step through execution line by line." />
      </div>
    );
  }

  const lineText = code.split('\n')[Math.max(0, (current?.line || 1) - 1)] || '';

  return (
    <div className="output-content visualizer">
      <div className="viz-head">
        <div><strong>Step {step + 1}</strong><span> of {steps.length}</span></div>
        <div className="viz-controls">
          <button disabled={step === 0} onClick={() => { setAuto(false); onStep(0); }} title="First step">⏮</button>
          <button disabled={step === 0} onClick={() => { setAuto(false); onStep(step - 1); }} title="Previous">←</button>
          <button className={auto ? 'active' : ''} onClick={() => setAuto(a => !a)} title={auto ? 'Pause' : 'Play'}>{auto ? '⏸' : '▶'}</button>
          <button disabled={step === steps.length - 1} onClick={() => { setAuto(false); onStep(step + 1); }} title="Next">→</button>
          <button disabled={step === steps.length - 1} onClick={() => { setAuto(false); onStep(steps.length - 1); }} title="Last step">⏭</button>
          <select className="speed-select" value={speed} onChange={e => setSpeed(Number(e.target.value))} title="Animation speed">
            <option value={1200}>0.5x</option>
            <option value={600}>1x</option>
            <option value={300}>2x</option>
            <option value={150}>4x</option>
          </select>
        </div>
      </div>
      <input className="timeline" type="range" min={0} max={steps.length - 1} value={step} onChange={e => { setAuto(false); onStep(Number(e.target.value)); }} />

      <div className="trace-card">
        <div className="trace-label">EXECUTING LINE {current?.line}</div>
        <pre className="trace-line-code">{lineText}</pre>
      </div>

      <div className="trace-card">
        <div className="trace-label">VISUALIZATION</div>
        <PersistentDSAVisualizer steps={steps} stepIdx={step} testInput={testInput} />
      </div>

      <div className="trace-card">
        <div className="trace-label">LOCAL VARIABLES</div>
        <VariablesPanel step={current} />
      </div>

      {visual?.stdout && (
        <div className="trace-card">
          <div className="trace-label">PROGRAM OUTPUT</div>
          <pre>{visual.stdout}</pre>
        </div>
      )}
      {visual?.stderr && (
        <div className="trace-card error">
          <div className="trace-label">STDERR</div>
          <pre>{visual.stderr}</pre>
        </div>
      )}
    </div>
  );
}

function Empty({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><strong>{title}</strong><p>{text}</p></div>;
}
