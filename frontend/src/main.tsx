import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type * as Monaco from 'monaco-editor';
import type {
  Language, ParsedProblem, RunResponse, Step, TestCase, TestResult, TestResponse, VisualResponse,
} from './types';
import { api } from './api';
import { EditorPanel } from './components/EditorPanel';
import { ProblemPanel } from './components/ProblemPanel';
import { DebuggerPanel } from './components/DebuggerPanel';
import { ResultsPanel, ConsolePanel } from './components/ResultsPanel';
import { AITutor } from './components/AITutor';
import { InterviewBar } from './components/InterviewBar';
import { Sidebar } from './components/Sidebar';
import { Splitter } from './components/Splitter';
import { initPyodideCompletions, getPyodideCompletions, isPyodideReady } from './pyodideCompletions';
import type { SavedProblem } from './api';
import { inferParams, inferParamsFromDescription, inferFunctionName, buildSolutionStub, buildHarness, withHarness, buildTestCasesFromExamples, validateProblem, parseProblem } from './problemParser';
import './style.css';

/**
 * Repair common AI JSON issues:
 * - Missing opening `{"` (AI drops it, e.g. `function_name": "add", ...}`)
 * - Missing closing brace
 * - Extra text before/after the JSON object
 * - Trailing commas
 */
function repairJSON(raw: string): any {
  let s = raw.trim();
  // Strip markdown code fences
  const fenceMatch = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) s = fenceMatch[1].trim();
  // If it doesn't start with { or [, the AI likely dropped the opening brace+quote
  // e.g. `function_name": "add", "params": [...]}`  →  `{"function_name": "add", "params": [...]}`
  if (!s.startsWith('{') && !s.startsWith('[')) {
    // Check if it starts with a key that has a closing quote but no opening quote
    // Pattern: word followed by ": (e.g. function_name":)
    const keyMatch = s.match(/^(\w+)\s*":/);
    if (keyMatch) {
      // Prepend {" to fix the missing opening brace and quote
      s = '{"' + s;
    } else if (/^\w+\s*:/.test(s)) {
      // Key with no quotes at all: word: "value"
      s = '{"' + s.replace(/^(\w+)\s*:/, '$1":');
    } else {
      // Just prepend {
      s = '{' + s;
    }
  }
  // Ensure balanced braces
  const openBraces = (s.match(/{/g) || []).length;
  const closeBraces = (s.match(/}/g) || []).length;
  if (closeBraces > openBraces) s = '{' + s;
  if (openBraces > closeBraces) s = s + '}';
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(s);
}

const starter: Record<Language, string> = {
  python: `# Paste a problem statement on the left and click Parse to get started.\n`,
  javascript: `// Paste a problem statement on the left and click Parse to get started.\n`,
  java: `// Paste a problem statement on the left and click Parse to get started.\n`,
  cpp: `// Paste a problem statement on the left and click Parse to get started.\n`,
};

// The default code template shown when a problem is parsed — Reset restores this
const defaultCode: Record<Language, string> = {
  python: `# Write your solution here\n    pass\n`,
  javascript: `// Write your solution here\n`,
  java: `// Write your solution here\n`,
  cpp: `// Write your solution here\n`,
};

const DEFAULT_PROBLEM = '';

