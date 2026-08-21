export type Language = 'python' | 'javascript' | 'java' | 'cpp';

export type ScalarValue = { type: 'int' | 'float' | 'str' | 'bool' | 'NoneType'; value: number | string | boolean | null };
export type ListValue = { type: 'list' | 'set'; value: VarValue[] };
export type DictValue = { type: 'dict'; value: { key: VarValue; val: VarValue }[] };
export type ObjectValue = { type: string; value: Record<string, VarValue> | null; repr?: string };

export type VarValue = ScalarValue | ListValue | DictValue | ObjectValue;

export function isScalar(v: VarValue): v is ScalarValue {
  return v.type === 'int' || v.type === 'float' || v.type === 'str' || v.type === 'bool' || v.type === 'NoneType';
}
export function isList(v: VarValue): v is ListValue {
  return v.type === 'list' || v.type === 'set';
}
export function isDict(v: VarValue): v is DictValue {
  return v.type === 'dict';
}
export function isObject(v: VarValue): v is ObjectValue {
  return !isScalar(v) && !isList(v) && !isDict(v);
}

export type Step = {
  line: number;
  locals: Record<string, VarValue>;
  callStack: string[];
  event?: string;
};

export type TestCase = { id: number; input: string; expected: string; hidden?: boolean };
export type TestResult = TestCase & {
  passed: boolean;
  actual: string;
  error?: string;
  time?: string | null;
  memory?: number | null;
};

export type RunResponse = { status?: string; stdout?: string; stderr?: string; time?: string; memory?: number };
export type TestResponse = { passed: number; total: number; results: TestResult[] };
export type VisualResponse = { stdout: string; stderr: string; steps: Step[]; status?: string };

export type ParsedProblem = {
  title: string;
  description: string;
  examples: { input: string; output: string; explanation?: string }[];
  constraints: string[];
  signature?: { language: Language; name: string; params: string[]; returnType: string; raw: string };
};

export type AIAction =
  | 'hint' | 'approach' | 'explain_line' | 'find_mistake' | 'gen_tests' | 'gen_stub_and_tests' | 'gen_signature' | 'complexity';

export type AIResponse = { text: string; action: AIAction };
