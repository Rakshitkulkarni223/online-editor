import React, { useState } from 'react';
import Editor, { OnMount, loader } from '@monaco-editor/react';
import * as monacoEditor from 'monaco-editor';
import type * as Monaco from 'monaco-editor';
import type { Language, Step } from '../types';
import { isPyodideReady } from '../pyodideCompletions';

// Use local monaco-editor instead of CDN — ensures all language services are loaded
loader.config({ monaco: monacoEditor });

type Theme = 'codetrace-dark' | 'vs-dark' | 'vs-light';

type Props = {
  language: Language;
  code: string;
  fontSize: number;
  onCodeChange: (v: string) => void;
  onLanguageChange: (l: Language) => void;
  onFontSize: (n: number) => void;
  onMount: (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => void;
  onReset: () => void;
  onRun: () => void;
  currentStep?: Step;
  interviewHidden?: boolean;
  sigLoading?: boolean;
};

export function EditorPanel(props: Props) {
  const { language, code, fontSize, onCodeChange, onLanguageChange, onFontSize, onMount, onReset, onRun, currentStep, interviewHidden, sigLoading } = props;
  const [theme, setTheme] = useState<Theme>('codetrace-dark');
  const [pyodideStatus, setPyodideStatus] = useState<'loading' | 'ready' | 'off'>('off');

  // Poll for Pyodide readiness when language is Python
  React.useEffect(() => {
    if (language !== 'python') { setPyodideStatus('off'); return; }
    setPyodideStatus('loading');
    const interval = setInterval(() => {
      if (isPyodideReady()) { setPyodideStatus('ready'); clearInterval(interval); }
    }, 500);
    return () => clearInterval(interval);
  }, [language]);

  return (
    <section className="editor-panel">
      <div className="editor-toolbar">
        <select value={language} onChange={e => onLanguageChange(e.target.value as Language)} disabled={interviewHidden}>
          <option value="python">Python 3</option>
          <option value="javascript">JavaScript</option>
          <option value="java">Java</option>
          <option value="cpp">C++</option>
        </select>
        <div className="editor-tools">
          <select value={theme} onChange={e => setTheme(e.target.value as Theme)} title="Editor theme">
            <option value="codetrace-dark">Dark+</option>
            <option value="vs-dark">Dark</option>
            <option value="vs-light">Light</option>
          </select>
          <button onClick={onReset} title="Reset code to stub" disabled={interviewHidden}>↺</button>
          <button onClick={onRun} title="Run code" disabled={interviewHidden}>▶</button>
        </div>
      </div>
      <div className="editor-wrap">
        {interviewHidden ? (
          <div className="editor-locked">
            <div className="lock-icon">🔒</div>
            <strong>Solution hidden — Interview Mode</strong>
            <p>Write your answer on paper or a scratch file. Submit when ready to reveal & score.</p>
          </div>
        ) : (
          <>
            {sigLoading && (
              <div className="sig-banner">
                <div className="spinner" />
                <span>AI is identifying the function name &amp; arguments…</span>
              </div>
            )}
            <Editor
              height="100%"
              theme={theme}
              language={language === 'cpp' ? 'cpp' : language}
              value={code}
              onChange={v => onCodeChange(v || '')}
              onMount={onMount}
              options={{
                fontSize, minimap: { enabled: false }, padding: { top: 14 },
                smoothScrolling: true, scrollBeyondLastLine: false, glyphMargin: true,
                automaticLayout: true, tabSize: 4,
                suggestOnTriggerCharacters: true,
                acceptSuggestionOnEnter: 'on',
                tabCompletion: 'on',
                wordBasedSuggestions: 'allDocuments',
                suggest: {
                  showWords: true, showSnippets: true, showFunctions: true,
                  showVariables: true, showKeywords: true, showValues: true,
                  showClasses: true, showModules: true, showStructs: true,
                  showInterfaces: true, showMethods: true, showConstructors: true,
                  showEnums: true, showEnumMembers: true, showColors: true,
                  showFiles: true, showReferences: true, showFolders: true,
                  showTypeParameters: true, showIssues: true, showUsers: true,
                  insertMode: 'insert',
                },
                quickSuggestions: { other: true, comments: true, strings: true },
                quickSuggestionsDelay: 100,
                parameterHints: { enabled: true },
                bracketPairColorization: { enabled: true },
                guides: { bracketPairs: true, indentation: true },
                cursorBlinking: 'smooth',
                renderLineHighlight: 'all',
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                fontLigatures: false,
                lineHeight: 24,
                cursorWidth: 2,
              }}
            />
          </>
        )}
      </div>
      <div className="editor-status">
        {sigLoading ? (
          <span className="sig-loading"><div className="spinner" /> AI refining signature…</span>
        ) : (
          <span>● Ready</span>
        )}
        {pyodideStatus === 'loading' && <span className="pyodide-status loading">⟳ Loading Python IntelliSense…</span>}
        {pyodideStatus === 'ready' && <span className="pyodide-status ready">✓ Jedi IntelliSense</span>}
        <span>Ln {currentStep?.line || 1}, Col 1</span>
        <span>Spaces: 4</span>
        <span>{language}</span>
      </div>
    </section>
  );
}
