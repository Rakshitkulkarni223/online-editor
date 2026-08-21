// Manages the Pyodide web worker and provides async completions

import PyodideWorker from './pyodideWorker?worker';

type CompletionResult = {
  name: string;
  type: string;
  complete: string;
  doc: string;
};

let worker: Worker | null = null;
let ready: boolean = false;
let initPromise: Promise<void> | null = null;
let pendingRequests = new Map<number, (completions: CompletionResult[]) => void>();
let nextId = 1;

export function initPyodideCompletions(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = new Promise((resolve) => {
    try {
      worker = new PyodideWorker();
      worker.onmessage = (e: MessageEvent) => {
        const { id, type } = e.data;
        if (type === 'ready') {
          ready = true;
          resolve();
        } else if (type === 'result') {
          const cb = pendingRequests.get(id);
          if (cb) {
            cb(e.data.completions as CompletionResult[]);
            pendingRequests.delete(id);
          }
        } else if (type === 'error') {
          const cb = pendingRequests.get(id);
          if (cb) {
            cb([]);
            pendingRequests.delete(id);
          }
        }
      };
      worker.onerror = () => { /* ignore — completions just won't work */ };
      worker.postMessage({ id: nextId++, type: 'init' });
    } catch {
      resolve(); // fail silently
    }
  });
  return initPromise;
}

export function isPyodideReady(): boolean {
  return ready;
}

export function getPyodideCompletions(code: string, line: number, column: number): Promise<CompletionResult[]> {
  return new Promise((resolve) => {
    try {
      if (!worker || !ready) {
        resolve([]);
        return;
      }
      const id = nextId++;
      pendingRequests.set(id, resolve);
      worker.postMessage({ id, type: 'complete', payload: { code, line, column } });
      // Timeout — don't block editor if Pyodide is slow
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          resolve([]);
        }
      }, 3000);
    } catch {
      resolve([]);
    }
  });
}
