import { useEffect, useMemo, useRef, useState } from 'react';
import GridLayout, { WidthProvider } from 'react-grid-layout';
import { getWidget } from '@/registry';
import { colsForWidth, isPhoneWidth, toGridLayout, type GridItem } from '@/lib/grid';
import { getOwnerBoard } from '@/profiles/ownerBoard';
import { useProfileStore } from '@/store/profileStore';
import { useSessionStore } from '@/store/sessionStore';
import type { WidgetAnchor } from '@/types/layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const RGL = WidthProvider(GridLayout);

export function GridBoard() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 390));
  const board = useSessionStore((s) => s.board);
  const mode = useSessionStore((s) => s.mode);
  const search = useSessionStore((s) => s.search);
  const setAnchors = useSessionStore((s) => s.setAnchors);
  const activeId = useProfileStore((s) => s.activeId);
  const activeName = useProfileStore((s) => s.activeName);
  const userLayout = useProfileStore((s) => s.layout);
  const moveWidgets = useProfileStore((s) => s.moveWidgets);
  const saveError = useProfileStore((s) => s.saveError);
  const signedIn = Boolean(activeId && userLayout);
  const widgets = activeId && userLayout ? userLayout.widgets : getOwnerBoard().widgets;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || window.innerWidth));
    ro.observe(el);
    setWidth(el.clientWidth || window.innerWidth);
    return () => ro.disconnect();
  }, []);

  const cols = colsForWidth(width);
  const phone = isPhoneWidth(width);

  const pageWidgets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return widgets.filter((w) => {
      if (w.page !== board) return false;
      if (!q) return true;
      const def = getWidget(w.type);
      return (
        w.type.toLowerCase().includes(q) ||
        (def?.title.toLowerCase().includes(q) ?? false)
      );
    });
  }, [widgets, board, search]);

  const layout = useMemo(() => toGridLayout(pageWidgets, cols), [pageWidgets, cols]);

  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return;
    const measure = () => {
      const nodes = root.querySelectorAll<HTMLElement>('[data-widget-id]');
      const anchors: WidgetAnchor[] = [];
      nodes.forEach((node) => {
        const r = node.getBoundingClientRect();
        anchors.push({
          id: node.dataset.widgetId ?? '',
          type: node.dataset.widgetType ?? '',
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
        });
      });
      setAnchors(anchors.filter((a) => a.id));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    measure();
    window.addEventListener('scroll', measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', measure, true);
    };
  }, [pageWidgets, setAnchors, mode]);

  function onLayoutChange(next: GridItem[]) {
    if (!signedIn || mode !== 'edit' || search.trim()) return;
    moveWidgets(board, next, cols);
  }

  return (
    <div
      ref={wrapRef}
      data-board-mode={signedIn ? 'profile' : 'owner'}
      className="mx-auto w-full max-w-6xl px-2 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-2"
    >
      <p className="px-2 pb-2 text-center text-[11px] uppercase tracking-[0.18em] text-white/40">
        {signedIn ? `Saved to ${activeName}` : "Casey's board · view only"}
      </p>
      {saveError ? <p className="px-2 pb-2 text-center text-xs text-rose-200">{saveError}</p> : null}
      {pageWidgets.length === 0 ? (
        <p className="px-4 py-16 text-center text-white/45">
          {signedIn
            ? 'Your board is empty. Use + to add a widget. The arrangement is saved to your profile.'
            : "Casey's board is view only. Sign in to build your own."}
        </p>
      ) : (
        <RGL
          className="cc-grid"
          layout={layout}
          cols={cols}
          rowHeight={phone ? 56 : 42}
          margin={[10, 10]}
          containerPadding={[2, 2]}
          isDraggable={signedIn && mode === 'edit'}
          isResizable={signedIn && mode === 'edit'}
          draggableHandle=".widget-drag-handle"
          draggableCancel=".widget-no-drag"
          compactType="vertical"
          onLayoutChange={onLayoutChange}
          useCSSTransforms
        >
          {pageWidgets.map((widget) => {
            const def = getWidget(widget.type);
            const Body = def?.component;
            return (
              <div key={widget.id} className="h-full">
                {Body ? (
                  <Body widget={widget} />
                ) : (
                  <div className="widget-card flex h-full items-center justify-center text-sm text-white/50">
                    Unknown widget type: {widget.type}
                  </div>
                )}
              </div>
            );
          })}
        </RGL>
      )}
    </div>
  );
}
