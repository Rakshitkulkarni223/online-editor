import React from 'react';
import type { Step, VarValue } from './types';
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

export function ArrayView({ v, highlight }: { v: VarValue; highlight?: number[] }) {
  const items: VarValue[] = isList(v) ? v.value : [];
  const hi = new Set(highlight || []);
  return (
    <div className="array-view">
      <div className="array-cells">
        {items.length === 0 && <span className="muted">empty</span>}
        {items.map((item, i) => (
          <div key={i} className={'array-cell' + (hi.has(i) ? ' active' : '')}>
            <span className="idx">{i}</span>
            <span className="val">{renderValue(item)}</span>
          </div>
        ))}
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
  kind: 'two_pointers' | 'sliding_window' | 'binary_search' | 'dp_table' | 'linked_list' | 'tree' | 'none';
  title: string;
};

/** Inspect locals and decide which specialized visualizer (if any) applies. */
export function detectDSA(locals: Locals): DSADetection {
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
  if (names.some(n => is2DList(locals[n]))) {
    return { kind: 'dp_table', title: 'DP Table' };
  }
  // Linked list / tree: an object with .next or .left/.right
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
}

export function DSAVisualizer({ locals, detection }: { locals: Locals; detection: DSADetection }) {
  const names = Object.keys(locals);
  const arrayVar = names.find(n => isList(locals[n])) || '';
  const arr = arrayVar ? locals[arrayVar] : undefined;

  if (detection.kind === 'binary_search' || detection.kind === 'two_pointers' || detection.kind === 'sliding_window') {
    const l = names.includes('left') ? intVal(locals['left']) : undefined;
    const r = names.includes('right') ? intVal(locals['right']) : undefined;
    const m = names.includes('mid') ? intVal(locals['mid']) : undefined;
    const highlight = [l, r, m].filter((x): x is number => x !== undefined);
    return (
      <div className="dsa-viz">
        <div className="dsa-title">{detection.title} <small>on {arrayVar}</small></div>
        {arr && <ArrayView v={arr} highlight={highlight} />}
        <div className="dsa-pointers">
          {l !== undefined && <span className="ptr ptr-left">← left={l}</span>}
          {m !== undefined && <span className="ptr ptr-mid">mid={m}</span>}
          {r !== undefined && <span className="ptr ptr-right">right={r} →</span>}
        </div>
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
    const headVar = names.find(n => {
      const v = locals[n];
      if (!v || !isObject(v) || !v.value) return false;
      return Object.keys(v.value).includes('next');
    }) || '';
    const head = locals[headVar];
    const nodes = linkedListNodes(head);
    return (
      <div className="dsa-viz">
        <div className="dsa-title">Linked List <small>{headVar}</small></div>
        <div className="ll-view">
          {nodes.length === 0 && <span className="muted">null</span>}
          {nodes.map((n, i) => (
            <React.Fragment key={i}>
              <div className="ll-node">{n}</div>
              {i < nodes.length - 1 && <span className="ll-arrow">→</span>}
            </React.Fragment>
          ))}
          {nodes.length > 0 && <span className="ll-arrow">→ null</span>}
        </div>
      </div>
    );
  }

  if (detection.kind === 'tree') {
    const rootVar = names.find(n => {
      const v = locals[n];
      if (!v || !isObject(v) || !v.value) return false;
      const a = Object.keys(v.value);
      return a.includes('left') || a.includes('right');
    }) || '';
    const root = locals[rootVar];
    return (
      <div className="dsa-viz">
        <div className="dsa-title">Binary Tree <small>{rootVar}</small></div>
        <div className="tree-view">{renderTree(root, 0)}</div>
      </div>
    );
  }

  return null;
}

function linkedListNodes(head: VarValue | undefined, max = 50): (string | number)[] {
  const out: (string | number)[] = [];
  let cur = head;
  let guard = 0;
  const seen = new Set<VarValue>();
  while (cur && !(isScalar(cur) && cur.type === 'NoneType') && guard++ < max) {
    if (seen.has(cur)) break; // cycle guard
    seen.add(cur);
    if (!isObject(cur) || !cur.value) break;
    const attrs = cur.value;
    const val = attrs['val'];
    out.push(val ? scalarText(val) : '?');
    cur = attrs['next'];
  }
  return out;
}

function scalarText(v: VarValue): string | number {
  if (isScalar(v)) {
    if (v.type === 'NoneType') return 'None';
    return String(v.value);
  }
  return (isObject(v) && v.repr) || '?';
}

function renderTree(node: VarValue | undefined, depth: number): React.ReactNode {
  if (!node || (isScalar(node) && node.type === 'NoneType') || depth > 6) return null;
  if (!isObject(node) || !node.value) return null;
  const attrs = node.value;
  const val = attrs['val'] ? scalarText(attrs['val']) : '?';
  return (
    <div className="tree-node-wrap">
      <div className="tree-node">{val}</div>
      {(attrs['left'] || attrs['right']) && (
        <div className="tree-children">
          <div className="tree-child">{renderTree(attrs['left'], depth + 1)}</div>
          <div className="tree-child">{renderTree(attrs['right'], depth + 1)}</div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Variable panel: pick the right visualizer per variable              */
/* ------------------------------------------------------------------ */

export function VariableRow({ name, v }: { name: string; v: VarValue }) {
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
}

export function VariablesPanel({ step }: { step: Step | undefined }) {
  if (!step) return <div className="muted">No step selected</div>;
  const entries = Object.entries(step.locals);
  if (!entries.length) return <div className="muted">No local variables</div>;
  return <div className="vars-panel">{entries.map(([k, v]) => <VariableRow key={k} name={k} v={v} />)}</div>;
}
