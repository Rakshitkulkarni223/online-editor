import type { Language, ParsedProblem } from './types';

/**
 * Parse a pasted LeetCode-style problem description into structured pieces.
 * Pure heuristics — no network. Best-effort; falls back to raw text.
 * Throws Error with a user-friendly message if the input is not a valid problem.
 */
export function parseProblem(raw: string): ParsedProblem {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) throw new Error('Problem statement is empty. Paste a LeetCode-style problem description.');
  if (text.length < 30) throw new Error('This doesn\'t look like a valid problem statement — it\'s too short. A problem should have a description, examples, and constraints.');

  const lines = text.split('\n');

  const title = extractTitle(lines);
  const examples = extractExamples(text);
  const constraints = extractConstraints(text);
  const signature = detectSignature(text);

  // Description = text minus the extracted example/constraint blocks.
  let description = text;
  const cutStarts: number[] = [];
  const exMatch = text.match(/(?:^|\n)\s*(Example\s*\d*\s*:|Examples\s*:?)\s*(?:\n|$)/i);
  const conMatch = text.match(/(?:^|\n)\s*Constraints\s*:?/i);
  if (exMatch) cutStarts.push(exMatch.index ?? 0);
  if (conMatch) cutStarts.push(conMatch.index ?? 0);
  if (cutStarts.length) description = text.slice(0, Math.min(...cutStarts)).trim();

  // Validate: a real problem should have a meaningful description
  if (description.length < 20) {
    throw new Error('Could not extract a problem description. Make sure you paste the full problem text including the description, examples, and constraints.');
  }

  return { title, description, examples, constraints, signature };
}

/**
 * Check if a parsed problem looks valid enough to generate code/tests from.
 * Returns an error message string, or null if valid.
 */
export function validateProblem(p: ParsedProblem | null): string | null {
  if (!p) return 'No problem parsed yet.';
  if (!p.description || p.description.length < 20) return 'Problem description is too short or missing.';
  return null;
}

function extractTitle(lines: string[]): string {
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) continue;
    const h = t.match(/^#+\s*(.+)$/);
    if (h) return h[1].trim();
    // LeetCode pastes often start with the problem title as the first line.
    if (t.length < 80 && !t.endsWith('.') && !t.endsWith(':')) return t;
    return t.slice(0, 70);
  }
  return 'Untitled Problem';
}

function extractExamples(text: string): ParsedProblem['examples'] {
  // Strategy 1: "Example N:" / "Example:" markers (classic LeetCode format)
  const out: ParsedProblem['examples'] = [];
  const parts = text.split(/(?:^|\n)\s*Example\s*\d*\s*:\s*/i);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i].split(/\n\s*Example\s*\d*\s*:/i)[0];
    const ex = parseExampleBlock(block);
    if (ex) out.push(ex);
  }
  if (out.length > 0) return out;

  // Strategy 2: "Examples" header followed by consecutive Input:/Output: pairs
  // (no individual "Example N:" markers — common in simplified problem pastes)
  const exHeaderMatch = text.match(/(?:^|\n)\s*Examples\s*:?\s*\n/i);
  if (exHeaderMatch) {
    const afterHeader = text.slice((exHeaderMatch.index ?? 0) + exHeaderMatch[0].length);
    // Stop at Constraints or end
    const conIdx = afterHeader.search(/(?:^|\n)\s*Constraints\s*:?/i);
    const exBlock = conIdx >= 0 ? afterHeader.slice(0, conIdx) : afterHeader;
    // Split on "Input:" to get individual examples
    const inputChunks = exBlock.split(/(?:^|\n)\s*Input[:\s]/i).slice(1);
    for (const chunk of inputChunks) {
      const ex = parseExampleBlock(chunk);
      if (ex) out.push(ex);
    }
  }
  return out;
}

