import React, { useMemo } from 'react';
import type { Step, VarValue, ObjectValue } from './types';
import { isScalar, isList, isDict, isObject } from './types';

/* ------------------------------------------------------------------ */
/* Primitive value rendering                                           */
/* ------------------------------------------------------------------ */

export function ScalarView({ v }: { v: VarValue }) {
  if (!isScalar(v)) return <span className="scalar">{String(v)}</span>;
  const t = v.type;
  let display: string;
  if (t === 'str') display = `"${v.value}"`;
  else if (t === 'NoneType') display = 'None';
  else if (t === 'bool') display = v.value ? 'True' : 'False';
  else display = String(v.value);
  const cls = `scalar t-${t === 'int' || t === 'float' ? 'num' : t === 'str' ? 'str' : t === 'bool' ? 'bool' : 'none'}`;
  return <span className={cls}>{display}</span>;
}

/* ------------------------------------------------------------------ */
/* Array / list                                                        */
/* ------------------------------------------------------------------ */

export function ArrayView({ v, highlight, pointers }: {
  v: VarValue;
  highlight?: number[];
  pointers?: { index: number; label: string; color: string }[];
}) {
  const items: VarValue[] = isList(v) ? v.value : [];
  const hi = new Set(highlight || []);
  const ptrMap = new Map<number, { label: string; color: string }[]>();
  for (const p of (pointers || [])) {
    if (!ptrMap.has(p.index)) ptrMap.set(p.index, []);
    ptrMap.get(p.index)!.push(p);
  }
  return (
    <div className="array-view">
      <div className="array-cells">
        {items.length === 0 && <span className="muted">empty</span>}
        {items.map((item, i) => {
          const ptrs = ptrMap.get(i);
          const isActive = hi.has(i) || !!ptrs;
          const ptrColor = ptrs?.[0]?.color;
          return (
            <div key={i} className={'array-col'}>
              <span className="array-idx">{i}</span>
              <div className={'array-cell' + (isActive ? ' active' : '')}
                style={ptrColor ? { borderColor: ptrColor, background: ptrColor + '22' } : undefined}>
                <span className="val">{renderValue(item)}</span>
              </div>
              {ptrs && (
                <div className="array-ptrs">
                  {ptrs.map((p, pi) => (
                    <span key={pi} className="array-ptr-label" style={{ color: p.color }}>{p.label}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dict / hashmap                                                      */
/* ------------------------------------------------------------------ */

export function DictView({ v, highlightKey }: { v: VarValue; highlightKey?: string }) {
  const entries = isDict(v) ? v.value : [];
  return (
    <div className="dict-view">
      {entries.length === 0 && <span className="muted">{'{ }'}</span>}
      {entries.map((e, i) => {
        const keyStr = valKey(e.key);
        return (
          <div key={i} className={'dict-row' + (highlightKey && keyStr === highlightKey ? ' active' : '')}>
            <span className="dict-key">{renderValue(e.key)}</span>
            <span className="dict-arrow">→</span>
            <span className="dict-val">{renderValue(e.val)}</span>
          </div>
        );
      })}
    </div>
  );
}

function valKey(v: VarValue): string {
  if (isScalar(v)) return String(v.value);
  return JSON.stringify(v);
}

/* ------------------------------------------------------------------ */
/* Stack (LIFO)                                                        */
/* ------------------------------------------------------------------ */

export function StackView({ v }: { v: VarValue }) {
  const items: VarValue[] = isList(v) ? v.value : [];
  const reversed = [...items].reverse(); // top first
  return (
    <div className="stack-view">
      {items.length === 0 && <span className="muted">empty stack</span>}
      {reversed.map((item, i) => (
        <div key={i} className={'stack-frame' + (i === 0 ? ' top' : '')}>
          {renderValue(item)}
        </div>
      ))}
      {items.length > 0 && <div className="stack-base">bottom</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Queue (FIFO)                                                        */
/* ------------------------------------------------------------------ */

export function QueueView({ v }: { v: VarValue }) {
  const items: VarValue[] = isList(v) ? v.value : [];
  return (
    <div className="queue-view">
      {items.length === 0 && <span className="muted">empty queue</span>}
      <div className="queue-cells">
        {items.map((item, i) => (
          <div key={i} className={'queue-cell' + (i === 0 ? ' front' : '') + (i === items.length - 1 ? ' back' : '')}>
            {renderValue(item)}
          </div>
        ))}
      </div>
      {items.length > 0 && <div className="queue-labels"><span>front</span><span>back</span></div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Generic object (attributes)                                         */
/* ------------------------------------------------------------------ */

export function ObjectView({ v }: { v: VarValue }) {
  const attrs: Record<string, VarValue> = isObject(v) && v.value ? v.value : {};
  const entries = Object.entries(attrs);
  return (
    <div className="object-view">
      <div className="object-type">{v.type}</div>
      {entries.length === 0 ? (
        <span className="muted">{(isObject(v) && v.repr) || '{}'}</span>
      ) : (
        entries.map(([k, val]) => (
          <div key={k} className="object-attr"><span className="attr-name">{k}</span>: {renderValue(val)}</div>
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recursive dispatcher                                                */
/* ------------------------------------------------------------------ */

export function renderValue(v: VarValue, depth = 0): React.ReactNode {
  if (depth > 6) return <span className="muted">…</span>;
  if (isList(v)) return <ArrayView v={v} />;
  if (isDict(v)) return <DictView v={v} />;
  if (isScalar(v)) return <ScalarView v={v} />;
  return <ObjectView v={v} />;
}

/* ------------------------------------------------------------------ */
/* Call stack                                                          */
/* ------------------------------------------------------------------ */

export function CallStackView({ stack }: { stack: string[] }) {
  const frames = [...stack].reverse(); // top of stack first
  return (
    <div className="callstack-view">
      {frames.length === 0 && <span className="muted">module scope</span>}
      {frames.map((f, i) => (
        <div key={i} className={'callstack-frame' + (i === 0 ? ' top' : '')}>
          <span className="frame-dot" /> {f}()
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DSA-specific auto visualizers                                       */
/* ------------------------------------------------------------------ */

type Locals = Record<string, VarValue>;

function intVal(v: VarValue | undefined): number | undefined {
  if (v && isScalar(v) && (v.type === 'int' || v.type === 'float')) return v.value as number;
  return undefined;
}
function is2DList(v: VarValue | undefined): boolean {
  if (!v || !isList(v)) return false;
  return v.value.length > 0 && isList(v.value[0]);
}

export type DSADetection = {
  kind: 'two_pointers' | 'sliding_window' | 'binary_search' | 'dp_table'
    | 'linked_list' | 'tree' | 'graph' | 'heap' | 'sorting' | 'recursion' | 'none';
  title: string;
};

/** Check if a VarValue is a tree-like object (has val + left/right). */
function isTreeNode(v: VarValue | undefined): boolean {
  try {
    if (!v || !isObject(v) || !v.value) return false;
    const attrs = Object.keys(v.value);
    return (attrs.includes('left') || attrs.includes('right')) && attrs.includes('val');
  } catch { return false; }
}

/** Check if a VarValue is a linked-list-like object (has val + next). */
function isListNode(v: VarValue | undefined): boolean {
  try {
    if (!v || !isObject(v) || !v.value) return false;
    const attrs = Object.keys(v.value);
    return attrs.includes('next') && attrs.includes('val');
  } catch { return false; }
}

/** Check if a variable looks like a graph adjacency list: dict of lists or list of lists. */
function isGraphAdj(v: VarValue | undefined): boolean {
  try {
    if (!v) return false;
    // dict { node: [neighbors] }
    if (isDict(v) && v.value.length > 0) {
      return v.value.some(e => isList(e.val));
    }
    // list of lists (adjacency list indexed by node number)
    if (isList(v) && v.value.length > 1 && v.value.every(item => isList(item))) {
      return true;
    }
    return false;
  } catch { return false; }
}

/** Check if a variable name suggests it's a heap. */
function isHeapLike(name: string, v: VarValue): boolean {
  try {
    const lower = name.toLowerCase();
    return isList(v) && (lower.includes('heap') || lower === 'pq' || lower.includes('priority'));
  } catch { return false; }
}

/** Check if variables suggest a sorting algorithm (array + swap/compare indicators). */
function isSortingLike(names: string[], locals: Locals): boolean {
  try {
    const has = (...ns: string[]) => ns.some(n => names.includes(n));
    const arrayVar = names.find(n => isList(locals[n]));
    if (!arrayVar) return false;
    // Common sorting variable patterns
    return has('i', 'j') && (
      has('temp', 'swap', 'key', 'pivot', 'min_idx', 'min_index', 'gap', 'swapped')
      || (has('i', 'j') && !has('left', 'right', 'mid'))
    );
  } catch { return false; }
}

/** Inspect locals and decide which specialized visualizer (if any) applies. */
export function detectDSA(locals: Locals): DSADetection {
  try {
    const names = Object.keys(locals);
    const has = (...ns: string[]) => ns.some(n => names.includes(n));
    const arrayVar = names.find(n => isList(locals[n]));

    if (arrayVar && has('left', 'right') && has('mid')) {
      return { kind: 'binary_search', title: 'Binary Search' };
    }
    if (arrayVar && has('left', 'right')) {
      return has('window', 'sum', 'count', 'valid', 'k')
        ? { kind: 'sliding_window', title: 'Sliding Window' }
        : { kind: 'two_pointers', title: 'Two Pointers' };
    }

    // Heap detection (before generic array)
    const heapVar = names.find(n => isHeapLike(n, locals[n]));
    if (heapVar) return { kind: 'heap', title: 'Heap / Priority Queue' };

    // Graph detection (adjacency list/dict)
    const graphNames = ['graph', 'adj', 'adj_list', 'adjacency', 'neighbors', 'edges', 'g'];
    const graphVar = graphNames.find(n => names.includes(n) && isGraphAdj(locals[n]))
      || names.find(n => isGraphAdj(locals[n]));
    if (graphVar && has('visited', 'seen', 'queue', 'stack', 'dist', 'distance', 'parent', 'color', 'in_degree', 'indegree')) {
      return { kind: 'graph', title: 'Graph Traversal' };
    }
    if (graphVar) return { kind: 'graph', title: 'Graph' };

    // Sorting detection
    if (isSortingLike(names, locals)) {
      return { kind: 'sorting', title: 'Sorting' };
    }

    if (names.some(n => is2DList(locals[n]))) {
      return { kind: 'dp_table', title: 'DP Table' };
    }

    // Linked list / tree
    const treeVar = names.find(n => isTreeNode(locals[n]));
    if (treeVar) return { kind: 'tree', title: 'Binary Tree' };

    const llVar = names.find(n => isListNode(locals[n]));
    if (llVar) return { kind: 'linked_list', title: 'Linked List' };

    // Fallback: check for generic objects with next or val attributes
    const objVar = names.find(n => {
      const v = locals[n];
      if (!v || !isObject(v) || !v.value) return false;
      const attrs = Object.keys(v.value);
      return attrs.includes('next') || attrs.includes('val');
    });
    if (objVar) {
      const v = locals[objVar];
      const attrs = (isObject(v) && v.value) ? Object.keys(v.value) : [];
      if (attrs.includes('left') || attrs.includes('right')) return { kind: 'tree', title: 'Binary Tree' };
      if (attrs.includes('next')) return { kind: 'linked_list', title: 'Linked List' };
    }
    return { kind: 'none', title: '' };
  } catch { return { kind: 'none', title: '' }; }
}

export function DSAVisualizer({ locals, detection }: { locals: Locals; detection: DSADetection }) {
  try {
  const names = Object.keys(locals);
  const arrayVar = names.find(n => isList(locals[n])) || '';
  const arr = arrayVar ? locals[arrayVar] : undefined;

  if (detection.kind === 'binary_search' || detection.kind === 'two_pointers' || detection.kind === 'sliding_window') {
    const l = names.includes('left') ? intVal(locals['left']) : undefined;
    const r = names.includes('right') ? intVal(locals['right']) : undefined;
    const m = names.includes('mid') ? intVal(locals['mid']) : undefined;
    const pointers: { index: number; label: string; color: string }[] = [];
    if (l !== undefined) pointers.push({ index: l, label: 'L', color: '#3fb950' });
    if (m !== undefined) pointers.push({ index: m, label: 'M', color: '#d2a8ff' });
    if (r !== undefined) pointers.push({ index: r, label: 'R', color: '#f47067' });
    return (
      <div className="dsa-viz">
        <div className="dsa-title">{detection.title} <small>on {arrayVar}</small></div>
        {arr && <ArrayView v={arr} pointers={pointers} />}
      </div>
    );
  }

  if (detection.kind === 'dp_table') {
    const dpVar = names.find(n => is2DList(locals[n])) || '';
    const dp = locals[dpVar];
    const rows: VarValue[] = dp && isList(dp) ? dp.value : [];
    return (
      <div className="dsa-viz">
        <div className="dsa-title">DP Table <small>{dpVar}</small></div>
        <table className="dp-table">
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {(isList(row) ? row.value : []).map((cell, j) => (
                  <td key={j} className="dp-cell">{renderValue(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (detection.kind === 'linked_list') {
    try {
      const preferredNames = ['head', 'node', 'cur', 'current', 'p', 'self', 'dummy'];
      const headVar = preferredNames.find(n => names.includes(n) && isListNode(locals[n]))
        || names.find(n => isListNode(locals[n]))
        || '';
      const head = locals[headVar];
      const nodes = linkedListNodes(head);
      const hasCycle = nodes.length > 0 && nodes[nodes.length - 1] === '↻';
      // Detect current pointer variable for highlighting
      const curVar = ['cur', 'current', 'node', 'p', 'q'].find(n =>
        names.includes(n) && n !== headVar && isListNode(locals[n]));
      const curRepr = curVar && locals[curVar] && isObject(locals[curVar]) ? (locals[curVar] as any).repr : undefined;
      return (
        <div className="dsa-viz">
          <div className="dsa-title">Linked List <small>{headVar}</small></div>
          <div className="ll-view">
            {nodes.length === 0 && <span className="ll-null-circle">null</span>}
            {nodes.map((n, i) => (
              <React.Fragment key={i}>
                <div className="ll-node-col">
                  {i === 0 && <span className="ll-label ll-head">head</span>}
                  {i === nodes.length - 1 && !hasCycle && nodes.length > 1 && <span className="ll-label ll-tail">tail</span>}
                  <div className={
                    'll-node'
                    + (i === 0 ? ' ll-head-node' : '')
                    + (n === '↻' ? ' ll-cycle' : '')
                    + (i === nodes.length - 1 && !hasCycle ? ' ll-tail-node' : '')
                  }>{n}</div>
                </div>
                {i < nodes.length - 1 && <span className="ll-arrow">→</span>}
              </React.Fragment>
            ))}
            {nodes.length > 0 && !hasCycle && (
              <>
                <span className="ll-arrow">→</span>
                <div className="ll-null-circle">null</div>
              </>
            )}
          </div>
        </div>
      );
    } catch { return null; }
  }

  if (detection.kind === 'tree') {
    try {
      const preferredNames = ['root', 'node', 'tree', 'head', 'cur', 'current', 'p', 'self'];
      const rootVar = preferredNames.find(n => names.includes(n) && isTreeNode(locals[n]))
        || names.find(n => isTreeNode(locals[n]))
        || '';
      const root = locals[rootVar];
      // Detect current node for highlighting during traversal
      const curVar = ['node', 'cur', 'current', 'p'].find(n =>
        names.includes(n) && n !== rootVar && isTreeNode(locals[n]));
      const curRepr = curVar && locals[curVar] && isObject(locals[curVar]) ? (locals[curVar] as any).repr : undefined;
      if (isNoneValue(root)) {
        return (
          <div className="dsa-viz">
            <div className="dsa-title">Binary Tree <small>{rootVar || '?'}</small></div>
            <div className="tree-view"><span className="muted">null</span></div>
          </div>
        );
      }
      return (
        <div className="dsa-viz">
          <div className="dsa-title">Binary Tree <small>{rootVar}</small></div>
          <div className="tree-view">
            <div className="tree-root-label">{rootVar}</div>
            {renderTree(root, 0, curRepr)}
          </div>
        </div>
      );
    } catch { return null; }
  }

  if (detection.kind === 'graph') {
    try {
      const graphNames = ['graph', 'adj', 'adj_list', 'adjacency', 'neighbors', 'edges', 'g'];
      const graphVar = graphNames.find(n => names.includes(n) && isGraphAdj(locals[n]))
        || names.find(n => isGraphAdj(locals[n])) || '';
      const graph = locals[graphVar];
      // Extract visited/seen set for highlighting
      const visitedVar = names.find(n => ['visited', 'seen'].includes(n));
      const visitedSet = visitedVar ? extractSet(locals[visitedVar]) : new Set<string>();
      // Extract queue/stack for frontier highlighting
      const frontierVar = names.find(n => ['queue', 'stack', 'q', 's'].includes(n) && isList(locals[n]));
      const frontierItems = frontierVar ? extractListScalars(locals[frontierVar]) : [];
      const frontierSet = new Set(frontierItems.map(String));
      // Current node
      const curVar = names.find(n => ['node', 'cur', 'current', 'u', 'v', 'src', 'start'].includes(n));
      const curNode = curVar ? scalarText(locals[curVar]) : undefined;

      return (
        <div className="dsa-viz">
          <div className="dsa-title">{detection.title} <small>{graphVar}</small></div>
          <GraphView graph={graph} visited={visitedSet} frontier={frontierSet} current={curNode !== undefined ? String(curNode) : undefined} />
        </div>
      );
    } catch { return null; }
  }

  if (detection.kind === 'heap') {
    try {
      const heapVar = names.find(n => isHeapLike(n, locals[n])) || '';
      const heap = locals[heapVar];
      const items: VarValue[] = isList(heap) ? heap.value : [];
      return (
        <div className="dsa-viz">
          <div className="dsa-title">Heap / Priority Queue <small>{heapVar}</small></div>
          <div className="heap-view">
            <div className="heap-array">
              {items.map((item, i) => (
                <div key={i} className={'heap-cell' + (i === 0 ? ' heap-root' : '')}>
                  <span className="idx">{i}</span>
                  <span className="val">{renderValue(item)}</span>
                </div>
              ))}
            </div>
            {items.length > 0 && (
              <div className="heap-tree-view">
                {renderHeapTree(items, 0, 0)}
              </div>
            )}
          </div>
        </div>
      );
    } catch { return null; }
  }

  if (detection.kind === 'sorting') {
    try {
      const sortArrayVar = names.find(n => isList(locals[n]) && !n.toLowerCase().includes('stack') && !n.toLowerCase().includes('queue')) || '';
      const sortArr = sortArrayVar ? locals[sortArrayVar] : undefined;
      const iIdx = intVal(locals['i']);
      const jIdx = intVal(locals['j']);
      const pivotIdx = intVal(locals['pivot']);
      const minIdx = intVal(locals['min_idx'] || locals['min_index']);
      const highlight: number[] = [];
      if (iIdx !== undefined) highlight.push(iIdx);
      if (jIdx !== undefined) highlight.push(jIdx);
      if (pivotIdx !== undefined) highlight.push(pivotIdx);
      if (minIdx !== undefined) highlight.push(minIdx);
      return (
        <div className="dsa-viz">
          <div className="dsa-title">Sorting <small>{sortArrayVar}</small></div>
          {sortArr && <SortingArrayView v={sortArr} iIdx={iIdx} jIdx={jIdx} pivotIdx={pivotIdx} minIdx={minIdx} />}
          <div className="dsa-pointers">
            {iIdx !== undefined && <span className="ptr ptr-i">i={iIdx}</span>}
            {jIdx !== undefined && <span className="ptr ptr-j">j={jIdx}</span>}
            {pivotIdx !== undefined && <span className="ptr ptr-pivot">pivot={pivotIdx}</span>}
            {minIdx !== undefined && <span className="ptr ptr-min">min={minIdx}</span>}
          </div>
        </div>
      );
    } catch { return null; }
  }

  return null;
  } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* Graph Visualizer (SVG-based)                                        */
/* ------------------------------------------------------------------ */

function extractSet(v: VarValue): Set<string> {
  try {
    if (isList(v)) return new Set(v.value.map(x => String(scalarText(x))));
    if (isDict(v)) return new Set(v.value.map(e => String(scalarText(e.key))));
    return new Set();
  } catch { return new Set(); }
}

function extractListScalars(v: VarValue): (string | number)[] {
  try {
    if (!isList(v)) return [];
    return v.value.map(x => scalarText(x));
  } catch { return []; }
}

function extractGraphEdges(graph: VarValue): { nodes: string[]; edges: [string, string][] } {
  try {
    const nodes = new Set<string>();
    const edges: [string, string][] = [];

    if (isDict(graph)) {
      for (const entry of graph.value) {
        const src = String(scalarText(entry.key));
        nodes.add(src);
        if (isList(entry.val)) {
          for (const neighbor of entry.val.value) {
            const dst = String(scalarText(neighbor));
            nodes.add(dst);
            edges.push([src, dst]);
          }
        }
      }
    } else if (isList(graph)) {
      // adjacency list indexed by number
      for (let i = 0; i < graph.value.length; i++) {
        const row = graph.value[i];
        nodes.add(String(i));
        if (isList(row)) {
          for (const neighbor of row.value) {
            const dst = String(scalarText(neighbor));
            nodes.add(dst);
            edges.push([String(i), dst]);
          }
        }
      }
    }
    return { nodes: Array.from(nodes), edges };
  } catch { return { nodes: [], edges: [] }; }
}

function GraphView({ graph, visited, frontier, current }: {
  graph: VarValue;
  visited: Set<string>;
  frontier: Set<string>;
  current?: string;
}) {
  try {
    const { nodes, edges } = extractGraphEdges(graph);
    if (nodes.length === 0) return <span className="muted">empty graph</span>;

    const n = nodes.length;
    const W = Math.min(420, Math.max(220, n * 65));
    const H = W;
    const cx = W / 2;
    const cy = H / 2;
    const radius = Math.min(W, H) / 2 - 36;
    const nodeR = Math.max(16, 22 - n);

    // Position nodes in a circle
    const pos: Record<string, { x: number; y: number }> = {};
    nodes.forEach((nd, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      pos[nd] = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    });

    return (
      <svg className="graph-svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#6e7681" />
          </marker>
          <marker id="arrowhead-active" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#3fb950" />
          </marker>
        </defs>
        {/* Directed edges with arrowheads */}
        {edges.map(([a, b], i) => {
          const pa = pos[a];
          const pb = pos[b];
          if (!pa || !pb || a === b) return null;
          // Shorten line to stop at node edge
          const dx = pb.x - pa.x;
          const dy = pb.y - pa.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / dist;
          const uy = dy / dist;
          const x1 = pa.x + ux * nodeR;
          const y1 = pa.y + uy * nodeR;
          const x2 = pb.x - ux * (nodeR + 4);
          const y2 = pb.y - uy * (nodeR + 4);
          const isActive = visited.has(a) && visited.has(b);
          return (
            <line key={`e${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
              className={'graph-edge' + (isActive ? ' active' : '')}
              markerEnd={isActive ? 'url(#arrowhead-active)' : 'url(#arrowhead)'} />
          );
        })}
        {/* Nodes */}
        {nodes.map(nd => {
          const p = pos[nd];
          if (!p) return null;
          const isCur = nd === current;
          const isVisited = visited.has(nd);
          const isFrontier = frontier.has(nd);
          const cls = 'graph-node'
            + (isCur ? ' current' : '')
            + (isVisited && !isCur ? ' visited' : '')
            + (isFrontier && !isVisited && !isCur ? ' frontier' : '');
          return (
            <g key={nd}>
              <circle cx={p.x} cy={p.y} r={nodeR} className={cls} />
              <text x={p.x} y={p.y} className="graph-label" textAnchor="middle" dominantBaseline="central">
                {nd}
              </text>
            </g>
          );
        })}
      </svg>
    );
  } catch { return <span className="muted">Error rendering graph</span>; }
}

/* ------------------------------------------------------------------ */
/* Heap tree view (array → tree layout)                                */
/* ------------------------------------------------------------------ */

function renderHeapTree(items: VarValue[], index: number, depth: number): React.ReactNode {
  try {
    if (index >= items.length || depth > 6) return null;
    const val = scalarText(items[index]);
    const leftIdx = 2 * index + 1;
    const rightIdx = 2 * index + 2;
    const hasLeft = leftIdx < items.length;
    const hasRight = rightIdx < items.length;
    return (
      <div className="tree-node-wrap">
        <div className={'tree-node' + (index === 0 ? ' heap-root-node' : '')}>{val}</div>
        {(hasLeft || hasRight) && (
          <div className="tree-children">
            <div className="tree-child">
              {hasLeft ? renderHeapTree(items, leftIdx, depth + 1) : <div className="tree-null" />}
            </div>
            <div className="tree-child">
              {hasRight ? renderHeapTree(items, rightIdx, depth + 1) : <div className="tree-null" />}
            </div>
          </div>
        )}
      </div>
    );
  } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* Sorting array view (bar chart + pointer markers)                    */
/* ------------------------------------------------------------------ */

function SortingArrayView({ v, iIdx, jIdx, pivotIdx, minIdx }: {
  v: VarValue; iIdx?: number; jIdx?: number; pivotIdx?: number; minIdx?: number;
}) {
  try {
    const items: VarValue[] = isList(v) ? v.value : [];
    if (items.length === 0) return <span className="muted">empty</span>;

    // Extract numeric values for bar heights
    const nums = items.map(item => {
      if (isScalar(item) && (item.type === 'int' || item.type === 'float')) return item.value as number;
      return 0;
    });
    const maxVal = Math.max(...nums.map(Math.abs), 1);

    return (
      <div className="sorting-view">
        <div className="sorting-bars">
          {nums.map((num, i) => {
            const height = Math.max(4, (Math.abs(num) / maxVal) * 80);
            let cls = 'sort-bar';
            if (i === iIdx) cls += ' sort-i';
            if (i === jIdx) cls += ' sort-j';
            if (i === pivotIdx) cls += ' sort-pivot';
            if (i === minIdx) cls += ' sort-min';
            return (
              <div key={i} className="sort-bar-col">
                <div className={cls} style={{ height: `${height}px` }} />
                <span className="sort-val">{num}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  } catch { return null; }
}

/** Check if a VarValue represents None/null/missing. */
function isNoneValue(v: VarValue | undefined): boolean {
  try {
    if (!v) return true;
    if (isScalar(v) && v.type === 'NoneType') return true;
    if (isObject(v) && !v.value) return true;
    return false;
  } catch { return true; }
}

function linkedListNodes(head: VarValue | undefined, max = 50): (string | number)[] {
  try {
    const out: (string | number)[] = [];
    let cur = head;
    let guard = 0;
    // Use repr strings for cycle detection (JS object references are always unique)
    const seenReprs = new Set<string>();
    while (cur && !isNoneValue(cur) && guard++ < max) {
      if (!isObject(cur) || !cur.value) break;
      // Cycle detection via object repr (memory address)
      const repr = cur.repr || '';
      if (repr && seenReprs.has(repr)) {
        out.push('↻'); // cycle marker
        break;
      }
      if (repr) seenReprs.add(repr);
      const attrs = cur.value;
      const val = attrs['val'];
      out.push(val ? scalarText(val) : '?');
      cur = attrs['next'];
    }
    return out;
  } catch { return []; }
}

function scalarText(v: VarValue): string | number {
  if (isScalar(v)) {
    if (v.type === 'NoneType') return 'None';
    return String(v.value);
  }
  return (isObject(v) && v.repr) || '?';
}

function renderTree(node: VarValue | undefined, depth: number, currentRepr?: string): React.ReactNode {
  try {
    if (!node || isNoneValue(node) || depth > 8) return null;
    if (!isObject(node) || !node.value) return null;
    const attrs = node.value;
    const val = attrs['val'] ? scalarText(attrs['val']) : '?';
    const leftNone = isNoneValue(attrs['left']);
    const rightNone = isNoneValue(attrs['right']);
    const hasChildren = !leftNone || !rightNone;
    const isRoot = depth === 0;
    const isCurrent = currentRepr && node.repr === currentRepr;
    const nodeCls = 'tree-node'
      + (isRoot ? ' tree-root-node' : '')
      + (isCurrent ? ' tree-current-node' : '');
    return (
      <div className="tree-node-wrap">
        <div className={nodeCls}>{val}</div>
        {hasChildren && (
          <div className="tree-children">
            <div className="tree-child">
              {leftNone
                ? <div className="tree-null">null</div>
                : renderTree(attrs['left'], depth + 1, currentRepr)}
            </div>
            <div className="tree-child">
              {rightNone
                ? <div className="tree-null">null</div>
                : renderTree(attrs['right'], depth + 1, currentRepr)}
            </div>
          </div>
        )}
      </div>
    );
  } catch { return null; }
}

/* ================================================================== */
/* PERSISTENT DSA VISUALIZATION                                       */
/* Build complete structure once → animate algorithm state on top      */
/* ================================================================== */

/* --- Persistent tree data types --- */

type PTreeNode = {
  id: string;
  val: string | number;
  repr: string;
  depth: number;
  x: number;
  y: number;
  parentId: string | null;
  leftId: string | null;
  rightId: string | null;
};

type PTree = {
  name: string;
  nodes: Map<string, PTreeNode>;
  edges: { from: string; to: string }[];
  reprToId: Map<string, string>;
  rootId: string;
  width: number;
  height: number;
  maxDepth: number;
};

type NodeVisualState = 'unvisited' | 'current' | 'visited' | 'discovered' | 'exhausted';
type EnrichedFrame = { funcName: string; argVal?: string; isCurrent: boolean };

/* --- Count tree nodes (for finding largest tree) --- */

function countTreeSize(v: VarValue): number {
  try {
    if (!v || isNoneValue(v) || !isObject(v) || !v.value) return 0;
    if (!v.value['val']) return 0;
    return 1 + countTreeSize(v.value['left']) + countTreeSize(v.value['right']);
  } catch { return 0; }
}

/* --- Build a PTree from a VarValue tree node --- */

function buildPTreeFromVar(name: string, rootVar: VarValue): PTree | null {
  try {
    if (!rootVar || isNoneValue(rootVar) || !isObject(rootVar) || !rootVar.value) return null;
    if (!rootVar.value['val']) return null;

    const nodes = new Map<string, PTreeNode>();
    const edges: { from: string; to: string }[] = [];
    const reprToId = new Map<string, string>();

    let nodeCount = 0;
    let maxDepth = 0;

    type QItem = { v: VarValue; depth: number; parentId: string | null; side: 'left' | 'right' | null };
    const queue: QItem[] = [{ v: rootVar, depth: 0, parentId: null, side: null }];

    while (queue.length > 0) {
      const item = queue.shift()!;
      const { v, depth, parentId, side } = item;
      if (isNoneValue(v) || !isObject(v) || !v.value || !v.value['val']) continue;

      const id = String(nodeCount++);
      const val = scalarText(v.value['val']);
      const repr = (v as ObjectValue).repr || '';

      if (repr) reprToId.set(repr, id);
      maxDepth = Math.max(maxDepth, depth);

      const node: PTreeNode = {
        id, val, repr, depth, x: 0, y: 0,
        parentId, leftId: null, rightId: null,
      };
      nodes.set(id, node);

      if (parentId !== null && side) {
        const parent = nodes.get(parentId)!;
        if (side === 'left') parent.leftId = id;
        else parent.rightId = id;
        edges.push({ from: parentId, to: id });
      }

      const left = v.value['left'];
      const right = v.value['right'];
      if (left && !isNoneValue(left)) queue.push({ v: left, depth: depth + 1, parentId: id, side: 'left' });
      if (right && !isNoneValue(right)) queue.push({ v: right, depth: depth + 1, parentId: id, side: 'right' });
    }

    if (nodes.size === 0) return null;

    // Compute layout positions
    const vSpacing = 80;
    const baseUnit = Math.max(32, 56 - maxDepth * 6);

    function layoutNode(nodeId: string, depth: number, xCenter: number) {
      try {
        const nd = nodes.get(nodeId);
        if (!nd) return;
        nd.x = xCenter;
        nd.y = depth * vSpacing + 44;
        const spread = Math.pow(2, maxDepth - depth - 1) * baseUnit;
        if (nd.leftId) layoutNode(nd.leftId, depth + 1, xCenter - spread);
        if (nd.rightId) layoutNode(nd.rightId, depth + 1, xCenter + spread);
      } catch { /* skip */ }
    }

    const rootX = Math.pow(2, maxDepth) * baseUnit / 2;
    layoutNode('0', 0, rootX);

    let minX = Infinity, maxX = -Infinity;
    for (const nd of nodes.values()) {
      minX = Math.min(minX, nd.x);
      maxX = Math.max(maxX, nd.x);
    }
    const padding = 50;
    for (const nd of nodes.values()) {
      nd.x = nd.x - minX + padding;
    }
    const width = Math.max(220, maxX - minX + padding * 2);
    const height = (maxDepth + 1) * vSpacing + padding + 30;

    return { name, nodes, edges, reprToId, rootId: '0', width, height, maxDepth };
  } catch { return null; }
}

/* --- Find the best (largest) tree from all trace steps --- */

function buildPersistentTreesFromSteps(steps: Step[]): PTree[] {
  try {
    const bestTrees = new Map<string, { size: number; tree: PTree }>();
    const treeVarPriority = ['root', 'tree', 'head', 'node', 'cur', 'current', 'p', 'q', 'root1', 'root2'];

    for (const step of steps) {
      for (const [varName, val] of Object.entries(step.locals)) {
        if (!isTreeNode(val)) continue;
        const size = countTreeSize(val);
        if (size === 0) continue;
        const existing = bestTrees.get(varName);
        if (!existing || size > existing.size) {
          const tree = buildPTreeFromVar(varName, val);
          if (tree) bestTrees.set(varName, { size, tree });
        }
      }
    }

    // Deduplicate: if two variables point to the same root, keep higher-priority name
    const result: PTree[] = [];
    const usedRootReprs = new Set<string>();

    for (const name of treeVarPriority) {
      const entry = bestTrees.get(name);
      if (!entry) continue;
      const rootNode = entry.tree.nodes.get(entry.tree.rootId);
      if (!rootNode) continue;
      if (rootNode.repr && usedRootReprs.has(rootNode.repr)) continue;
      if (rootNode.repr) usedRootReprs.add(rootNode.repr);
      result.push(entry.tree);
    }

    // Check non-standard variable names
    for (const [name, entry] of bestTrees) {
      if (treeVarPriority.includes(name)) continue;
      const rootNode = entry.tree.nodes.get(entry.tree.rootId);
      if (!rootNode) continue;
      if (rootNode.repr && usedRootReprs.has(rootNode.repr)) continue;
      if (rootNode.repr) usedRootReprs.add(rootNode.repr);
      result.push(entry.tree);
    }

    return result;
  } catch { return []; }
}

/* --- Determine current node repr(s) from a step's locals --- */

function findCurrentTreeReprs(locals: Record<string, VarValue>): string[] {
  try {
    const reprs: string[] = [];
    const primaryVars = ['node', 'cur', 'current', 'root', 'p', 'q'];
    for (const name of primaryVars) {
      const val = locals[name];
      if (val && isTreeNode(val) && isObject(val) && (val as ObjectValue).repr) {
        reprs.push((val as ObjectValue).repr!);
      }
    }
    return reprs;
  } catch { return []; }
}

/* --- Compute node visual states for a given step --- */

function computePTreeNodeStates(
  trees: PTree[],
  steps: Step[],
  stepIdx: number,
): Map<string, NodeVisualState>[] {
  try {
    // Combined repr→location map across all trees
    const reprToLoc = new Map<string, { treeIdx: number; nodeId: string }>();
    for (let ti = 0; ti < trees.length; ti++) {
      for (const [repr, nodeId] of trees[ti].reprToId) {
        reprToLoc.set(repr, { treeIdx: ti, nodeId });
      }
    }

    // Initialize all nodes as unvisited
    const stateMaps: Map<string, NodeVisualState>[] = trees.map(tree => {
      const m = new Map<string, NodeVisualState>();
      for (const id of tree.nodes.keys()) m.set(id, 'unvisited');
      return m;
    });

    // Track active path + exhausted (backtracked) nodes.
    // Active path = nodes on the current call stack → green.
    // Exhausted   = was on the stack but got popped (backtracked) → red.
    const everOnStack = new Set<string>();      // all reprs ever pushed
    const stackFrameReprs: string[][] = [];     // current live stack frames
    for (let i = 0; i <= stepIdx; i++) {
      const step = steps[i];
      if (!step) continue;
      const prevLen = i > 0 ? (steps[i - 1]?.callStack.length || 0) : 0;
      const curLen = step.callStack.length;
      // Stack grew → new frame entered
      if (curLen > prevLen) {
        while (stackFrameReprs.length < curLen) stackFrameReprs.push([]);
        const reprs = findCurrentTreeReprs(step.locals);
        stackFrameReprs[curLen - 1] = reprs;
        for (const r of reprs) everOnStack.add(r);
      }
      // Stack shrunk → frames popped (backtrack)
      if (curLen < prevLen) {
        for (let d = curLen; d < prevLen; d++) {
          for (const r of (stackFrameReprs[d] || [])) everOnStack.add(r);
        }
        stackFrameReprs.length = curLen;
      }
      // Stack depth unchanged but the tree variable changed → frame swapped
      // (e.g. hasPathSum(7) returned, then hasPathSum(2) called at same depth)
      if (curLen === prevLen && curLen > 0) {
        const reprs = findCurrentTreeReprs(step.locals);
        const oldReprs = stackFrameReprs[curLen - 1] || [];
        if (reprs.length > 0 && oldReprs.length > 0 && reprs[0] !== oldReprs[0]) {
          for (const r of oldReprs) everOnStack.add(r);
          stackFrameReprs[curLen - 1] = reprs;
          for (const r of reprs) everOnStack.add(r);
        }
      }
    }
    // Collect reprs still on the active stack
    const activeReprs = new Set<string>();
    for (const reprs of stackFrameReprs) {
      for (const r of reprs) activeReprs.add(r);
    }
    // Mark exhausted first (was visited, then backtracked → red)
    for (const repr of everOnStack) {
      if (!activeReprs.has(repr)) {
        const loc = reprToLoc.get(repr);
        if (loc) stateMaps[loc.treeIdx].set(loc.nodeId, 'exhausted');
      }
    }
    // Mark active-path nodes as visited (green) — overwrites exhausted if re-visited
    for (const repr of activeReprs) {
      const loc = reprToLoc.get(repr);
      if (loc) stateMaps[loc.treeIdx].set(loc.nodeId, 'visited');
    }

    // Mark current node(s) at the current step
    if (stepIdx < steps.length && steps[stepIdx]) {
      const current = steps[stepIdx];
      const reprs = findCurrentTreeReprs(current.locals);
      for (const repr of reprs) {
        const loc = reprToLoc.get(repr);
        if (loc) stateMaps[loc.treeIdx].set(loc.nodeId, 'current');
      }

      // Mark frontier nodes from queue/stack variables
      for (const [name, val] of Object.entries(current.locals)) {
        const lower = name.toLowerCase();
        if (!isList(val)) continue;
        if (!['queue', 'stack', 'q', 's', 'deque'].some(n => lower === n || lower.includes(n))) continue;

        const scanItem = (item: VarValue) => {
          try {
            if (isObject(item) && (item as ObjectValue).repr) {
              const loc = reprToLoc.get((item as ObjectValue).repr!);
              if (loc) {
                const cur = stateMaps[loc.treeIdx].get(loc.nodeId);
                if (cur !== 'current' && cur !== 'visited') {
                  stateMaps[loc.treeIdx].set(loc.nodeId, 'discovered');
                }
              }
            }
            if (isList(item)) { for (const sub of item.value) scanItem(sub); }
          } catch { /* skip */ }
        };
        for (const item of val.value) scanItem(item);
      }
    }

    return stateMaps;
  } catch { return trees.map(() => new Map()); }
}

/* --- Build enriched call stack with argument values --- */

function buildEnrichedStack(
  trees: PTree[],
  steps: Step[],
  stepIdx: number,
): EnrichedFrame[] {
  try {
    const current = steps[stepIdx];
    if (!current || !current.callStack.length) return [];

    // Build repr→nodeVal map from all trees
    const reprToVal = new Map<string, string | number>();
    for (const tree of trees) {
      for (const [repr, nodeId] of tree.reprToId) {
        const node = tree.nodes.get(nodeId);
        if (node) reprToVal.set(repr, node.val);
      }
    }

    // Scan steps to find argument for each stack depth
    const frameArgs = new Map<number, string>();

    for (let i = 0; i <= stepIdx; i++) {
      const step = steps[i];
      if (!step) continue;
      const prevLen = i > 0 ? (steps[i - 1]?.callStack.length || 0) : 0;

      // Stack grew → new frame entered
      if (step.callStack.length > prevLen) {
        const depth = step.callStack.length - 1;
        let found = false;
        for (const [, val] of Object.entries(step.locals)) {
          if (isTreeNode(val) && isObject(val) && (val as ObjectValue).repr) {
            const nodeVal = reprToVal.get((val as ObjectValue).repr!);
            if (nodeVal !== undefined) {
              frameArgs.set(depth, String(nodeVal));
              found = true;
              break;
            }
          }
        }
        if (!found) {
          for (const [, val] of Object.entries(step.locals)) {
            if (isScalar(val) && val.type === 'NoneType') {
              frameArgs.set(depth, 'null');
              break;
            }
          }
        }
      }
      // Stack depth unchanged — detect frame swap (return + re-call at same depth)
      if (step.callStack.length === prevLen && prevLen > 0) {
        const depth = prevLen - 1;
        for (const [, val] of Object.entries(step.locals)) {
          if (isTreeNode(val) && isObject(val) && (val as ObjectValue).repr) {
            const nodeVal = reprToVal.get((val as ObjectValue).repr!);
            if (nodeVal !== undefined && frameArgs.get(depth) !== String(nodeVal)) {
              frameArgs.set(depth, String(nodeVal));
            }
            break;
          }
        }
      }
    }

    return current.callStack.map((funcName, depth) => ({
      funcName,
      argVal: frameArgs.get(depth),
      isCurrent: depth === current.callStack.length - 1,
    }));
  } catch { return []; }
}

/* --- SVG Persistent Tree Renderer --- */

function PersistentTreeSVG({ tree, nodeStates }: {
  tree: PTree;
  nodeStates: Map<string, NodeVisualState>;
}) {
  try {
    const nodeR = 24;
    const W = tree.width;
    const H = tree.height;

    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="ptree-svg" preserveAspectRatio="xMidYMid meet">
        {/* Edges */}
        {tree.edges.map((e, i) => {
          const from = tree.nodes.get(e.from);
          const to = tree.nodes.get(e.to);
          if (!from || !to) return null;
          const toState = nodeStates.get(e.to) || 'unvisited';
          const isTraversed = toState === 'visited' || toState === 'current';
          const isExhausted = toState === 'exhausted';
          const edgeCls = `ptree-edge${isTraversed ? ' traversed' : isExhausted ? ' exhausted' : ''}`;
          return (
            <line key={`e${i}`}
              x1={from.x} y1={from.y + nodeR}
              x2={to.x} y2={to.y - nodeR}
              className={edgeCls}
            />
          );
        })}
        {/* Nodes */}
        {Array.from(tree.nodes.values()).map(nd => {
          const state = nodeStates.get(nd.id) || 'unvisited';
          return (
            <g key={nd.id} className={`ptree-node-g ptree-${state}`}>
              <circle cx={nd.x} cy={nd.y} r={nodeR} className="ptree-circle" />
              <text x={nd.x} y={nd.y} textAnchor="middle" dominantBaseline="central" className="ptree-text">
                {nd.val}
              </text>
            </g>
          );
        })}
      </svg>
    );
  } catch { return <span className="muted">Error rendering tree</span>; }
}

/* --- Persistent Call Stack View --- */

function PersistentCallStackView({ stack }: { stack: EnrichedFrame[] }) {
  try {
    if (stack.length === 0) return null;
    const reversed = [...stack].reverse();
    return (
      <div className="pcallstack">
        {reversed.map((frame, i) => (
          <div key={i} className={`pcallstack-frame${frame.isCurrent ? ' active' : ''}`}>
            {frame.funcName}({frame.argVal ?? '…'})
          </div>
        ))}
        <div className="pcallstack-label">call stack</div>
      </div>
    );
  } catch { return null; }
}

/* --- Main Persistent DSA Visualizer --- */

export function PersistentDSAVisualizer({ steps, stepIdx, testInput }: {
  steps: Step[];
  stepIdx: number;
  testInput: string;
}) {
  try {
    // Build persistent trees once from all steps
    const trees = useMemo(() => buildPersistentTreesFromSteps(steps), [steps]);

    // Compute node states for the current step
    const stateMaps = useMemo(
      () => computePTreeNodeStates(trees, steps, stepIdx),
      [trees, steps, stepIdx],
    );

    // Build enriched call stack with argument values
    const enrichedStack = useMemo(
      () => buildEnrichedStack(trees, steps, stepIdx),
      [trees, steps, stepIdx],
    );

    // Render persistent tree(s) if found
    if (trees.length > 0) {
      return (
        <div className="persistent-viz">
          <div className="ptree-container" style={trees.length > 1 ? { display: 'flex', gap: '24px', justifyContent: 'center', flexWrap: 'wrap' as const } : undefined}>
            {trees.map((tree, i) => (
              <div key={i} className="ptree-single">
                {trees.length > 1 && <div className="ptree-name">{tree.name}</div>}
                <PersistentTreeSVG tree={tree} nodeStates={stateMaps[i] || new Map()} />
              </div>
            ))}
          </div>
          {enrichedStack.length > 0 && <PersistentCallStackView stack={enrichedStack} />}
        </div>
      );
    }

    // Fallback: use old DSAVisualizer for non-tree structures
    const current = steps[stepIdx];
    if (!current) return null;
    const detection = detectDSA(current.locals);
    if (detection.kind === 'none') return null;
    return (
      <div className="persistent-viz">
        <DSAVisualizer locals={current.locals} detection={detection} />
      </div>
    );
  } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* Variable panel: pick the right visualizer per variable              */
/* ------------------------------------------------------------------ */

export function VariableRow({ name, v }: { name: string; v: VarValue }) {
  try {
    const lower = name.toLowerCase();
    let body: React.ReactNode;
    if (isList(v)) {
      if (lower.includes('stack')) body = <StackView v={v} />;
      else if (lower.includes('queue') || lower === 'q' || lower === 'deque') body = <QueueView v={v} />;
      else body = <ArrayView v={v} />;
    } else if (isDict(v)) {
      body = <DictView v={v} />;
    } else if (isScalar(v)) {
      body = <ScalarView v={v} />;
    } else {
      body = <ObjectView v={v} />;
    }
    return (
      <div className="var-row">
        <div className="var-name">{name} <span className="var-type">{v.type}</span></div>
        <div className="var-val">{body}</div>
      </div>
    );
  } catch { return <div className="var-row muted">Error rendering {name}</div>; }
}

export function VariablesPanel({ step }: { step: Step | undefined }) {
  try {
    if (!step) return <div className="muted">No step selected</div>;
    const entries = Object.entries(step.locals);
    if (!entries.length) return <div className="muted">No local variables</div>;
    return <div className="vars-panel">{entries.map(([k, v]) => <VariableRow key={k} name={k} v={v} />)}</div>;
  } catch { return <div className="muted">Error rendering variables</div>; }
}
