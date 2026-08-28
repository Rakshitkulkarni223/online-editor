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
  try {
    const out: ParsedProblem['examples'] = [];

    // Strategy 1: "Example N:" / "Example:" markers (classic LeetCode format)
    const parts = text.split(/(?:^|\n)\s*Example\s*\d*\s*:\s*/i);
    for (let i = 1; i < parts.length; i++) {
      const block = parts[i].split(/\n\s*Example\s*\d*\s*:/i)[0];
      const ex = parseExampleBlock(block);
      if (ex) out.push(ex);
    }
    if (out.length > 0) return out;

    // Strategy 2: "Example N" without colon (e.g. "Example 1\nInput: ...")
    const parts2 = text.split(/(?:^|\n)\s*Example\s*\d+\s*\n/i);
    for (let i = 1; i < parts2.length; i++) {
      const block = parts2[i].split(/\n\s*Example\s*\d+/i)[0];
      const ex = parseExampleBlock(block);
      if (ex) out.push(ex);
    }
    if (out.length > 0) return out;

    // Strategy 3: "Examples" header followed by consecutive Input:/Output: pairs
    const exHeaderMatch = text.match(/(?:^|\n)\s*Examples\s*:?\s*\n/i);
    if (exHeaderMatch) {
      const afterHeader = text.slice((exHeaderMatch.index ?? 0) + exHeaderMatch[0].length);
      const conIdx = afterHeader.search(/(?:^|\n)\s*Constraints\s*:?/i);
      const exBlock = conIdx >= 0 ? afterHeader.slice(0, conIdx) : afterHeader;
      const inputChunks = exBlock.split(/(?:^|\n)\s*Input[:\s]/i).slice(1);
      for (const chunk of inputChunks) {
        const ex = parseExampleBlock(chunk);
        if (ex) out.push(ex);
      }
    }
    if (out.length > 0) return out;

    // Strategy 4: Bare Input:/Output: pairs anywhere in text (no Example header at all)
    // Stop at Constraints section if present
    const conIdx = text.search(/(?:^|\n)\s*Constraints\s*:?/i);
    const searchText = conIdx >= 0 ? text.slice(0, conIdx) : text;
    const inputChunks = searchText.split(/(?:^|\n)\s*Input\s*:\s*/i).slice(1);
    for (const chunk of inputChunks) {
      const ex = parseExampleBlock(chunk);
      if (ex) out.push(ex);
    }

    return out;
  } catch { return []; }
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

  // DSA pattern: detect tree/linked-list/graph params from common phrases
  // e.g. "Given the root of a binary tree" → root: TreeNode
  //      "Given the head of a linked list" → head: ListNode
  //      "Given two binary trees p and q" → p, q: TreeNode
  if (/\broot\b.*\b(?:binary\s+)?tree\b/i.test(description) || /\b(?:binary\s+)?tree\b.*\broot\b/i.test(description)) {
    seen.add('root');
    params.push({ name: 'root', type: 'TreeNode' });
  }
  if (/\bhead\b.*\blinked\s+list\b/i.test(description) || /\blinked\s+list\b.*\bhead\b/i.test(description)) {
    seen.add('head');
    params.push({ name: 'head', type: 'ListNode' });
  }
  // "two binary trees" or "binary trees p and q"
  const twoTreeMatch = description.match(/(?:two|2)\s+(?:\w+\s+)*?(?:binary\s+)?trees?\s+(\w+)\s+and\s+(\w+)/i);
  if (twoTreeMatch) {
    const [, a, b] = twoTreeMatch;
    if (!seen.has(a.toLowerCase())) { seen.add(a.toLowerCase()); params.push({ name: a.toLowerCase(), type: 'TreeNode' }); }
    if (!seen.has(b.toLowerCase())) { seen.add(b.toLowerCase()); params.push({ name: b.toLowerCase(), type: 'TreeNode' }); }
  }
  // "two linked lists l1 and l2" / "two non-empty linked lists l1 and l2"
  const twoListMatch = description.match(/(?:two|2)\s+(?:\w+\s+)*?(?:linked\s+)?lists?\s+(\w+)\s+and\s+(\w+)/i);
  if (twoListMatch) {
    const [, a, b] = twoListMatch;
    if (!seen.has(a.toLowerCase())) { seen.add(a.toLowerCase()); params.push({ name: a.toLowerCase(), type: 'ListNode' }); }
    if (!seen.has(b.toLowerCase())) { seen.add(b.toLowerCase()); params.push({ name: b.toLowerCase(), type: 'ListNode' }); }
  }
  // "head of a singly linked list"
  if (!seen.has('head') && /\bhead\b.*\bsingly\b/i.test(description)) {
    seen.add('head');
    params.push({ name: 'head', type: 'ListNode' });
  }
  // If we found DSA params, also look for extra scalar params (target, k, n, etc.)
  if (params.length > 0) {
    const extraMatch = description.match(/(?:an?\s+)?(?:integer|number|value)\s+(\w+)/gi);
    if (extraMatch) {
      for (const em of extraMatch) {
        const name = em.split(/\s+/).pop()?.toLowerCase() || '';
        if (name.length >= 1 && name.length <= 10 && !seen.has(name) && !/^(integer|number|value|that|which|is|are)$/i.test(name)) {
          seen.add(name);
          params.push({ name, type: 'int' });
        }
      }
    }
    return params.slice(0, 5);
  }

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
  try {
  // Common LeetCode problem → function name mappings for well-known problems
  const KNOWN: Record<string, string> = {
    'two sum': 'twoSum', 'three sum': 'threeSum', 'valid parentheses': 'isValid',
    'merge two sorted lists': 'mergeTwoLists', 'merge k sorted lists': 'mergeKLists',
    'reverse linked list': 'reverseList', 'linked list cycle': 'hasCycle',
    'palindrome linked list': 'isPalindrome', 'remove nth node from end of list': 'removeNthFromEnd',
    'validate binary search tree': 'isValidBST', 'invert binary tree': 'invertTree',
    'symmetric tree': 'isSymmetric', 'maximum depth of binary tree': 'maxDepth',
    'minimum depth of binary tree': 'minDepth', 'same tree': 'isSameTree',
    'binary tree level order traversal': 'levelOrder', 'binary tree inorder traversal': 'inorderTraversal',
    'binary tree preorder traversal': 'preorderTraversal', 'binary tree postorder traversal': 'postorderTraversal',
    'lowest common ancestor of a binary tree': 'lowestCommonAncestor',
    'lowest common ancestor of a binary search tree': 'lowestCommonAncestor',
    'construct binary tree from preorder and inorder traversal': 'buildTree',
    'flatten binary tree to linked list': 'flatten', 'path sum': 'hasPathSum',
    'number of islands': 'numIslands', 'course schedule': 'canFinish',
    'clone graph': 'cloneGraph', 'word search': 'exist',
    'surrounded regions': 'solve', 'pacific atlantic water flow': 'pacificAtlantic',
    'coin change': 'coinChange', 'climbing stairs': 'climbStairs',
    'house robber': 'rob', 'longest increasing subsequence': 'lengthOfLIS',
    'best time to buy and sell stock': 'maxProfit', 'maximum subarray': 'maxSubArray',
    'product of array except self': 'productExceptSelf', 'container with most water': 'maxArea',
    'trapping rain water': 'trap', 'valid anagram': 'isAnagram',
    'group anagrams': 'groupAnagrams', 'top k frequent elements': 'topKFrequent',
    'kth largest element in an array': 'findKthLargest', 'median of two sorted arrays': 'findMedianSortedArrays',
    'add two numbers': 'addTwoNumbers', 'remove duplicates from sorted list': 'deleteDuplicates',
    'sort list': 'sortList', 'reorder list': 'reorderList', 'rotate list': 'rotateRight',
    'odd even linked list': 'oddEvenList', 'swap nodes in pairs': 'swapPairs',
    'intersection of two linked lists': 'getIntersectionNode',
    'binary search': 'search', 'search in rotated sorted array': 'search',
    'find minimum in rotated sorted array': 'findMin',
    'serialize and deserialize binary tree': 'serialize',
    'diameter of binary tree': 'diameterOfBinaryTree',
    'balanced binary tree': 'isBalanced', 'subtree of another tree': 'isSubtree',
    'kth smallest element in a bst': 'kthSmallest',
    'binary tree right side view': 'rightSideView',
    'binary tree zigzag level order traversal': 'zigzagLevelOrder',
    'populating next right pointers in each node': 'connect',
    'count complete tree nodes': 'countNodes',
    'sum root to leaf numbers': 'sumNumbers',
    'delete node in a linked list': 'deleteNode',
    'copy list with random pointer': 'copyRandomList',
    'lru cache': 'LRUCache', 'implement trie': 'Trie',
  };

  // Check known problem names first (case-insensitive)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const title = (lines[0] || '').toLowerCase().replace(/^\d+\.\s*/, '').trim();
  if (KNOWN[title]) return KNOWN[title];

  const STOP = new Set([
    'the', 'a', 'an', 'of', 'you', 'can', 'by', 'in', 'from', 'to',
    'for', 'and', 'or', 'that', 'is', 'are', 'be', 'will', 'should',
    'must', 'may', 'each', 'all', 'using', 'given', 'without', 'with',
    'not', 'no', 'if', 'then', 'else', 'when', 'your', 'its', 'it',
    'this', 'these', 'those', 'such', 'which', 'who', 'whom', 'whose',
    'what', 'where', 'how', 'why', 'about', 'them', 'they', 'we', 'he',
    'she', 'function', 'write', 'create', 'implement', 'define', 'make',
    'build', 'design', 'problem', 'statement', 'there',
  ]);
  // DSA nouns kept in function names: tree, list, node, graph, bst, etc.

  // Priority 1: "write a function to X" / "function that Xs" / "function to X"
  const actionMatch = text.match(/(?:write\s+a\s+function\s+(?:to|that)\s+|function\s+(?:to|that)\s+)([\w\s]+?)(?:[.\n,]|$)/i);
  if (actionMatch) {
    const words = actionMatch[1]
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0 && !STOP.has(w));
    if (words.length >= 1) return words.slice(0, 3).join('_');
  }

  // Priority 2: Use the title (first non-empty line) — keep DSA nouns
  if (lines.length > 0) {
    const firstLine = lines[0].toLowerCase();
    const isInformal = /^(give|write|create|implement|make|build|design|you|your|the|there|some|an?|in|on|at|for|with|given)\s/i.test(firstLine);
    if (!isInformal) {
      const titleWords = firstLine
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOP.has(w));
      if (titleWords.length >= 1) {
        // Convert to camelCase for LeetCode style: "validate_bst" → "validateBst"
        const slug = titleWords.slice(0, 4).join('_');
        const parts = slug.split('_');
        return parts[0] + parts.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
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
  } catch { return 'solve'; }
}