/** Parse a single example block to extract input, output, and explanation. */
function parseExampleBlock(block: string): { input: string; output: string; explanation?: string } | null {
  // Input: either after an "Input:" label, or everything before "Output:" (when block was split on Input:)
  const input = field(block, /Input[:\s]*([\s\S]*?)(?=\n\s*Output[:\s]|$)/i) || field(block, /^([\s\S]*?)(?=\n\s*Output[:\s]|$)/i);
  // Output: after "Output:" until Explanation/Input/Example/Constraints or end-of-string
  const output = field(block, /Output[:\s]*([\s\S]*?)(?=\n\s*(?:Explanation[:\s]|Input[:\s]|Example\s*\d|Constraints)|$)/i);
  // Explanation: after "Explanation:" until next Input/Example/Constraints or end-of-string
  const explanation = field(block, /Explanation[:\s]*([\s\S]*?)(?=\n\s*(?:Input[:\s]|Example\s*\d|Constraints)|$)/i);
  const inClean = clean(input);
  const outClean = clean(output);
  if (inClean || outClean) {
    return { input: inClean, output: outClean, explanation: explanation ? clean(explanation) : undefined };
  }
  return null;
}

function field(s: string, re: RegExp): string {
  const m = s.match(re);
  return m ? m[1] : '';
}

function clean(s: string): string {
  let out = s.replace(/\s+/g, ' ').trim();
  // Only strip wrapping quotes if the ENTIRE string is quoted (e.g. "abc" → abc),
  // not when quotes appear mid-string (e.g. s = "abc" should stay as-is)
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) {
    out = out.slice(1, -1);
  }
  return out;
}

function extractConstraints(text: string): string[] {
  // Match "Constraints:" or "Constraints" (without colon, as a standalone header)
  const match = text.match(/(?:^|\n)\s*Constraints\s*:?\s*(?:\n|$)/i);
  if (!match) return [];
  const rest = text.slice((match.index ?? 0) + match[0].length);
  // Stop at next major section.
  const stop = rest.search(/(?:^|\n)\s*(?:Follow[- ]?up|Note|Example)/i);
  const block = stop >= 0 ? rest.slice(0, stop) : rest;
  const items: string[] = [];
  for (const raw of block.split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    const m = t.match(/^(?:[-*•]|\d+[.)])\s*(.+)$/);
    if (m) items.push(m[1].trim());
    else if (items.length && /^[a-z]/.test(t)) items[items.length - 1] += ' ' + t; // continuation
    else if (t.length > 3) items.push(t);
  }
  return items;
}

