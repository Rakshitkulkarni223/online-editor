import type {
  AIAction, AIResponse, Language, RunResponse, TestResponse, VisualResponse, TestCase,
} from './types';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export type SavedProblem = {
  id: number;
  title: string;
  description?: string;
  problem_text?: string;
  code?: string;
  stub_code?: string;
  language?: string;
  status: string;
  passed: number;
  total: number;
  tests?: string;  // JSON string of test cases
  created_at: string;
  updated_at: string;
};

export type SaveProblemReq = {
  title: string;
  description?: string;
  problem_text?: string;
  code?: string;
  stub_code?: string;
  language?: string;
  status?: string;
  passed?: number;
  total?: number;
  tests?: string;  // JSON string of test cases
};

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(API + path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data as T;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data as T;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(API + path, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  run: (language: Language, code: string, stdin = '') =>
    post<RunResponse>('/run', { language, code, stdin }),
  test: (language: Language, code: string, tests: TestCase[]) =>
    post<TestResponse>('/test', { language, code, tests }),
  visualize: (language: Language, code: string, stdin = '') =>
    post<VisualResponse>('/visualize', { language, code, stdin }),
  ai: (action: AIAction, payload: {
    code?: string; language?: Language; problem?: string;
    line?: number; tests?: { input: string; expected: string }[]; error?: string;
  }, signal?: AbortSignal) => post<AIResponse>('/ai', { action, ...payload }, signal),
  health: async () => {
    try {
      const r = await fetch(API + '/health');
      return await r.json();
    } catch {
      return { ok: false, ai: false };
    }
  },
  // Problem history
  listProblems: () => get<{ problems: SavedProblem[] }>('/problems'),
  getProblem: (id: number) => get<SavedProblem>(`/problems/${id}`),
  saveProblem: (p: SaveProblemReq) => post<{ id: number; ok: boolean }>('/problems', p),
  updateProblem: (id: number, p: SaveProblemReq) => put(`/problems/${id}`, p),
  deleteProblem: (id: number) => del(`/problems/${id}`),
};

export { API };
