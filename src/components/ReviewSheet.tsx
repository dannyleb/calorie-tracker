import { useLayoutEffect, useState } from 'preact/hooks';
import type { FoodItem } from '../../shared/types';
import { ItemEditor } from './ItemEditor';
import { Sheet } from './Sheet';

export type ReviewState =
  | { status: 'working'; thumb?: string; message: string }
  | { status: 'error'; thumb?: string; message: string }
  | { status: 'ready'; thumb?: string; note: string; items: FoodItem[] };

export function ReviewSheet({
  review,
  dayLabel,
  onAdd,
  onClose,
  onTypeInstead,
}: {
  review: ReviewState;
  dayLabel: string;
  onAdd: (items: { food: FoodItem; qty: number }[]) => void;
  onClose: () => void;
  onTypeInstead: () => void;
}) {
  const [rows, setRows] = useState<{ food: FoodItem; qty: number; include: boolean }[]>([]);
  const items = review.status === 'ready' ? review.items : null;
  // Layout effect so the rows exist before the first paint of the results.
  useLayoutEffect(() => {
    if (items) setRows(items.map((food) => ({ food, qty: 1, include: true })));
  }, [items]);
  const chosen = rows.filter((r) => r.include);

  const footer =
    review.status === 'ready' && rows.length > 0 ? (
      <button class="primary-btn" disabled={!chosen.length} onClick={() => onAdd(chosen)}>
        Add {chosen.length === 1 ? '1 item' : `${chosen.length} items`} to {dayLabel.toLowerCase() === 'today' ? 'today' : dayLabel}
      </button>
    ) : review.status === 'error' || (review.status === 'ready' && rows.length === 0) ? (
      <button class="secondary-btn" onClick={onTypeInstead}>
        Type or say it instead
      </button>
    ) : undefined;

  return (
    <Sheet title={review.status === 'ready' ? 'Review' : review.status === 'error' ? "Couldn't analyze" : 'Analyzing'} onClose={onClose} footer={footer}>
      {review.thumb && (
        <div class="thumb-wrap">
          <img class="thumb" src={review.thumb} alt="Your photo" />
          {review.status === 'working' && <div class="scan-line" />}
        </div>
      )}
      {review.status === 'working' && (
        <div class="working">
          <span class="spinner" aria-hidden="true" /> {review.message}
        </div>
      )}
      {review.status === 'error' && <div class="error-box">{review.message}</div>}
      {review.status === 'ready' && (
        <>
          {review.note && <div class="hint">{review.note}</div>}
          {rows.length === 0 && <div class="empty">No food found in that photo.</div>}
          {rows.map((r, i) => (
            <ItemEditor
              key={i}
              food={r.food}
              qty={r.qty}
              include={r.include}
              onToggle={rows.length > 1 ? () => setRows(rows.map((x, j) => (j === i ? { ...x, include: !x.include } : x))) : undefined}
              onQty={(q) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: q } : x)))}
            />
          ))}
        </>
      )}
    </Sheet>
  );
}
