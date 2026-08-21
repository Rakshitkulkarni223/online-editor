import React, { useCallback, useEffect, useRef } from 'react';

type Props = {
  /** Direction of the split */
  direction: 'horizontal' | 'vertical';
  /** Callback with delta in pixels (positive = dragging right/down) */
  onDrag: (delta: number) => void;
};

/**
 * A draggable splitter bar between two panels.
 * Calls onDrag with the pixel delta as the user drags.
 */
export function Splitter({ direction, onDrag }: Props) {
  const startRef = useRef(0);
  const draggingRef = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    try {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = true;
      startRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    } catch { /* ignore */ }
  }, [direction]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      try {
        const current = direction === 'horizontal' ? e.clientX : e.clientY;
        const delta = current - startRef.current;
        startRef.current = current;
        onDrag(delta);
      } catch { /* ignore */ }
    };
    const onMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [direction, onDrag]);

  return (
    <div
      className={`splitter splitter-${direction}`}
      onMouseDown={onMouseDown}
    />
  );
}