/** Convert camelCase to Title Case (e.g. "twoSum" → "Two Sum", "maxSubArray" → "Max Sub Array") */
function camelToTitle(name: string): string {
  if (!name) return '';
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

let nextId = 1;

function App() {
  const [problem, setProblem] = useState(DEFAULT_PROBLEM);
  const [parsed, setParsed] = useState<ParsedProblem | null>(null);
  const [language, setLanguage] = useState<Language>('python');
  const [code, setCode] = useState(starter.python);
  const [harness, setHarness] = useState(''); // hidden test harness, appended only for backend calls
  const [tests, setTests] = useState<TestCase[]>([]);
  const [activeTest, setActiveTest] = useState(0);
  const [tab, setTab] = useState<'tests' | 'console' | 'debugger' | 'ai'>('tests');
  const [results, setResults] = useState<TestResult[]>([]);
  const [runResult, setRunResult] = useState<RunResponse | null>(null);
  const [visual, setVisual] = useState<VisualResponse | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fontSize, setFontSize] = useState(14);
  const [interview, setInterview] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [parseError, setParseError] = useState('');
  const [genTestsLoading, setGenTestsLoading] = useState(false);
  const [sigLoading, setSigLoading] = useState(false); // AI signature refinement
  const [parseCount, setParseCount] = useState(0); // increments on each Parse to reset child components
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true); // overlay — starts collapsed
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [currentProblemId, setCurrentProblemId] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [panelKey, setPanelKey] = useState(0); // forces ProblemPanel remount on sidebar load
  const [functionName, setFunctionName] = useState(''); // AI-generated function name for title
  const [problemTitle, setProblemTitle] = useState(''); // AI-generated human-readable title
  const [panelPreview, setPanelPreview] = useState(false); // start ProblemPanel in preview mode on next mount
  const [showNoTestsModal, setShowNoTestsModal] = useState(false); // popup when Run/Submit with no tests
  const [toast, setToast] = useState<{ msg: string; type: 'error' | 'info' } | null>(null);
  const [panelWidths, setPanelWidths] = useState({ left: 27, middle: 45, right: 28 }); // percentages

  // Show a toast that auto-dismisses after 3s
  const showToast = (msg: string, type: 'error' | 'info' = 'error') => {
    try {
      setToast({ msg, type });
      setTimeout(() => setToast(null), 3000);
    } catch { /* ignore */ }
  };

  // Splitter drag handlers — adjust panel widths in percentages
  const onDragLeft = (delta: number) => {
    try {
      const ws = document.querySelector('.workspace') as HTMLElement;
      if (!ws) return;
      const totalPx = ws.offsetWidth;
      const deltaPct = (delta / totalPx) * 100;
      setPanelWidths(prev => {
        const left = Math.max(15, Math.min(50, prev.left + deltaPct));
        const middle = Math.max(20, Math.min(60, prev.middle - deltaPct));
        return { left, middle, right: 100 - left - middle };
      });
    } catch { /* ignore */ }
  };
  const onDragRight = (delta: number) => {
    try {
      const ws = document.querySelector('.workspace') as HTMLElement;
      if (!ws) return;
      const totalPx = ws.offsetWidth;
      const deltaPct = (delta / totalPx) * 100;
      setPanelWidths(prev => {
        const middle = Math.max(20, Math.min(60, prev.middle + deltaPct));
        const right = Math.max(15, Math.min(50, prev.right - deltaPct));
        return { left: 100 - middle - right, middle, right };
      });
    } catch { /* ignore */ }
  };

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);

  // Set code programmatically AND clear Monaco's undo stack so Cmd+Z
  // doesn't jump back through AI-generated stubs, loaded problems, or resets.
  const setCodeAndClearHistory = (newCode: string) => {
    try {
      setCode(newCode);
      // Use Monaco's setValue which resets the undo/redo stack entirely
      requestAnimationFrame(() => {
        try {
          const editor = editorRef.current;
          if (!editor) return;
          const model = editor.getModel();
          if (!model) return;
          // setValue wipes the entire undo history
          model.setValue(newCode);
          // Mark a clean boundary so undo starts fresh from here
          model.pushStackElement();
        } catch { /* ignore */ }
      });
    } catch { /* ignore */ }
  };
  const decorationsRef = useRef<string[]>([]);
  const lastAutoGenRef = useRef(''); // dedup key: serialized examples content
  const problemChangedRef = useRef(false); // skip auto-gen on initial load
  const genAbortRef = useRef<AbortController | null>(null); // cancel AI test generation
  const sigAbortRef = useRef<AbortController | null>(null); // cancel AI signature generation
  const loadingFromSidebarRef = useRef(false); // skip Parse effect when loading from sidebar
  const currentProblemIdRef = useRef<number | null>(null); // immediate ID tracking for auto-save dedup
  const savingRef = useRef(false); // prevent concurrent saves
  // Refs that always have the latest values for auto-save (avoids stale closures)
  const problemRef = useRef('');
  const codeRef = useRef('');
  const parsedRef = useRef<ParsedProblem | null>(null);
  const resultsRef = useRef<TestResult[]>([]);
  const languageRef = useRef<Language>('python');
  const testsRef = useRef<TestCase[]>([]);
  const stubCodeRef = useRef(''); // the AI-generated stub to restore on Reset

  useEffect(() => { api.health().then(h => setAiEnabled(!!h.ai)).catch(() => {}); }, []);

  // Keep refs in sync with state for auto-save (avoids stale closures)
  useEffect(() => { problemRef.current = problem; }, [problem]);
  useEffect(() => { codeRef.current = code; }, [code]);
  useEffect(() => { parsedRef.current = parsed; }, [parsed]);
  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { languageRef.current = language; }, [language]);
  useEffect(() => { testsRef.current = tests; }, [tests]);

  // On Parse: generate code stub + AI-refined signature.
  // Test cases are NOT auto-created — user must click ⚡ Generate.
  useEffect(() => {
    if (!parsed) return;
    // Skip when loading from sidebar — code is already set
    if (loadingFromSidebarRef.current) {
      loadingFromSidebarRef.current = false;
      return;
    }
    // Skip the initial placeholder parsed object (invalid problem with empty description)
    if (!parsed.description && !parsed.title) return;

    // Case 3: Invalid problem — show error in editor
    const validationError = validateProblem(parsed);
    if (validationError) {
      setParseError(validationError);
      setCode(`# ⚠️ ${validationError}\n#\n# Paste a valid problem statement with a description,\n# examples, and constraints, then click Parse.\n`);
      setHarness('');
      setTests([]);
      setResults([]);
      return;
    }

    setParseError(''); // clear any previous error

    // Clear the editor — don't write anything until AI responds
    setCode('');
    setHarness('');
    setLanguage('python');

    // Extract examples from the problem and add as test cases
    const exampleTests = buildTestCasesFromExamples(parsed.examples);
    const initialTests = exampleTests.map(t => ({ id: nextId++, input: t.input, expected: t.expected }));
    testsRef.current = initialTests;
    setTests(initialTests);

    // Clear everything: results, console, AI tutor, visualizer
    setResults([]);
    setRunResult(null);
    setVisual(null);
    setStep(0);
    setError('');
    setGenTestsLoading(false);
    genAbortRef.current?.abort();

    // Show loading indicator while AI identifies the function name + arguments
    setSigLoading(true);
    setParseCount(c => c + 1); // reset AI Tutor and other child components
  }, [parsed]);

  // Step 2 (separate effect): AI signature refinement.
  // Runs AFTER the heuristic code + loading indicator are rendered.
  // A small delay ensures the user sees the heuristic code before AI replaces it.
  useEffect(() => {
    if (!sigLoading || !parsed) return;
    sigAbortRef.current?.abort();
    sigAbortRef.current = new AbortController();
    const ac = sigAbortRef.current;
    // Send the FULL problem text (including examples + constraints) so AI can infer params
    const fullProblem = problemRef.current || `${parsed.title}\n${parsed.description}`;
    (async () => {
      try {
        const res = await api.ai('gen_signature', {
          code: '', language: 'python',
          problem: fullProblem,
        }, ac.signal);
        const obj = repairJSON(res.text);
        if (obj.title) setProblemTitle(obj.title);
        if (obj.function_name && Array.isArray(obj.params) && obj.params.length > 0) {
          const stub = buildSolutionStub(obj.params, obj.function_name);
          setCodeAndClearHistory(stub);
          stubCodeRef.current = stub;
          setHarness(buildHarness(obj.function_name));
          setFunctionName(obj.function_name);
        } else {
          // AI didn't return a valid signature — fall back to heuristic parser
          const funcName = inferFunctionName(parsed.description || parsed.title);
          let params: { name: string; type: string }[] = [];
          if (parsed.examples.length > 0) params = inferParams(parsed.examples[0].input);
          if (params.length === 0) params = inferParamsFromDescription(parsed.description);
          const stubParams = params.length > 0 ? params : [{ name: 'data', type: 'int' }];
          const stub = buildSolutionStub(stubParams, funcName);
          setCodeAndClearHistory(stub);
          stubCodeRef.current = stub;
          setHarness(buildHarness(funcName));
          setFunctionName(funcName);
        }
      } catch (e) {
        // AI failed or was cancelled — fall back to heuristic parser
        console.warn('[Parse] AI signature generation failed, using heuristic:', e);
        const funcName = inferFunctionName(parsed.description || parsed.title);
        let params: { name: string; type: string }[] = [];
        if (parsed.examples.length > 0) params = inferParams(parsed.examples[0].input);
        if (params.length === 0) params = inferParamsFromDescription(parsed.description);
        const stubParams = params.length > 0 ? params : [{ name: 'data', type: 'int' }];
        const stub = buildSolutionStub(stubParams, funcName);
        setCodeAndClearHistory(stub);
        stubCodeRef.current = stub;
        setHarness(buildHarness(funcName));
        setFunctionName(funcName);
      }
      finally { setSigLoading(false); }
    })();
  }, [sigLoading, parsed]);

  // Generate test cases (+ stub if no examples) via AI — triggered by the ⚡ Generate button.
  // Shows whenever there are zero test cases. Can be cancelled via the ✕ Stop button.
  const generateTests = async () => {
    if (!parsed) return;
    setTests([]);
    setResults([]);
    setGenTestsLoading(true);
    genAbortRef.current?.abort();
    genAbortRef.current = new AbortController();
    const ac = genAbortRef.current;
    try {
      if (parsed.examples.length > 0) {
        const res = await api.ai('gen_tests', {
          code: '', language: 'python',
          problem: parsed.description || parsed.title,
        }, ac.signal);
        // gen_tests returns a JSON array — repair and parse
        let raw = res.text.trim();
        const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (fenceMatch) raw = fenceMatch[1].trim();
        // Remove trailing commas and extract array
        raw = raw.replace(/,\s*([}\]])/g, '$1');
        const arrMatch = raw.match(/\[[\s\S]*\]/);
        if (arrMatch) raw = arrMatch[0];
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length > 0) {
          setTests(arr.map((g: { input: string; expected: string }) => ({
            id: nextId++, input: g.input, expected: g.expected,
          })));
          setActiveTest(0);
          setResults([]);
        }
      } else {
        const res = await api.ai('gen_stub_and_tests', {
          code: '', language: 'python',
          problem: parsed.description || parsed.title,
        }, ac.signal);
        const obj = repairJSON(res.text);
        if (obj.function_name && Array.isArray(obj.params)) {
          setCodeAndClearHistory(buildSolutionStub(obj.params, obj.function_name));
          setHarness(buildHarness(obj.function_name));
          setLanguage('python');
        }
        if (Array.isArray(obj.test_cases) && obj.test_cases.length > 0) {
          setTests(obj.test_cases.map((g: { input: string; expected: string }) => ({
            id: nextId++, input: g.input, expected: g.expected,
          })));
          setActiveTest(0);
          setResults([]);
        }
      }
    } catch { /* AI failed, returned invalid JSON, or was cancelled */ }
    finally { setGenTestsLoading(false); }
  };

  // Cancel ongoing AI test case generation
  const cancelGenerate = () => {
    genAbortRef.current?.abort();
    genAbortRef.current = null;
    setGenTestsLoading(false);
  };

  const highlightStep = useCallback((s: Step | undefined) => {
    try {
      if (!editorRef.current || !monacoRef.current) return;
      decorationsRef.current = editorRef.current.deltaDecorations(
        decorationsRef.current,
        s ? [{
          range: new monacoRef.current.Range(s.line, 1, s.line, 1),
          options: { isWholeLine: true, className: 'trace-current-line', glyphMarginClassName: 'trace-glyph' },
        }] : []
      );
      if (s) editorRef.current.revealLineInCenter(s.line);
    } catch (e) { /* Monaco not ready yet — ignore */ }
  }, []);

  useEffect(() => { highlightStep(visual?.steps?.[step]); }, [step, visual, highlightStep]);

  const onMount = (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Define custom dark theme matching the app
    monaco.editor.defineTheme('codetrace-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '4b5563', fontStyle: 'italic' },
        { token: 'keyword', foreground: '7c9cff' },
        { token: 'string', foreground: '4ade80' },
        { token: 'number', foreground: 'fbbf24' },
        { token: 'type', foreground: 'c084fc' },
        { token: 'function', foreground: '60a5fa' },
        { token: 'variable', foreground: 'e7eaf0' },
        { token: 'identifier', foreground: 'c9d1d9' },
      ],
      colors: {
        'editor.background': '#0d1117',
        'editor.foreground': '#c9d1d9',
        'editorLineNumber.foreground': '#3d4450',
        'editorLineNumber.activeForeground': '#7c9cff',
        'editor.selectionBackground': '#1e3a5a',
        'editor.lineHighlightBackground': '#161b22',
        'editor.lineHighlightBorder': '#00000000',
        'editorCursor.foreground': '#7c9cff',
        'editorIndentGuide.background': '#1a1f28',
        'editorIndentGuide.activeBackground': '#2d333b',
        'editorBracketMatch.background': '#1e3a5a55',
        'editorBracketMatch.border': '#3b82f6',
        'editorSuggestWidget.background': '#161b22',
        'editorSuggestWidget.foreground': '#c9d1d9',
        'editorSuggestWidget.selectedBackground': '#1e3a5a',
        'editorSuggestWidget.highlightForeground': '#7c9cff',
        'editorWidget.background': '#161b22',
        'editorWidget.foreground': '#c9d1d9',
        'editorWidget.border': '#2d333b',
        'scrollbarSlider.background': '#1e253080',
        'scrollbarSlider.hoverBackground': '#2d333b',
      },
    });
    monaco.editor.setTheme('codetrace-dark');

    // ---- Initialize Pyodide + Jedi for Python completions ----
    initPyodideCompletions().catch(() => { /* fail silently */ });

    // ---- Python completion provider using Pyodide + Jedi ----
    const PYTHON_FALLBACK: { label: string; kind: number; insert: string; doc: string }[] = [
      { label: 'def', kind: 14, insert: 'def ${1:name}(${2:args}):\n    ${3:pass}', doc: 'Define a function' },
      { label: 'class', kind: 14, insert: 'class ${1:Name}:\n    def __init__(self):\n        ${2:pass}', doc: 'Define a class' },
      { label: 'if', kind: 14, insert: 'if ${1:condition}:\n    ${2:pass}', doc: 'If statement' },
      { label: 'elif', kind: 14, insert: 'elif ${1:condition}:\n    ${2:pass}', doc: 'Else if' },
      { label: 'else', kind: 14, insert: 'else:\n    ${1:pass}', doc: 'Else clause' },
      { label: 'for', kind: 14, insert: 'for ${1:i} in ${2:range(n)}:\n    ${3:pass}', doc: 'For loop' },
      { label: 'while', kind: 14, insert: 'while ${1:condition}:\n    ${2:pass}', doc: 'While loop' },
      { label: 'try', kind: 14, insert: 'try:\n    ${1:pass}\nexcept ${2:Exception}:\n    ${3:pass}', doc: 'Try-except block' },
      { label: 'return', kind: 14, insert: 'return ', doc: 'Return from function' },
      { label: 'import', kind: 14, insert: 'import ', doc: 'Import module' },
      { label: 'from', kind: 14, insert: 'from ${1:module} import ${2:name}', doc: 'From import' },
      { label: 'lambda', kind: 14, insert: 'lambda ${1:args}: ${2:expr}', doc: 'Lambda function' },
      { label: 'print', kind: 2, insert: 'print($1)', doc: 'Print to stdout' },
      { label: 'len', kind: 2, insert: 'len($1)', doc: 'Length of object' },
      { label: 'range', kind: 2, insert: 'range($1)', doc: 'Range of numbers' },
      { label: 'enumerate', kind: 2, insert: 'enumerate($1)', doc: 'Enumerate iterable' },
      { label: 'zip', kind: 2, insert: 'zip($1)', doc: 'Zip iterables' },
      { label: 'sorted', kind: 2, insert: 'sorted($1)', doc: 'Sorted copy' },
      { label: 'list', kind: 2, insert: 'list($1)', doc: 'List constructor' },
      { label: 'dict', kind: 2, insert: 'dict($1)', doc: 'Dict constructor' },
      { label: 'set', kind: 2, insert: 'set($1)', doc: 'Set constructor' },
      { label: 'int', kind: 2, insert: 'int($1)', doc: 'Integer conversion' },
      { label: 'str', kind: 2, insert: 'str($1)', doc: 'String conversion' },
      { label: 'abs', kind: 2, insert: 'abs($1)', doc: 'Absolute value' },
      { label: 'min', kind: 2, insert: 'min($1)', doc: 'Minimum value' },
      { label: 'max', kind: 2, insert: 'max($1)', doc: 'Maximum value' },
      { label: 'sum', kind: 2, insert: 'sum($1)', doc: 'Sum of iterable' },
      { label: 'self', kind: 4, insert: 'self', doc: 'Instance reference' },
      { label: 'None', kind: 4, insert: 'None', doc: 'None value' },
      { label: 'True', kind: 4, insert: 'True', doc: 'Boolean true' },
      { label: 'False', kind: 4, insert: 'False', doc: 'Boolean false' },
    ];

    // Map Jedi completion types to Monaco CompletionItemKind
    const JEDI_KIND_MAP: Record<string, number> = {
      'module': 9, 'class': 6, 'instance': 6, 'function': 2, 'keyword': 14,
      'statement': 14, 'param': 4, 'property': 7, 'path': 17, 'name': 4,
    };

    try {
      monaco.languages.registerCompletionItemProvider('python', {
        triggerCharacters: ['.', ' ', '('],
        provideCompletionItems: async (model: Monaco.editor.ITextModel, position: Monaco.Position) => {
          try {
            const word = model.getWordUntilPosition(position);
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            };

            // If Pyodide is ready, use Jedi for real completions
            if (isPyodideReady()) {
              const code = model.getValue();
              const completions = await getPyodideCompletions(code, position.lineNumber, position.column - 1);
              if (completions.length > 0) {
                return {
                  suggestions: completions.map((c: any) => ({
                    label: c.name,
                    kind: (JEDI_KIND_MAP[c.type] || 4) as any,
                    insertText: c.complete || c.name,
                    documentation: c.doc || c.type,
                    range: range as any,
                    sortText: '0_' + c.name,
                  })),
                };
              }
            }

            // Fallback to static snippets if Pyodide not ready or no results
            return {
              suggestions: PYTHON_FALLBACK.map(s => ({
                label: s.label,
                kind: s.kind as any,
                insertText: s.insert,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                documentation: s.doc,
                range: range as any,
                sortText: '1_' + s.label,
              })),
            };
          } catch {
            return { suggestions: [] };
          }
        },
      });
    } catch { /* ignore */ }

    // ---- Java & C++ completion providers (static snippets) ----
    const JAVA_SNIPPETS: { label: string; kind: number; insert: string; doc: string }[] = [
      { label: 'public', kind: 14, insert: 'public ', doc: 'Public modifier' },
      { label: 'private', kind: 14, insert: 'private ', doc: 'Private modifier' },
      { label: 'protected', kind: 14, insert: 'protected ', doc: 'Protected modifier' },
      { label: 'static', kind: 14, insert: 'static ', doc: 'Static modifier' },
      { label: 'class', kind: 14, insert: 'class ${1:Name} {\n    ${2}\n}', doc: 'Class definition' },
      { label: 'void', kind: 14, insert: 'void ', doc: 'Void return type' },
      { label: 'if', kind: 14, insert: 'if (${1:condition}) {\n    ${2}\n}', doc: 'If statement' },
      { label: 'else', kind: 14, insert: 'else {\n    ${1}\n}', doc: 'Else clause' },
      { label: 'for', kind: 14, insert: 'for (${1:int i = 0}; ${2:i < n}; ${3:i++}) {\n    ${4}\n}', doc: 'For loop' },
      { label: 'while', kind: 14, insert: 'while (${1:condition}) {\n    ${2}\n}', doc: 'While loop' },
      { label: 'return', kind: 14, insert: 'return ', doc: 'Return statement' },
      { label: 'new', kind: 14, insert: 'new ', doc: 'New object' },
      { label: 'try', kind: 14, insert: 'try {\n    ${1}\n} catch (${2:Exception e}) {\n    ${3}\n}', doc: 'Try-catch block' },
      { label: 'import', kind: 14, insert: 'import ', doc: 'Import statement' },
      { label: 'System.out.println', kind: 2, insert: 'System.out.println($1)', doc: 'Print line' },
      { label: 'Math.max', kind: 2, insert: 'Math.max($1, $2)', doc: 'Maximum' },
      { label: 'Math.min', kind: 2, insert: 'Math.min($1, $2)', doc: 'Minimum' },
      { label: 'Math.abs', kind: 2, insert: 'Math.abs($1)', doc: 'Absolute value' },
      { label: 'Arrays.sort', kind: 2, insert: 'Arrays.sort($1)', doc: 'Sort array' },
      { label: 'ArrayList', kind: 6, insert: 'ArrayList<${1:Integer}>', doc: 'ArrayList type' },
      { label: 'HashMap', kind: 6, insert: 'HashMap<${1:Integer}, ${2:Integer}>', doc: 'HashMap type' },
      { label: 'HashSet', kind: 6, insert: 'HashSet<${1:Integer}>', doc: 'HashSet type' },
      { label: 'String', kind: 6, insert: 'String', doc: 'String type' },
      { label: 'Integer', kind: 6, insert: 'Integer', doc: 'Integer type' },
      { label: 'int', kind: 6, insert: 'int', doc: 'int primitive' },
      { label: 'boolean', kind: 6, insert: 'boolean', doc: 'boolean primitive' },
      { label: 'char', kind: 6, insert: 'char', doc: 'char primitive' },
      { label: 'long', kind: 6, insert: 'long', doc: 'long primitive' },
      { label: 'double', kind: 6, insert: 'double', doc: 'double primitive' },
      { label: 'length', kind: 2, insert: 'length', doc: 'Array length' },
      { label: 'size', kind: 2, insert: 'size()', doc: 'Collection size' },
    ];

    const CPP_SNIPPETS: { label: string; kind: number; insert: string; doc: string }[] = [
      { label: 'include', kind: 14, insert: '#include <${1:iostream}>', doc: 'Include header' },
      { label: 'int', kind: 6, insert: 'int ', doc: 'Integer type' },
      { label: 'vector', kind: 6, insert: 'vector<${1:int}>', doc: 'Vector container' },
      { label: 'string', kind: 6, insert: 'string', doc: 'String type' },
      { label: 'map', kind: 6, insert: 'map<${1:int}, ${2:int}>', doc: 'Map container' },
      { label: 'unordered_map', kind: 6, insert: 'unordered_map<${1:int}, ${2:int}>', doc: 'Unordered map' },
      { label: 'set', kind: 6, insert: 'set<${1:int}>', doc: 'Set container' },
      { label: 'unordered_set', kind: 6, insert: 'unordered_set<${1:int}>', doc: 'Unordered set' },
      { label: 'queue', kind: 6, insert: 'queue<${1:int}>', doc: 'Queue container' },
      { label: 'stack', kind: 6, insert: 'stack<${1:int}>', doc: 'Stack container' },
      { label: 'priority_queue', kind: 6, insert: 'priority_queue<${1:int}>', doc: 'Priority queue' },
      { label: 'deque', kind: 6, insert: 'deque<${1:int}>', doc: 'Deque container' },
      { label: 'pair', kind: 6, insert: 'pair<${1:int}, ${2:int}>', doc: 'Pair type' },
      { label: 'if', kind: 14, insert: 'if (${1:condition}) {\n    ${2}\n}', doc: 'If statement' },
      { label: 'else', kind: 14, insert: 'else {\n    ${1}\n}', doc: 'Else clause' },
      { label: 'for', kind: 14, insert: 'for (${1:int i = 0}; ${2:i < n}; ${3:i++}) {\n    ${4}\n}', doc: 'For loop' },
      { label: 'while', kind: 14, insert: 'while (${1:condition}) {\n    ${2}\n}', doc: 'While loop' },
      { label: 'return', kind: 14, insert: 'return ', doc: 'Return statement' },
      { label: 'cout', kind: 2, insert: 'cout << ${1} << endl;', doc: 'Console output' },
      { label: 'cin', kind: 2, insert: 'cin >> ${1};', doc: 'Console input' },
      { label: 'endl', kind: 2, insert: 'endl', doc: 'End line' },
      { label: 'push_back', kind: 2, insert: 'push_back(${1})', doc: 'Add to vector' },
      { label: 'size', kind: 2, insert: 'size()', doc: 'Container size' },
      { label: 'sort', kind: 2, insert: 'sort(${1:begin}, ${2:end})', doc: 'Sort range' },
      { label: 'max', kind: 2, insert: 'max(${1:a}, ${2:b})', doc: 'Maximum' },
      { label: 'min', kind: 2, insert: 'min(${1:a}, ${2:b})', doc: 'Minimum' },
      { label: 'abs', kind: 2, insert: 'abs(${1})', doc: 'Absolute value' },
      { label: 'auto', kind: 14, insert: 'auto ', doc: 'Auto type deduction' },
      { label: 'const', kind: 14, insert: 'const ', doc: 'Const qualifier' },
      { label: 'struct', kind: 14, insert: 'struct ${1:Name} {\n    ${2}\n};', doc: 'Struct definition' },
      { label: 'class', kind: 14, insert: 'class ${1:Name} {\npublic:\n    ${2}\n};', doc: 'Class definition' },
      { label: 'nullptr', kind: 4, insert: 'nullptr', doc: 'Null pointer' },
      { label: 'true', kind: 4, insert: 'true', doc: 'Boolean true' },
      { label: 'false', kind: 4, insert: 'false', doc: 'Boolean false' },
    ];

    const makeProvider = (snippets: typeof JAVA_SNIPPETS) => ({
      provideCompletionItems: (model: Monaco.editor.ITextModel, position: Monaco.Position) => {
        try {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          return {
            suggestions: snippets.map(s => ({
              label: s.label,
              kind: s.kind as any,
              insertText: s.insert,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: s.doc,
              range: range as any,
            })),
          };
        } catch { return { suggestions: [] }; }
      },
    });

    try { monaco.languages.registerCompletionItemProvider('java', makeProvider(JAVA_SNIPPETS)); } catch { /* ignore */ }
    try { monaco.languages.registerCompletionItemProvider('cpp', makeProvider(CPP_SNIPPETS)); } catch { /* ignore */ }
  };

  // Full code sent to backend = visible solution + hidden harness (if any)
  const fullCode = harness ? withHarness(code, harness) : code;

  // Check if code has actual logic (not empty, not just comments/stubs with pass)
  const hasRealCode = (() => {
    try {
      const lines = code.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('//'));
      // Remove function/class definition lines and "pass" — check if any real logic remains
      const logicLines = lines.filter(l =>
        !l.startsWith('def ') && !l.startsWith('class ') &&
        l !== 'pass' && !l.endsWith('pass') &&
        !l.startsWith('"""') && !l.startsWith("'''")
      );
      return logicLines.length > 0;
    } catch { return false; }
  })();

  const runTest = async () => {
    if (tests.length === 0) {
      setShowNoTestsModal(true);
      return;
    }
    if (!hasRealCode) {
      showToast('Write some code before submitting. The editor only has a stub with "pass".');
      return;
    }
    setBusy(true); setError('');
    try {
      const data = await api.test(language, fullCode, tests);
      setResults(data.results); setTab('tests');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const runOne = async (i: number) => {
    if (!hasRealCode) {
      showToast('Write some code before running. The editor only has a stub with "pass".');
      return;
    }
    setBusy(true); setError('');
    try {
      const data = await api.test(language, fullCode, [tests[i]]);
      setResults(prev => prev.map((r, idx) => idx === i ? data.results[0] : r));
      setActiveTest(i); setTab('tests');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const runCode = async () => {
    if (tests.length === 0) {
      setShowNoTestsModal(true);
      return;
    }
    if (!hasRealCode) {
      showToast('Write some code before running. The editor only has a stub with "pass".');
      return;
    }
    setBusy(true); setError('');
    try {
      const data = await api.run(language, fullCode, tests[activeTest]?.input || '');
      setRunResult(data); setTab('console');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const visualize = async () => {
    if (!hasRealCode) {
      showToast('Write some code before visualizing. The editor only has a stub with "pass".');
      return;
    }
    setBusy(true); setError('');
    try {
      const data = await api.visualize(language, fullCode, tests[activeTest]?.input || '');
      // Filter out steps that fall in the hidden harness (line > solution line count)
      // so Monaco highlighting and line display map to the visible solution code only.
      const solutionLines = code.split('\n').length;
      const filtered = {
        ...data,
        steps: (data.steps || []).filter(s => s.line <= solutionLines),
      };
      setVisual(filtered); setStep(0); setTab('debugger');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const changeLanguage = (next: Language) => {
    setLanguage(next); setCodeAndClearHistory(starter[next]); setHarness(''); setVisual(null); setResults([]); setRunResult(null);
  };
  // Reset to the initial AI-generated boilerplate (function signature + pass) — clears all user code
  const [showResetModal, setShowResetModal] = useState(false);
  const reset = () => {
    try {
      const stub = stubCodeRef.current || defaultCode[language];
      setCodeAndClearHistory(stub);
      setResults([]);
      setVisual(null);
      setRunResult(null);
      setError('');
      setStep(0);
      setParseError('');
      setShowResetModal(false);
    } catch { /* ignore */ }
  };

  // Track problemTitle in a ref for auto-save
  const problemTitleRef = useRef('');
  useEffect(() => { problemTitleRef.current = problemTitle; }, [problemTitle]);

  // Auto-save current problem to DB — uses refs to always read latest values
  const saveProblem = async () => {
    try {
      const curProblem = problemRef.current;
      const curCode = codeRef.current;
      const curParsed = parsedRef.current;
      const curResults = resultsRef.current;
      const curLanguage = languageRef.current;

      if (!curProblem.trim() || !curCode.trim()) return;
      // Don't save if code is just the starter comment
      if (curCode.trim().startsWith('# Paste a problem') || curCode.trim().startsWith('// Paste a problem')) return;
      if (savingRef.current) return;
      savingRef.current = true;

      // Use AI-generated title if available, otherwise fall back to function name or parsed title
      let title = 'Untitled';
      const curTitle = problemTitleRef.current;
      if (curTitle) {
        title = curTitle;
      } else if (functionName) {
        title = camelToTitle(functionName);
      } else if (curParsed?.title && curParsed.title.length < 50 && !curParsed.title.endsWith('.')) {
        title = curParsed.title;
      }
      const status = curResults.length > 0
        ? (curResults.every(r => r.passed) ? 'solved' : 'failed')
        : 'in_progress';
      const passedCount = curResults.filter(r => r.passed).length;
      const curTests = testsRef.current;
      const payload = {
        title,
        description: curParsed?.description || '',
        problem_text: curProblem,
        code: curCode,
        stub_code: stubCodeRef.current,
        language: curLanguage,
        status,
        passed: passedCount,
        total: curResults.length,
        tests: JSON.stringify(curTests.map(t => ({ input: t.input, expected: t.expected }))),
      };
      setSaveStatus('saving');
      const pid = currentProblemIdRef.current;
      if (pid !== null) {
        await api.updateProblem(pid, payload);
      } else {
        const res = await api.saveProblem(payload);
        currentProblemIdRef.current = res.id;
        setCurrentProblemId(res.id);
      }
      setSaveStatus('saved');
      setSidebarRefreshKey(k => k + 1);
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('idle');
    } finally {
      savingRef.current = false;
    }
  };

  // Auto-save after test results come back
  useEffect(() => {
    try {
      if (results.length > 0 && problem.trim() && code.trim()) {
        saveProblem();
      }
    } catch { /* ignore */ }
  }, [results]);

  // Auto-save when code or problem changes (debounced 3s)
  useEffect(() => {
    try {
      if (!problem.trim() || !code.trim() || loadingFromSidebarRef.current) return;
      const timer = setTimeout(() => { saveProblem(); }, 3000);
      return () => clearTimeout(timer);
    } catch { /* ignore */ }
  }, [code, problem]);

  // Auto-save when tests change (debounced 1.5s — faster since user actively adding)
  useEffect(() => {
    try {
      if (!problem.trim() || !code.trim() || loadingFromSidebarRef.current) return;
      const timer = setTimeout(() => { saveProblem(); }, 1500);
      return () => clearTimeout(timer);
    } catch { /* ignore */ }
  }, [tests]);

  // Load a saved problem from the sidebar — display in preview mode, no AI calls
  const loadProblem = (p: SavedProblem) => {
    try {
      loadingFromSidebarRef.current = true;
      // Abort any ongoing AI operations
      genAbortRef.current?.abort();
      sigAbortRef.current?.abort();
      currentProblemIdRef.current = p.id;
      setCurrentProblemId(p.id);
      const text = p.problem_text || p.title;
      // Update refs immediately so auto-save doesn't fire with stale data
      problemRef.current = text;
      codeRef.current = p.code || '';
      resultsRef.current = [];
      languageRef.current = (p.language as Language) || 'python';
      // Update state
      setProblem(text);
      setCodeAndClearHistory(p.code || '');
      setLanguage((p.language as Language) || 'python');
      // Extract function name from loaded code and rebuild harness
      const codeMatch = (p.code || '').match(/def\s+(\w+)\s*\(([^)]*)\)/);
      const fnName = codeMatch ? codeMatch[1] : '';
      const fnParams = codeMatch ? codeMatch[2] : '';
      setFunctionName(fnName);
      // Build the stub for Reset: use saved stub_code if available,
      // otherwise reconstruct from the function signature in the code
      if (p.stub_code) {
        stubCodeRef.current = p.stub_code;
      } else if (fnName) {
        // Reconstruct the boilerplate from the function signature
        stubCodeRef.current = `def ${fnName}(${fnParams}):\n    # Write your solution here\n    pass\n`;
      } else {
        stubCodeRef.current = defaultCode[(p.language as Language)] || defaultCode.python;
      }
      // Use the saved title from DB as the problem title
      setProblemTitle(p.title || '');
      problemTitleRef.current = p.title || '';
      setHarness(fnName ? buildHarness(fnName) : '');
      // Restore test cases from DB
      let loadedTests: TestCase[] = [];
      try {
        if (p.tests) {
          const parsed = JSON.parse(p.tests);
          if (Array.isArray(parsed)) {
            loadedTests = parsed.map((t: { input: string; expected: string }) => ({
              id: nextId++, input: t.input, expected: t.expected,
            }));
          }
        }
      } catch { /* ignore */ }
      testsRef.current = loadedTests;
      setTests(loadedTests);
      setResults([]);
      setRunResult(null);
      setVisual(null);
      setStep(0);
      setError('');
      setParseError('');
      setSigLoading(false);
      setGenTestsLoading(false);
      setSaveStatus('idle');
      problemChangedRef.current = false;
      // Parse the problem so we can show it in preview mode
      try {
        const parsedProblem = parseProblem(text);
        parsedRef.current = parsedProblem;
        setParsed(parsedProblem);
      } catch {
        parsedRef.current = null;
        setParsed(null);
      }
      setPanelPreview(true); // start in preview mode
      setPanelKey(k => k + 1); // remount ProblemPanel → resets showRaw
      // Reset the guard after state settles so future edits auto-save normally
      setTimeout(() => { loadingFromSidebarRef.current = false; }, 500);
    } catch { /* ignore */ }
  };

  const useSignature = (stub: string) => { if (stub) setCodeAndClearHistory(stub); };

  // Delete Problem — if it's the current one, reset to new mode
  const deleteProblem = (id: number) => {
    try {
      if (currentProblemIdRef.current === id) {
        // Reset to new mode
        loadingFromSidebarRef.current = true;
        genAbortRef.current?.abort();
        sigAbortRef.current?.abort();
        currentProblemIdRef.current = null;
        setCurrentProblemId(null);
        problemRef.current = '';
        codeRef.current = starter[language];
        parsedRef.current = null;
        resultsRef.current = [];
        testsRef.current = [];
        languageRef.current = 'python';
        setProblem('');
        setCodeAndClearHistory(starter[language]);
        setHarness('');
        setLanguage('python');
        setFunctionName('');
        setProblemTitle('');
        problemTitleRef.current = '';
        setTests([]);
        setResults([]);
        setRunResult(null);
        setVisual(null);
        setStep(0);
        setError('');
        setParseError('');
        setSigLoading(false);
        setGenTestsLoading(false);
        setSaveStatus('idle');
        problemChangedRef.current = false;
        setParsed(null);
        setPanelPreview(false);
        setPanelKey(k => k + 1);
        setTimeout(() => { loadingFromSidebarRef.current = false; }, 500);
      }
    } catch { /* ignore */ }
  };

  // New Problem — clears everything and creates an "Untitled" entry in DB
  const newProblem = async () => {
    try {
      loadingFromSidebarRef.current = true;
      // Abort any ongoing AI operations
      genAbortRef.current?.abort();
      sigAbortRef.current?.abort();
      currentProblemIdRef.current = null;
      setCurrentProblemId(null);
      problemRef.current = '';
      codeRef.current = starter[language];
      parsedRef.current = null;
      resultsRef.current = [];
      setProblem('');
      setCodeAndClearHistory(starter[language]);
      setHarness('');
      setLanguage('python');
      setFunctionName('');
      setProblemTitle('');
      problemTitleRef.current = '';
      setTests([]);
      setResults([]);
      setRunResult(null);
      setVisual(null);
      setStep(0);
      setError('');
      setParseError('');
      setSigLoading(false);
      setGenTestsLoading(false);
      setSaveStatus('idle');
      problemChangedRef.current = false;
      setParsed(null);
      setPanelPreview(false); // new problem starts in edit mode
      setPanelKey(k => k + 1);
      setTimeout(() => { loadingFromSidebarRef.current = false; }, 500);
      // Create an "Untitled" entry in the DB immediately so it shows in sidebar
      try {
        const res = await api.saveProblem({
          title: 'Untitled',
          problem_text: '',
          code: '',
          language: 'python',
          status: 'in_progress',
        });
        currentProblemIdRef.current = res.id;
        setCurrentProblemId(res.id);
        setSidebarRefreshKey(k => k + 1);
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runTest(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const passed = results.filter(r => r.passed).length;
  const currentStep = visual?.steps?.[step];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">&lt;/&gt;</span>
          <span>CodeTrace</span>
          <small>DSA Playground</small>
        </div>
        <div className="top-actions">
          {saveStatus === 'saving' && <span className="save-tag saving">Saving…</span>}
          {saveStatus === 'saved' && <span className="save-tag saved">✓ Saved</span>}
          <button className="secondary" onClick={() => setInterview(v => !v)} title="Toggle Interview Mode">
            {interview ? 'Exit' : 'Interview'}
          </button>
          <button className="secondary" onClick={visualize} disabled={busy} title="Visualize execution">Visualize</button>
          <button className="success" onClick={runTest} disabled={busy} title="Submit & test">
            {busy ? 'Running…' : 'Submit'}
          </button>
        </div>
      </header>

      <InterviewBar
        active={interview}
        onToggle={() => setInterview(false)}
        onSubmit={async () => { await runTest(); return null; }}
        onReveal={() => setInterview(false)}
      />

      <div className="app-body">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(v => !v)}
          onLoadProblem={loadProblem}
          onNewProblem={newProblem}
          onDeleteProblem={deleteProblem}
          refreshKey={sidebarRefreshKey}
          currentProblemId={currentProblemId}
        />

      <main className="workspace" style={{ display: 'flex' }}>
        <div className="panel-wrapper" style={{ width: `${panelWidths.left}%` }}>
        <ProblemPanel
          key={panelKey}
          problem={problem}
          onProblem={(s) => { problemChangedRef.current = true; setProblem(s); }}
          parsed={parsed}
          onParsed={setParsed}
          tests={tests}
          onTests={setTests}
          results={results}
          activeTest={activeTest}
          onActiveTest={setActiveTest}
          onRunOne={runOne}
          language={language}
          onUseSignature={useSignature}
          parseError={parseError}
          genTestsLoading={genTestsLoading}
          onGenerateTests={generateTests}
          onCancelGenerate={cancelGenerate}
          initialPreview={panelPreview}
          aiTitle={problemTitle}
        />
        </div>

        <Splitter direction="horizontal" onDrag={onDragLeft} />

        <div className="panel-wrapper" style={{ width: `${panelWidths.middle}%` }}>
        <EditorPanel
          language={language}
          code={code}
          fontSize={fontSize}
          onCodeChange={setCode}
          onLanguageChange={changeLanguage}
          onFontSize={setFontSize}
          onMount={onMount}
          onReset={reset}
          onRun={runCode}
          onResetClick={() => setShowResetModal(true)}
          currentStep={currentStep}
          interviewHidden={interview}
          sigLoading={sigLoading}
        />
        </div>

        <Splitter direction="horizontal" onDrag={onDragRight} />

        <div className="panel-wrapper" style={{ width: `${panelWidths.right}%` }}>
        <aside className="output-panel">
          <div className="tabs">
            <button className={tab === 'tests' ? 'selected' : ''} onClick={() => setTab('tests')}>
              Tests {results.length ? <em>{passed}/{results.length}</em> : ''}
            </button>
            <button className={tab === 'console' ? 'selected' : ''} onClick={() => setTab('console')}>Console</button>
            <button className={tab === 'debugger' ? 'selected' : ''} onClick={() => setTab('debugger')}>
              Debugger {visual?.steps?.length ? <em>{visual.steps.length}</em> : ''}
            </button>
            <button className={tab === 'ai' ? 'selected' : ''} onClick={() => setTab('ai')}>AI Tutor</button>
          </div>
          {error && <div className="error-box">{error}</div>}
          {tab === 'tests' && <ResultsPanel results={results} onPick={setActiveTest} />}
          {tab === 'console' && <ConsolePanel runResult={runResult} />}
          {tab === 'debugger' && <DebuggerPanel visual={visual} step={step} onStep={setStep} code={code} />}
          <div className={tab === 'ai' ? 'output-content' : 'output-content hidden'}>
            <AITutor
              key={parseCount}
              code={code}
              language={language}
              problem={problem}
              currentLine={currentStep?.line}
              tests={tests}
              error={error || (visual?.stderr || '')}
              aiEnabled={aiEnabled}
              onGeneratedTests={(gen) => setTests(prev => [...prev, ...gen.map(g => ({ id: nextId++, input: g.input, expected: g.expected }))])}
            />
          </div>
        </aside>
        </div>
      </main>
      </div>

      {/* Toast notification */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span className="toast-icon">{toast.type === 'error' ? '⚠' : 'ℹ'}</span>
          <span className="toast-msg">{toast.msg}</span>
          <button className="toast-close" onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      {/* Reset confirmation modal */}
      {showResetModal && (
        <div className="modal-overlay" onClick={() => setShowResetModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-icon">↺</div>
            <h3>Are you sure?</h3>
            <p>Your current code will be discarded and reset to the default code!</p>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setShowResetModal(false)}>Cancel</button>
              <button className="danger" onClick={reset}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* No test cases modal */}
      {showNoTestsModal && (
        <div className="modal-overlay" onClick={() => setShowNoTestsModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-icon">🧪</div>
            <h3 className="modal-title">No Test Cases</h3>
            <p className="modal-desc">
              You need test cases to run your code. Generate them automatically with AI or add one manually.
            </p>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setShowNoTestsModal(false)}>Cancel</button>
              <button className="secondary" onClick={() => {
                setShowNoTestsModal(false);
                setTests([{ id: nextId++, input: '', expected: '' }]);
                setTab('tests');
              }}>＋ Add Manually</button>
              <button className="success" onClick={() => {
                setShowNoTestsModal(false);
                generateTests();
              }} disabled={!parsed}>⚡ Generate with AI</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
