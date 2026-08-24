import React, { useState } from 'react';
import type { AIAction, Language, TestCase } from '../types';
import { api } from '../api';

type Props = {
  code: string;
  language: Language;
  problem: string;
  currentLine?: number;
  tests: TestCase[];
  error: string;
  aiEnabled: boolean;
};

const ACTIONS: { action: AIAction; label: string; icon: string; needsCode: boolean }[] = [
  { action: 'hint', label: 'Hint', icon: '💡', needsCode: true },
  { action: 'approach', label: 'Explain approach', icon: '🧭', needsCode: false },
  { action: 'explain_line', label: 'Explain this line', icon: '📖', needsCode: true },
  { action: 'find_mistake', label: 'Find my mistake', icon: '🐞', needsCode: true },
  { action: 'complexity', label: 'Complexity analysis', icon: '⏱', needsCode: true },
];

export function AITutor(props: Props) {
  const { code, language, problem, currentLine, tests, error, aiEnabled } = props;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const hasCode = code.trim().length > 0 && !code.trim().startsWith('# ⚠️');

  const call = async (action: AIAction) => {
    if (!aiEnabled) { setMsg('AI tutor is not configured on the backend (set AI_API_KEY).'); return; }
    const actionDef = ACTIONS.find(a => a.action === action);
    if (actionDef?.needsCode && !hasCode) {
      setMsg('Write some code first — this action requires your solution.');
      return;
    }
    setBusy(true); setMsg(''); setText('');
    try {
      const res = await api.ai(action, {
        code, language, problem,
        line: action === 'explain_line' ? currentLine : undefined,
        tests: tests.map(t => ({ input: t.input, expected: t.expected })),
        error,
      });
      setText(res.text);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="ai-tutor">
      <div className="ai-actions">
        {ACTIONS.map(a => (
          <button
            key={a.action}
            className="ai-btn"
            disabled={busy || (a.needsCode && !hasCode)}
            onClick={() => call(a.action)}
            title={a.needsCode && !hasCode ? 'Write some code first' : ''}
          >
            <span className="ai-icon">{a.icon}</span> {a.label}
          </button>
        ))}
      </div>
      {busy && <div className="ai-loading">Thinking…</div>}
      {msg && <div className="error-box">{msg}</div>}
      {text && <div className="ai-response">{text}</div>}
      {!text && !busy && !msg && <div className="muted ai-hint">Pick an action above. The AI tutor sees your code, problem, and current line.</div>}
    </div>
  );
}
