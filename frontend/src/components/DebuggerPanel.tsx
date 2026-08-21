import React, { useEffect, useRef, useState } from 'react';
import type { Step, VisualResponse } from '../types';
import {
  VariablesPanel, CallStackView, DSAVisualizer, detectDSA,
} from '../visualizers';

type Props = {
  visual: VisualResponse | null;
  step: number;
  onStep: (n: number) => void;
  code: string;
};

export function DebuggerPanel({ visual, step, onStep, code }: Props) {
  const [auto, setAuto] = useState(false);
  const timerRef = useRef<number | null>(null);
  const steps = visual?.steps || [];
  const current = steps[step];
  const detection = current ? detectDSA(current.locals) : null;

  useEffect(() => {
    if (!auto) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      return;
    }
    if (step >= steps.length - 1) { setAuto(false); return; }
    timerRef.current = window.setInterval(() => {
      onStep(step + 1);
    }, 600);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, step, steps.length]);

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
          <button disabled={step === 0} onClick={() => { setAuto(false); onStep(0); }}>⏮</button>
          <button disabled={step === 0} onClick={() => { setAuto(false); onStep(step - 1); }}>←</button>
          <button disabled={step === steps.length - 1} onClick={() => { setAuto(false); onStep(step + 1); }}>→</button>
          <button disabled={step === steps.length - 1} onClick={() => { setAuto(false); onStep(steps.length - 1); }}>⏭</button>
          <button className={auto ? 'active' : ''} onClick={() => setAuto(a => !a)}>{auto ? '⏸ Pause' : '▶ Auto'}</button>
        </div>
      </div>
      <input className="timeline" type="range" min={0} max={steps.length - 1} value={step} onChange={e => { setAuto(false); onStep(Number(e.target.value)); }} />

      <div className="trace-card">
        <div className="trace-label">EXECUTING LINE {current?.line}</div>
        <pre className="trace-line-code">{lineText}</pre>
      </div>

      {detection && detection.kind !== 'none' && (
        <div className="trace-card">
          <div className="trace-label">DSA VISUALIZER</div>
          <DSAVisualizer locals={current!.locals} detection={detection} />
        </div>
      )}

      <div className="trace-card">
        <div className="trace-label">LOCAL VARIABLES</div>
        <VariablesPanel step={current} />
      </div>

      <div className="trace-card">
        <div className="trace-label">CALL STACK</div>
        <CallStackView stack={current?.callStack || []} />
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