/** Parameter names that indicate a TreeNode input. */
const TREE_PARAM_NAMES = new Set(['root', 'tree', 'p', 'q', 'root1', 'root2']);
/** Parameter names that indicate a ListNode input. */
const LIST_PARAM_NAMES = new Set(['head', 'node', 'l1', 'l2', 'head1', 'head2', 'list1', 'list2']);

/**
 * Build the visible solution stub — function definition + any needed class definitions.
 * The harness is generated separately via buildHarness() and hidden from the editor.
 */
export function buildSolutionStub(params: InferredParam[], funcName: string): string {
  try {
    const paramNames = params.map(p => p.name).join(', ');
    const pNames = params.map(p => p.name.toLowerCase());

    const needsTree = pNames.some(n => TREE_PARAM_NAMES.has(n));
    const needsList = pNames.some(n => LIST_PARAM_NAMES.has(n));

    let prefix = '';
    if (needsTree) {
      prefix += `class TreeNode:\n    def __init__(self, val=0, left=None, right=None):\n        self.val = val\n        self.left = left\n        self.right = right\n\n`;
    }
    if (needsList) {
      prefix += `class ListNode:\n    def __init__(self, val=0, next=None):\n        self.val = val\n        self.next = next\n\n`;
    }

    return `${prefix}def ${funcName}(${paramNames}):\n    # Write your solution here\n    pass\n`;
  } catch {
    const paramNames = params.map(p => p.name).join(', ');
    return `def ${funcName}(${paramNames}):\n    # Write your solution here\n    pass\n`;
  }
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
    'import sys, re, ast, collections',
    'from math import inf, ceil, floor, log, log2, log10, sqrt, gcd',
    'from itertools import accumulate, permutations, combinations',
    'from functools import lru_cache',
    'from collections import defaultdict, Counter, deque',
    '',
    '# --- Tree / Linked-list helpers ---',
    '# Build a binary tree from BFS-order list: [1,2,3,null,null,null,6]',
    'def _build_tree(vals):',
    '    try:',
    '        if not vals or vals[0] is None:',
    '            return None',
    '        root = TreeNode(vals[0])',
    '        q = collections.deque([root])',
    '        i = 1',
    '        while q and i < len(vals):',
    '            node = q.popleft()',
    '            if i < len(vals) and vals[i] is not None:',
    '                node.left = TreeNode(vals[i])',
    '                q.append(node.left)',
    '            i += 1',
    '            if i < len(vals) and vals[i] is not None:',
    '                node.right = TreeNode(vals[i])',
    '                q.append(node.right)',
    '            i += 1',
    '        return root',
    '    except Exception:',
    '        return vals',
    '',
    '# Build a singly linked list from array: [1,2,3,4,5]',
    'def _build_list(vals):',
    '    try:',
    '        if not vals:',
    '            return None',
    '        head = ListNode(vals[0])',
    '        cur = head',
    '        for v in vals[1:]:',
    '            cur.next = ListNode(v)',
    '            cur = cur.next',
    '        return head',
    '    except Exception:',
    '        return vals',
    '',
    '# Serialize tree to BFS-order list (for output formatting)',
    'def _tree_to_list(root):',
    '    try:',
    '        if root is None:',
    '            return []',
    '        result = []',
    '        q = collections.deque([root])',
    '        while q:',
    '            node = q.popleft()',
    '            if node is None:',
    '                result.append(None)',
    '            else:',
    '                result.append(node.val)',
    '                q.append(node.left)',
    '                q.append(node.right)',
    '        while result and result[-1] is None:',
    '            result.pop()',
    '        return result',
    '    except Exception:',
    '        return []',
    '',
    '# Serialize linked list to array',
    'def _list_to_arr(head):',
    '    try:',
    '        result = []',
    '        seen = set()',
    '        cur = head',
    '        while cur and id(cur) not in seen and len(result) < 1000:',
    '            seen.add(id(cur))',
    '            result.append(cur.val)',
    '            cur = cur.next',
    '        return result',
    '    except Exception:',
    '        return []',
    '',
    '# Parameter names that indicate tree or linked-list inputs',
    '_TREE_PARAMS = {"root", "tree", "p", "q", "root1", "root2"}',
    '_LIST_PARAMS = {"head", "node", "l1", "l2", "head1", "head2", "list1", "list2"}',
    '',
    '# Convert parsed args: turn lists into TreeNode/ListNode where appropriate',
    'def _convert_args(args):',
    '    try:',
    '        for name, val in args.items():',
    '            if isinstance(val, list):',
    '                if name.lower() in _TREE_PARAMS:',
    '                    args[name] = _build_tree(val)',
    '                elif name.lower() in _LIST_PARAMS:',
    '                    args[name] = _build_list(val)',
    '    except Exception:',
    '        pass',
    '    return args',
    '',
    'def _parse_args(line):',
    '    try:',
    '        result = {}',
    '        pattern = re.compile(r\'(\\w+)\\s*=\\s*\')',
    '        matches = list(pattern.finditer(line))',
    '        for idx, m in enumerate(matches):',
    '            name = m.group(1)',
    '            val_start = m.end()',
    '            val_end = matches[idx + 1].start() if idx + 1 < len(matches) else len(line)',
    '            val_str = line[val_start:val_end].rstrip().rstrip(\',\').rstrip()',
    '            if val_str:',
    '                # Handle LeetCode-style null/true/false',
    '                val_str = re.sub(r\'\\bnull\\b\', \'None\', val_str)',
    '                val_str = re.sub(r\'\\btrue\\b\', \'True\', val_str)',
    '                val_str = re.sub(r\'\\bfalse\\b\', \'False\', val_str)',
    '                result[name] = ast.literal_eval(val_str)',
    '        return result',
    '    except Exception:',
    '        return {}',
    '',
    'def _format(result):',
    '    try:',
    '        if isinstance(result, bool):',
    '            return \'true\' if result else \'false\'',
    '        if isinstance(result, list):',
    '            return \'[\' + \',\'.join(_format(x) for x in result) + \']\'',
    '        if isinstance(result, str):',
    '            return \'"\' + result + \'"\'',
    '        if result is None:',
    '            return \'null\'',
    '        # Handle TreeNode output — serialize to BFS list',
    '        if hasattr(result, \'val\') and (hasattr(result, \'left\') or hasattr(result, \'right\')):',
    '            return _format(_tree_to_list(result))',
    '        # Handle ListNode output — serialize to array',
    '        if hasattr(result, \'val\') and hasattr(result, \'next\'):',
    '            return _format(_list_to_arr(result))',
    '        return str(result)',
    '    except Exception:',
    '        return str(result)',
    '',
    'try:',
    '    _line = sys.stdin.read().strip()',
    '    if _line:',
    '        _args = _parse_args(_line)',
    '        if _args:',
    '            _args = _convert_args(_args)',
    `            print(_format(${funcName}(**_args)))`,
    '        else:',
    '            # Handle LeetCode-style null/true/false in raw input too',
    '            _clean = re.sub(r\'\\bnull\\b\', \'None\', _line)',
    '            _clean = re.sub(r\'\\btrue\\b\', \'True\', _clean)',
    '            _clean = re.sub(r\'\\bfalse\\b\', \'False\', _clean)',
    '            _val = ast.literal_eval(_clean)',
    '            if isinstance(_val, list):',
    `                print(_format(${funcName}(*_val)))`,
    '            else:',
    `                print(_format(${funcName}(_val)))`,
    'except Exception as _e:',
    '    print(f"Error: {_e}", file=sys.stderr)',
  ].join('\n');
}