/** Detect a function signature from a pasted code stub, or infer from examples. */
export function detectSignature(text: string): ParsedProblem['signature'] | undefined {
  // Python: def name(args) -> ret:
  const py = text.match(/def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^\s:]+))?\s*:/);
  if (py) {
    return {
      language: 'python', name: py[1],
      params: splitParams(py[2]), returnType: (py[3] || '').trim() || 'Any',
      raw: py[0],
    };
  }
  // JS/TS: function name(args) or var name = (args) =>
  const js = text.match(/function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
  if (js) {
    return { language: 'javascript', name: js[1], params: splitParams(js[2]), returnType: 'any', raw: js[0] };
  }
  // Java: public ReturnType name(args)
  const java = text.match(/(?:public|static|private)\s+([\w<>\[\]]+)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
  if (java) {
    return { language: 'java', name: java[2], params: splitParams(java[3]), returnType: java[1], raw: java[0] };
  }
  // C++: ReturnType name(args)
  const cpp = text.match(/[\w<>:&*\[\]]+\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/);
  if (cpp) {
    return { language: 'cpp', name: cpp[1], params: splitParams(cpp[2]), returnType: 'auto', raw: cpp[0] };
  }
  return undefined;
}

function splitParams(s: string): string[] {
  return s.split(',').map(p => p.trim()).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Auto-generation: infer params, function name, code stub, test cases */
/* ------------------------------------------------------------------ */

export type InferredParam = { name: string; type: string };

/**
 * Infer function parameters from an example input string like:
 *   "coins = [[8,10,1],[1,3,2],[5,6,4]], k = 4"
 *   "nums = [2,7,11,15]\ntarget = 9"
 * Returns [{name, type}] or [] if no "name = value" patterns found.
 */
export function inferParams(input: string): InferredParam[] {
  const regex = /(\w+)\s*=\s*/g;
  const matches = [...input.matchAll(regex)];
  if (matches.length === 0) {
    // Fallback: try to treat the whole input as a single positional value
    const trimmed = input.trim();
    if (trimmed) return [{ name: 'data', type: inferType(trimmed) }];
    return [];
  }
  return matches.map((m, idx) => {
    const name = m[1];
    const valStart = (m.index ?? 0) + m[0].length;
    const valEnd = idx + 1 < matches.length ? (matches[idx + 1].index ?? input.length) : input.length;
    const valStr = input.slice(valStart, valEnd).trim().replace(/,$/, '').trim();
    return { name, type: inferType(valStr) };
  });
}

/**
 * Infer function parameters from the problem DESCRIPTION when no examples exist.
 * Looks for patterns like "an array nums", "an integer target", "a string s",
 * "a 2D array coins", "an integer k", "2 comma separated integers", etc.
 */
export function inferParamsFromDescription(description: string): InferredParam[] {
  const params: InferredParam[] = [];
  const seen = new Set<string>();

  // Pattern 0: "N comma separated integers/strings/numbers" or "two/three integers"
  // e.g. "give 2 comma separated integers" → [a, b] as int
  //      "given two integers a and b" → [a, b] as int
  //      "given three strings" → [s1, s2, s3] as str
  const countWordMap: Record<string, number> = { 'two': 2, 'three': 3, 'four': 4, 'five': 5, '2': 2, '3': 3, '4': 4, '5': 5 };

  // "N comma separated integers/strings"
  const commaSepMatch = description.match(/(\d+|two|three|four|five)\s+comma\s+separat(?:ed|ion)\s+(integers?|strings?|numbers?|floats?|booleans?)/i);
  if (commaSepMatch) {
    const count = countWordMap[commaSepMatch[1].toLowerCase()] || parseInt(commaSepMatch[1]) || 2;
    const typeWord = commaSepMatch[2].toLowerCase();
    const type = typeWord.startsWith('str') ? 'str' : typeWord.startsWith('bool') ? 'bool' : typeWord.startsWith('float') ? 'float' : 'int';
    const prefix = typeWord.startsWith('str') ? 's' : typeWord.startsWith('bool') ? 'b' : typeWord.startsWith('float') ? 'f' : 'a';
    for (let i = 0; i < count; i++) {
      const name = `${prefix}${i + 1}`;
      if (!seen.has(name)) { seen.add(name); params.push({ name, type }); }
    }
  }

  // "two/three/N integers/strings a and b" or "two integers a, b"
  if (params.length === 0) {
    const countTypeMatch = description.match(/(two|three|four|five|2|3|4|5)\s+(integers?|strings?|numbers?|floats?|booleans?)\s+([\w\s,]+?)(?:[.\n]|and\s+(?:return|find|write|the)|$)/i);
    if (countTypeMatch) {
      const count = countWordMap[countTypeMatch[1].toLowerCase()] || parseInt(countTypeMatch[1]) || 2;
      const typeWord = countTypeMatch[2].toLowerCase();
      const type = typeWord.startsWith('str') ? 'str' : typeWord.startsWith('bool') ? 'bool' : typeWord.startsWith('float') ? 'float' : 'int';
      // Try to extract variable names from the rest
      const namePart = countTypeMatch[3].trim();
      const nameCandidates = namePart.split(/[,;\s]+/).filter(w => w && !['and', 'or', 'the', 'a', 'an', 'of', 'to', 'in', 'for', 'with', 'given'].includes(w.toLowerCase()));
      for (let i = 0; i < count; i++) {
        const name = nameCandidates[i] || `a${i + 1}`;
        if (!seen.has(name)) { seen.add(name); params.push({ name, type }); }
      }
    }
  }

  // If we got params from the count patterns, return early
  if (params.length > 0) return params.slice(0, 5);

  // Pattern: "a/an [type] [name]" or "the [type] [name]"
  const patterns: { re: RegExp; type: string }[] = [
    { re: /(?:an?|the)\s+(?:2D\s+)?array\s+(\w+)/gi, type: 'List[int]' },
    { re: /(?:an?|the)\s+(?:2D\s+)?matrix\s+(\w+)/gi, type: 'List[List[int]]' },
    { re: /(?:an?|the)\s+integer\s+(\w+)/gi, type: 'int' },
    { re: /(?:an?|the)\s+int\s+(\w+)/gi, type: 'int' },
    { re: /(?:an?|the)\s+string\s+(\w+)/gi, type: 'str' },
    { re: /(?:an?|the)\s+number\s+(\w+)/gi, type: 'int' },
    { re: /(?:an?|the)\s+list\s+(\w+)/gi, type: 'List[int]' },
    { re: /(?:an?|the)\s+boolean\s+(\w+)/gi, type: 'bool' },
    { re: /(?:an?|the)\s+character\s+(\w+)/gi, type: 'str' },
    { re: /(?:an?|the)\s+node\s+(\w+)/gi, type: 'object' },
    { re: /(?:an?|the)\s+tree\s+(\w+)/gi, type: 'object' },
    { re: /(?:an?|the)\s+head\s+(\w+)/gi, type: 'object' },
    { re: /(?:an?|the)\s+root\s+(\w+)/gi, type: 'object' },
  ];

  // Words that are NOT variable names — common English words that appear after "a/an/the [type]"
  const NOT_A_PARAM = new Set([
    'that', 'which', 'where', 'what', 'this', 'then', 'than', 'of', 'in', 'is',
    'are', 'be', 'to', 'for', 'and', 'or', 'not', 'as', 'by', 'on', 'at', 'it',
    'we', 'you', 'they', 'he', 'she', 'line', 'array', 'matrix', 'list', 'tree',
    'node', 'head', 'root', 'return', 'maximum', 'minimum', 'amount', 'number',
    'total', 'result', 'output', 'input', 'value', 'element', 'elements', 'each',
    'all', 'some', 'any', 'every', 'from', 'with', 'without', 'can', 'will',
    'should', 'must', 'may', 'might', 'could', 'would', 'has', 'have', 'had',
    'do', 'does', 'did', 'done', 'get', 'got', 'put', 'set', 'let', 'one',
    'two', 'three', 'four', 'five', 'first', 'second', 'third', 'last', 'next',
    'prev', 'previous', 'current', 'new', 'old', 'left', 'right', 'mid', 'middle',
    'start', 'end', 'begin', 'stop', 'top', 'bottom', 'front', 'back', 'up',
    'down', 'over', 'under', 'above', 'below', 'here', 'there', 'now', 'then',
    'problem', 'statement', 'question', 'solution', 'answer', 'case', 'test',
    'example', 'sample', 'instance', 'counter', 'index', 'position', 'point',
    'segment', 'range', 'interval', 'pair', 'triplet', 'quad', 'tuple',
  ]);

  for (const { re, type } of patterns) {
    const matches = [...description.matchAll(re)];
    for (const m of matches) {
      const name = m[1].toLowerCase();
      // Only accept short variable-like names (1-10 chars, not a stop word)
      if (name.length < 1 || name.length > 10 || NOT_A_PARAM.has(name)) continue;
      if (!seen.has(name)) { seen.add(name); params.push({ name, type }); }
    }
  }

  // Also look for "given a/an X" patterns — but only accept variable-like names
  const givenMatch = description.match(/given\s+(?:an?|the)\s+(?:.+?\s+)?(\w+)\s/gi);
  if (givenMatch) {
    for (const gm of givenMatch) {
      const name = gm.trim().split(/\s+/).pop()?.replace(/\s$/, '').toLowerCase() || '';
      if (name.length >= 1 && name.length <= 10 && !NOT_A_PARAM.has(name) && !seen.has(name)) {
        seen.add(name);
        params.push({ name, type: 'int' });
      }
    }
  }

  // Limit to reasonable number of params and ensure we have at least one
  if (params.length === 0) {
    if (/given/i.test(description)) {
      params.push({ name: 'data', type: 'int' });
    }
  }

  return params.slice(0, 5); // max 5 params
}

function inferType(valStr: string): string {
  const s = valStr.trim();
  if (s.startsWith('[[')) return 'List[List[int]]';
  if (s.startsWith('[')) return 'List[int]';
  if (s === 'true' || s === 'false') return 'bool';
  if (/^-?\d+$/.test(s)) return 'int';
  if (/^-?\d+\.\d+$/.test(s)) return 'float';
  if (s.startsWith('"') || s.startsWith("'")) return 'str';
  return 'int';
}

/**
 * Infer a snake_case function name from the problem text.
 * Priority:
 *   1. Action verb in "write a function to X" / "function that Xs" → X
 *   2. Title (first non-empty line) — reliable for LeetCode-style problems
 *   3. "Return/find the X" pattern from description
 *   4. "solve" fallback
 */
export function inferFunctionName(text: string): string {
  const STOP = new Set([
    'the', 'a', 'an', 'of', 'you', 'can', 'by', 'in', 'from', 'to',
    'for', 'and', 'or', 'amount', 'number', 'total', 'that', 'is',
    'are', 'be', 'will', 'should', 'must', 'may', 'each', 'all',
    'obtain', 'collecting', 'using', 'given', 'find', 'return',
    'without', 'with', 'not', 'no', 'if', 'then', 'else', 'when',
    'your', 'its', 'it', 'this', 'these', 'those', 'such', 'which',
    'who', 'whom', 'whose', 'what', 'where', 'how', 'why', 'about',
    'them', 'they', 'we', 'he', 'she', 'function', 'write', 'create',
    'implement', 'define', 'make', 'build', 'design', 'two', 'three',
    'first', 'second', 'last', 'given', 'problem', 'statement',
    'there', 'are', 'an', 'infinite', 'amount', 'bags', 'coins',
    'obtain', 'collecting', 'consecutive', 'maximum', 'minimum',
    'line', 'coordinate', 'segment', 'non', 'overlapping', 'array',
    'integer', 'string', 'list', 'matrix', 'tree', 'node', 'head', 'root',
  ]);

  // Priority 1: "write a function to X" / "function that Xs" / "function to X"
  // e.g. "write a function to add them" → add
  //      "function to merge two sorted lists" → merge_sorted_lists
  const actionMatch = text.match(/(?:write\s+a\s+function\s+(?:to|that)\s+|function\s+(?:to|that)\s+)([\w\s]+?)(?:[.\n,]|$)/i);
  if (actionMatch) {
    const words = actionMatch[1]
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0 && !STOP.has(w));
    if (words.length >= 1) return words.slice(0, 3).join('_');
  }

  // Priority 2: Use the title (first non-empty line)
  // But skip if the title looks like an informal sentence (contains "give", "write", etc.)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 0) {
    const firstLine = lines[0].toLowerCase();
    const isInformal = /^(give|write|create|implement|make|build|design|you|your|the|there|some|an?|in|on|at|for|with|given)\s/i.test(firstLine);
    if (!isInformal) {
      const titleWords = firstLine
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOP.has(w));
      if (titleWords.length >= 1) {
        return titleWords.slice(0, 3).join('_');
      }
    }
  }

  // Priority 3: "Return/find the X" pattern from description
  // Uses a LIGHT stop-word list (only articles/prepositions) so domain nouns
  // like "coins", "maximum", "substring" are kept in the function name.
  const LIGHT_STOP = new Set([
    'the', 'a', 'an', 'of', 'you', 'can', 'by', 'in', 'from', 'to',
    'for', 'and', 'or', 'that', 'is', 'are', 'be', 'will', 'should',
    'must', 'may', 'each', 'all', 'using', 'given', 'without', 'with',
    'not', 'no', 'if', 'then', 'else', 'when', 'your', 'its', 'it',
    'this', 'these', 'those', 'such', 'which', 'who', 'whom', 'whose',
    'what', 'where', 'how', 'why', 'about', 'them', 'they', 'we', 'he',
    'she', 'function', 'write', 'create', 'implement', 'define', 'make',
    'build', 'design', 'problem', 'statement', 'there',
  ]);
  const ret = text.match(/(?:Return|Find|find|return)\s+(?:the\s+)?(.+?)(?:[.\n]|$)/i);
  if (ret) {
    const words = ret[1]
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !LIGHT_STOP.has(w));
    if (words.length >= 1) return words.slice(0, 3).join('_');
  }

  // Priority 4: Look for any DSA action verb in the text
  const verbs = ['add', 'sum', 'subtract', 'multiply', 'divide', 'merge', 'sort',
    'reverse', 'count', 'search', 'insert', 'delete', 'remove', 'swap',
    'rotate', 'clone', 'copy', 'compare', 'check', 'validate', 'convert',
    'parse', 'evaluate', 'calculate', 'compute', 'traverse', 'balance'];
  for (const v of verbs) {
    if (new RegExp(`\\b${v}\\b`, 'i').test(text)) return v;
  }

  return 'solve';
}

