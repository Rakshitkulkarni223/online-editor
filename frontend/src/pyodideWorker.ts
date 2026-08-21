/// <reference lib="webworker" />

// Web worker that loads Pyodide + Jedi for Python code completion
// Jedi is a pure Python static analysis library that provides IDE features

let pyodideReady: Promise<any> | null = null;
let jediReady = false;

async function initPyodide() {
  if (pyodideReady) return pyodideReady;
  pyodideReady = (async () => {
    try {
      // Load Pyodide from CDN
      importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js');
      const pyodide = (self as any).loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/',
      });
      const instance = await pyodide;
      // Install jedi for Python code analysis
      await instance.loadPackage(['micropip']);
      await instance.runPythonAsync(`
import micropip
await micropip.install('jedi')
import jedi
print('Jedi loaded successfully')
`);
      jediReady = true;
      return instance;
    } catch (err) {
      console.error('Pyodide init failed:', err);
      throw err;
    }
  })();
  return pyodideReady;
}

async function getCompletions(code: string, line: number, column: number) {
  const pyodide = await initPyodide();
  if (!jediReady) return [];

  const result = pyodide.runPython(`
import json
import jedi

source = ${JSON.stringify(JSON.stringify(code))}
line = ${line}
column = ${column}

try:
    script = jedi.Script(code=source)
    completions = script.complete(line=line, column=column)
    result = []
    for c in completions[:50]:
        result.append({
            'name': c.name,
            'type': c.type,
            'complete': c.complete,
            'doc': (c.docstring() or '')[:200],
        })
    json.dumps(result)
except Exception as e:
    json.dumps([])
`);

  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data;
  try {
    if (type === 'init') {
      await initPyodide();
      (self as any).postMessage({ id, type: 'ready' });
    } else if (type === 'complete') {
      const { code, line, column } = payload;
      const completions = await getCompletions(code, line, column);
      (self as any).postMessage({ id, type: 'result', completions });
    }
  } catch (err) {
    (self as any).postMessage({ id, type: 'error', error: String(err) });
  }
};