/**
 * Combine the visible solution code with the hidden harness for backend execution.
 */
export function withHarness(solutionCode: string, harness: string): string {
  return solutionCode + harness + '\n';
}

/**
 * Default test cases for well-known LeetCode problems (with expected output).
 */
const KNOWN_TESTS: Record<string, { input: string; expected: string }[]> = {
  'isValidBST': [
    { input: 'root = [2,1,3]', expected: 'true' },
    { input: 'root = [5,1,4,null,null,3,6]', expected: 'false' },
    { input: 'root = [1]', expected: 'true' },
    { input: 'root = [2,2,2]', expected: 'false' },
    { input: 'root = [5,4,6,null,null,3,7]', expected: 'false' },
  ],
  'invertTree': [
    { input: 'root = [4,2,7,1,3,6,9]', expected: '[4,7,2,9,6,3,1]' },
    { input: 'root = [2,1,3]', expected: '[2,3,1]' },
    { input: 'root = []', expected: '[]' },
    { input: 'root = [1]', expected: '[1]' },
    { input: 'root = [1,2]', expected: '[1,null,2]' },
  ],
  'maxDepth': [
    { input: 'root = [3,9,20,null,null,15,7]', expected: '3' },
    { input: 'root = [1,null,2]', expected: '2' },
    { input: 'root = []', expected: '0' },
    { input: 'root = [1]', expected: '1' },
    { input: 'root = [1,2,3,4,5]', expected: '3' },
  ],
  'isSymmetric': [
    { input: 'root = [1,2,2,3,4,4,3]', expected: 'true' },
    { input: 'root = [1,2,2,null,3,null,3]', expected: 'false' },
    { input: 'root = [1]', expected: 'true' },
    { input: 'root = []', expected: 'true' },
    { input: 'root = [1,2,2]', expected: 'true' },
  ],
  'isSameTree': [
    { input: 'p = [1,2,3], q = [1,2,3]', expected: 'true' },
    { input: 'p = [1,2], q = [1,null,2]', expected: 'false' },
    { input: 'p = [], q = []', expected: 'true' },
    { input: 'p = [1], q = [1]', expected: 'true' },
    { input: 'p = [1], q = [2]', expected: 'false' },
  ],
  'levelOrder': [
    { input: 'root = [3,9,20,null,null,15,7]', expected: '[[3],[9,20],[15,7]]' },
    { input: 'root = [1]', expected: '[[1]]' },
    { input: 'root = []', expected: '[]' },
    { input: 'root = [1,2,3,4,5]', expected: '[[1],[2,3],[4,5]]' },
    { input: 'root = [1,null,2]', expected: '[[1],[2]]' },
  ],
  'inorderTraversal': [
    { input: 'root = [1,null,2,3]', expected: '[1,3,2]' },
    { input: 'root = []', expected: '[]' },
    { input: 'root = [1]', expected: '[1]' },
    { input: 'root = [1,2,3]', expected: '[2,1,3]' },
    { input: 'root = [3,1,2]', expected: '[1,3,2]' },
  ],
  'preorderTraversal': [
    { input: 'root = [1,null,2,3]', expected: '[1,2,3]' },
    { input: 'root = []', expected: '[]' },
    { input: 'root = [1]', expected: '[1]' },
    { input: 'root = [1,2,3]', expected: '[1,2,3]' },
  ],
  'postorderTraversal': [
    { input: 'root = [1,null,2,3]', expected: '[3,2,1]' },
    { input: 'root = []', expected: '[]' },
    { input: 'root = [1]', expected: '[1]' },
  ],
  'reverseList': [
    { input: 'head = [1,2,3,4,5]', expected: '[5,4,3,2,1]' },
    { input: 'head = [1,2]', expected: '[2,1]' },
    { input: 'head = []', expected: '[]' },
    { input: 'head = [1]', expected: '[1]' },
    { input: 'head = [1,2,3]', expected: '[3,2,1]' },
  ],
  'hasCycle': [
    { input: 'head = [3,2,0,-4]', expected: 'false' },
    { input: 'head = [1,2]', expected: 'false' },
    { input: 'head = [1]', expected: 'false' },
    { input: 'head = []', expected: 'false' },
  ],
  'mergeTwoLists': [
    { input: 'l1 = [1,2,4], l2 = [1,3,4]', expected: '[1,1,2,3,4,4]' },
    { input: 'l1 = [], l2 = []', expected: '[]' },
    { input: 'l1 = [], l2 = [0]', expected: '[0]' },
    { input: 'l1 = [1], l2 = [2]', expected: '[1,2]' },
    { input: 'l1 = [5,10,15], l2 = [2,3,20]', expected: '[2,3,5,10,15,20]' },
  ],
  'twoSum': [
    { input: 'nums = [2,7,11,15], target = 9', expected: '[0,1]' },
    { input: 'nums = [3,2,4], target = 6', expected: '[1,2]' },
    { input: 'nums = [3,3], target = 6', expected: '[0,1]' },
    { input: 'nums = [1,2,3,4,5], target = 9', expected: '[3,4]' },
    { input: 'nums = [-1,-2,-3,-4,-5], target = -8', expected: '[2,4]' },
  ],
  'maxSubArray': [
    { input: 'nums = [-2,1,-3,4,-1,2,1,-5,4]', expected: '6' },
    { input: 'nums = [1]', expected: '1' },
    { input: 'nums = [5,4,-1,7,8]', expected: '23' },
    { input: 'nums = [-1]', expected: '-1' },
    { input: 'nums = [-2,-1]', expected: '-1' },
  ],
  'maxProfit': [
    { input: 'prices = [7,1,5,3,6,4]', expected: '5' },
    { input: 'prices = [7,6,4,3,1]', expected: '0' },
    { input: 'prices = [1,2]', expected: '1' },
    { input: 'prices = [2,4,1]', expected: '2' },
    { input: 'prices = [1]', expected: '0' },
  ],
  'climbStairs': [
    { input: 'n = 2', expected: '2' },
    { input: 'n = 3', expected: '3' },
    { input: 'n = 1', expected: '1' },
    { input: 'n = 4', expected: '5' },
    { input: 'n = 5', expected: '8' },
  ],
  'coinChange': [
    { input: 'coins = [1,2,5], amount = 11', expected: '3' },
    { input: 'coins = [2], amount = 3', expected: '-1' },
    { input: 'coins = [1], amount = 0', expected: '0' },
    { input: 'coins = [1,5,10,25], amount = 30', expected: '2' },
    { input: 'coins = [186,419,83,408], amount = 6249', expected: '20' },
  ],
  'numIslands': [
    { input: 'grid = [["1","1","1","1","0"],["1","1","0","1","0"],["1","1","0","0","0"],["0","0","0","0","0"]]', expected: '1' },
    { input: 'grid = [["1","1","0","0","0"],["1","1","0","0","0"],["0","0","1","0","0"],["0","0","0","1","1"]]', expected: '3' },
    { input: 'grid = [["1"]]', expected: '1' },
    { input: 'grid = [["0"]]', expected: '0' },
  ],
  'addTwoNumbers': [
    { input: 'l1 = [2,4,3], l2 = [5,6,4]', expected: '[7,0,8]' },
    { input: 'l1 = [0], l2 = [0]', expected: '[0]' },
    { input: 'l1 = [9,9,9,9,9,9,9], l2 = [9,9,9,9]', expected: '[8,9,9,9,0,0,0,1]' },
    { input: 'l1 = [1], l2 = [9,9]', expected: '[0,0,1]' },
  ],
  'lowestCommonAncestor': [
    { input: 'root = [6,2,8,0,4,7,9,null,null,3,5], p = 2, q = 8', expected: '6' },
    { input: 'root = [6,2,8,0,4,7,9,null,null,3,5], p = 2, q = 4', expected: '2' },
    { input: 'root = [2,1], p = 2, q = 1', expected: '2' },
  ],
  'isBalanced': [
    { input: 'root = [3,9,20,null,null,15,7]', expected: 'true' },
    { input: 'root = [1,2,2,3,3,null,null,4,4]', expected: 'false' },
    { input: 'root = []', expected: 'true' },
    { input: 'root = [1]', expected: 'true' },
    { input: 'root = [1,2,2,3,null,null,3,4,null,null,4]', expected: 'false' },
  ],
  'diameterOfBinaryTree': [
    { input: 'root = [1,2,3,4,5]', expected: '3' },
    { input: 'root = [1,2]', expected: '1' },
    { input: 'root = [1]', expected: '0' },
    { input: 'root = [4,2,null,1,3]', expected: '2' },
  ],
  'rob': [
    { input: 'nums = [1,2,3,1]', expected: '4' },
    { input: 'nums = [2,7,9,3,1]', expected: '12' },
    { input: 'nums = [2,1,1,2]', expected: '4' },
    { input: 'nums = [0]', expected: '0' },
    { input: 'nums = [1,2]', expected: '2' },
  ],
  'lengthOfLIS': [
    { input: 'nums = [10,9,2,5,3,7,101,18]', expected: '4' },
    { input: 'nums = [0,1,0,3,2,3]', expected: '4' },
    { input: 'nums = [7,7,7,7,7,7,7]', expected: '1' },
    { input: 'nums = [1,3,6,7,9,4,10,5,6]', expected: '6' },
  ],
  'productExceptSelf': [
    { input: 'nums = [1,2,3,4]', expected: '[24,12,8,6]' },
    { input: 'nums = [-1,1,0,-3,3]', expected: '[0,0,9,0,0]' },
    { input: 'nums = [2,3]', expected: '[3,2]' },
    { input: 'nums = [1,1,1,1]', expected: '[1,1,1,1]' },
  ],
  'isValid': [
    { input: 's = "()"', expected: 'true' },
    { input: 's = "()[]{}"', expected: 'true' },
    { input: 's = "(]"', expected: 'false' },
    { input: 's = "([)]"', expected: 'false' },
    { input: 's = "{[]}"', expected: 'true' },
  ],
  'isPalindrome': [
    { input: 'head = [1,2,2,1]', expected: 'true' },
    { input: 'head = [1,2]', expected: 'false' },
    { input: 'head = [1]', expected: 'true' },
    { input: 'head = [1,2,3,2,1]', expected: 'true' },
  ],
  'hasPathSum': [
    { input: 'root = [5,4,8,11,null,13,4,7,2,null,null,null,1], targetSum = 22', expected: 'true' },
    { input: 'root = [1,2,3], targetSum = 5', expected: 'false' },
    { input: 'root = [], targetSum = 0', expected: 'false' },
  ],
  'flatten': [
    { input: 'root = [1,2,5,3,4,null,6]', expected: '[1,null,2,null,3,null,4,null,5,null,6]' },
    { input: 'root = []', expected: '[]' },
    { input: 'root = [0]', expected: '[0]' },
  ],
  'search': [
    { input: 'nums = [-1,0,3,5,9,12], target = 9', expected: '4' },
    { input: 'nums = [-1,0,3,5,9,12], target = 2', expected: '-1' },
    { input: 'nums = [5], target = 5', expected: '0' },
  ],
  'findMin': [
    { input: 'nums = [3,4,5,1,2]', expected: '1' },
    { input: 'nums = [4,5,6,7,0,1,2]', expected: '0' },
    { input: 'nums = [11,13,15,17]', expected: '11' },
  ],
  'canFinish': [
    { input: 'numCourses = 2, prerequisites = [[1,0]]', expected: 'true' },
    { input: 'numCourses = 2, prerequisites = [[1,0],[0,1]]', expected: 'false' },
    { input: 'numCourses = 1, prerequisites = []', expected: 'true' },
  ],
  'isAnagram': [
    { input: 's = "anagram", t = "nagaram"', expected: 'true' },
    { input: 's = "rat", t = "car"', expected: 'false' },
    { input: 's = "a", t = "a"', expected: 'true' },
  ],
  'groupAnagrams': [
    { input: 'strs = ["eat","tea","tan","ate","nat","bat"]', expected: '[["bat"],["eat","tea","ate"],["tan","nat"]]' },
    { input: 'strs = [""]', expected: '[[""]]' },
    { input: 'strs = ["a"]', expected: '[["a"]]' },
  ],
  'maxArea': [
    { input: 'height = [1,8,6,2,5,4,8,3,7]', expected: '49' },
    { input: 'height = [1,1]', expected: '1' },
    { input: 'height = [4,3,2,1,4]', expected: '16' },
  ],
  'trap': [
    { input: 'height = [0,1,0,2,1,0,1,3,2,1,2,1]', expected: '6' },
    { input: 'height = [4,2,0,3,2,5]', expected: '9' },
    { input: 'height = [4,2,3]', expected: '1' },
  ],
  'deleteDuplicates': [
    { input: 'head = [1,1,2]', expected: '[1,2]' },
    { input: 'head = [1,1,2,3,3]', expected: '[1,2,3]' },
    { input: 'head = []', expected: '[]' },
  ],
  'sortList': [
    { input: 'head = [4,2,1,3]', expected: '[1,2,3,4]' },
    { input: 'head = [-1,5,3,4,0]', expected: '[-1,0,3,4,5]' },
    { input: 'head = []', expected: '[]' },
  ],
  'removeNthFromEnd': [
    { input: 'head = [1,2,3,4,5], n = 2', expected: '[1,2,3,5]' },
    { input: 'head = [1], n = 1', expected: '[]' },
    { input: 'head = [1,2], n = 1', expected: '[1]' },
  ],
  'swapPairs': [
    { input: 'head = [1,2,3,4]', expected: '[2,1,4,3]' },
    { input: 'head = []', expected: '[]' },
    { input: 'head = [1]', expected: '[1]' },
  ],
  'kthSmallest': [
    { input: 'root = [3,1,4,null,2], k = 1', expected: '1' },
    { input: 'root = [5,3,6,2,4,null,null,1], k = 3', expected: '3' },
  ],
  'rightSideView': [
    { input: 'root = [1,2,3,null,5,null,4]', expected: '[1,3,4]' },
    { input: 'root = [1,null,3]', expected: '[1,3]' },
    { input: 'root = []', expected: '[]' },
  ],
  'countNodes': [
    { input: 'root = [1,2,3,4,5,6]', expected: '6' },
    { input: 'root = []', expected: '0' },
    { input: 'root = [1]', expected: '1' },
  ],
  'sumNumbers': [
    { input: 'root = [1,2,3]', expected: '25' },
    { input: 'root = [4,9,0,5,1]', expected: '1026' },
  ],
  'isSubtree': [
    { input: 'root = [3,4,5,1,2], subRoot = [4,1,2]', expected: 'true' },
    { input: 'root = [3,4,5,1,2,null,null,null,null,0], subRoot = [4,1,2]', expected: 'false' },
  ],
  'oddEvenList': [
    { input: 'head = [1,2,3,4,5]', expected: '[1,3,5,2,4]' },
    { input: 'head = [2,1,3,5,6,4,7]', expected: '[2,3,6,7,1,5,4]' },
  ],
  'reorderList': [
    { input: 'head = [1,2,3,4]', expected: '[1,4,2,3]' },
    { input: 'head = [1,2,3,4,5]', expected: '[1,5,2,4,3]' },
  ],
  'findKthLargest': [
    { input: 'nums = [3,2,1,5,6,4], k = 2', expected: '5' },
    { input: 'nums = [3,2,3,1,2,4,5,5,6], k = 4', expected: '4' },
  ],
  'topKFrequent': [
    { input: 'nums = [1,1,1,2,2,3], k = 2', expected: '[1,2]' },
    { input: 'nums = [1], k = 1', expected: '[1]' },
  ],
};