/**
 * Build the visible solution stub — just the function definition.
 * The harness is generated separately via buildHarness() and hidden from the editor.
 */
export function buildSolutionStub(params: InferredParam[], funcName: string): string {
  const paramNames = params.map(p => p.name).join(', ');
  return `def ${funcName}(${paramNames}):\n    # Write your solution here\n    pass\n`;
}

/**
 * Build the hidden test harness that reads stdin, parses "name = value" pairs,
 * calls the solution function, and prints the result in LeetCode-compatible format.
 * This is appended to the solution code before sending to the backend — never shown in the editor.
 */
export function buildHarness(funcName: string): string {
  return [
    '',
    '',
    '# --- Auto-generated test harness (do not edit above) ---',
    'import sys, re, ast',
    '',
    'def _parse_args(line):',
    '    result = {}',
    '    pattern = re.compile(r\'(\\w+)\\s*=\\s*\')',
    '    matches = list(pattern.finditer(line))',
    '    for idx, m in enumerate(matches):',
    '        name = m.group(1)',
    '        val_start = m.end()',
    '        val_end = matches[idx + 1].start() if idx + 1 < len(matches) else len(line)',
    '        val_str = line[val_start:val_end].rstrip().rstrip(\',\').rstrip()',
    '        if val_str:',
    '            result[name] = ast.literal_eval(val_str)',
    '    return result',
    '',
    'def _format(result):',
    '    if isinstance(result, bool):',
    '        return \'true\' if result else \'false\'',
    '    if isinstance(result, list):',
    '        return \'[\' + \',\'.join(_format(x) for x in result) + \']\'',
    '    if isinstance(result, str):',
    '        return \'"\' + result + \'"\'',
    '    if result is None:',
    '        return \'\'',
    '    return str(result)',
    '',
    '_line = sys.stdin.read().strip()',
    'if _line:',
    '    _args = _parse_args(_line)',
    '    if _args:',
    `        print(_format(${funcName}(**_args)))`,
    '    else:',
    '        _val = ast.literal_eval(_line)',
    '        if isinstance(_val, list):',
    `            print(_format(${funcName}(*_val)))`,
    '        else:',
    `            print(_format(${funcName}(_val)))`,
  ].join('\n');
}

/**
 * Combine the visible solution code with the hidden harness for backend execution.
 */
export function withHarness(solutionCode: string, harness: string): string {
  return solutionCode + harness + '\n';
}

/**
 * Build test cases from parsed examples.
 * Each example's input becomes the test case stdin, output becomes expected.
 */
export function buildTestCasesFromExamples(
  examples: { input: string; output: string }[]
): { input: string; expected: string }[] {
  return examples
    .filter(ex => ex.input || ex.output)
    .map(ex => ({ input: ex.input, expected: ex.output }));
}