/**
 * Build test cases from parsed examples.
 * Each example's input becomes the test case stdin, output becomes expected.
 * If no examples exist, generates sensible defaults based on the inferred params.
 */
export function buildTestCasesFromExamples(
  examples: { input: string; output: string }[],
  params?: InferredParam[],
  funcName?: string,
): { input: string; expected: string }[] {
  try {
    const fromExamples = examples
      .filter(ex => ex.input || ex.output)
      .map(ex => ({ input: ex.input, expected: ex.output }));
    if (fromExamples.length > 0) return fromExamples;

    // Check known problems for default test cases with expected outputs
    if (funcName && KNOWN_TESTS[funcName]) {
      return KNOWN_TESTS[funcName];
    }

    // No examples and not a known problem — generate defaults based on parameter types
    if (!params || params.length === 0) return [];
    return generateDefaultTests(params);
  } catch { return []; }
}

/**
 * Generate sensible default test cases based on parameter names/types.
 * Mimics LeetCode's default test cases for common problem patterns.
 */
function generateDefaultTests(params: InferredParam[]): { input: string; expected: string }[] {
  try {
    const pNames = params.map(p => p.name.toLowerCase());
    const hasTree = pNames.some(n => TREE_PARAM_NAMES.has(n));
    const hasList = pNames.some(n => LIST_PARAM_NAMES.has(n));

    if (hasTree) {
      const treeName = params.find(p => TREE_PARAM_NAMES.has(p.name.toLowerCase()))?.name || 'root';
      const extras = params.filter(p => !TREE_PARAM_NAMES.has(p.name.toLowerCase()));
      const extraStr = extras.map(p => `, ${p.name} = ${defaultVal(p)}`).join('');
      return [
        { input: `${treeName} = [1,2,3]${extraStr}`, expected: '' },
        { input: `${treeName} = [1]${extraStr}`, expected: '' },
      ];
    }

    if (hasList) {
      const listNames = params.filter(p => LIST_PARAM_NAMES.has(p.name.toLowerCase()));
      const extras = params.filter(p => !LIST_PARAM_NAMES.has(p.name.toLowerCase()));
      const extraStr = extras.map(p => `, ${p.name} = ${defaultVal(p)}`).join('');
      if (listNames.length >= 2) {
        return [
          { input: `${listNames[0].name} = [1,2,3], ${listNames[1].name} = [4,5,6]${extraStr}`, expected: '' },
          { input: `${listNames[0].name} = [], ${listNames[1].name} = []${extraStr}`, expected: '' },
        ];
      }
      const ln = listNames[0].name;
      return [
        { input: `${ln} = [1,2,3,4,5]${extraStr}`, expected: '' },
        { input: `${ln} = [1]${extraStr}`, expected: '' },
      ];
    }

    // Array / general problem defaults
    const parts = params.map(p => `${p.name} = ${defaultVal(p)}`);
    return [
      { input: parts.join(', '), expected: '' },
    ];
  } catch { return []; }
}

/** Return a sensible default value string for a parameter based on its type. */
function defaultVal(p: InferredParam): string {
  try {
    const t = (p.type || '').toLowerCase();
    if (t.includes('list[list')) return '[[1,2],[3,4]]';
    if (t.includes('list') || t.includes('array')) return '[1,2,3]';
    if (t === 'str' || t === 'string') return '"abc"';
    if (t === 'bool' || t === 'boolean') return 'true';
    if (t === 'float') return '1.0';
    return '0';
  } catch { return '0'; }
}
