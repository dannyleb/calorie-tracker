import { useEffect, useState } from 'preact/hooks';
import type { Entry } from '../lib/db';
import { isFavorite, setFavorite } from '../lib/db';
import { Icon } from './Icon';
import { ItemEditor } from './ItemEditor';
import { Sheet } from './Sheet';

export function EditSheet({
  entry,
  onSave,
  onDelete,
  onClose,
}: {
  entry: Entry;
  onSave: (e: Entry) => void;
  onDelete: (e: Entry) => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState(entry.qty);
  const [fav, setFav] = useState(false);
  useEffect(() => {
    isFavorite(entry.food).then(setFav);
  }, [entry.id]);

  return (
    <Sheet
      title="Edit entry"
      onClose={onClose}
      footer={
        <div class="foot-row">
          <button class="danger-btn" onClick={() => onDelete(entry)} aria-label="Delete entry">
            <Icon name="trash" size={20} /> Delete
          </button>
          <button class="primary-btn" onClick={() => onSave({ ...entry, qty })}>
            Save
          </button>
        </div>
      }
    >
      <ItemEditor food={entry.food} qty={qty} onQty={setQty} />
      <button
        class={`fav-toggle ${fav ? 'on' : ''}`}
        aria-pressed={fav}
        onClick={async () => {
          await setFavorite(entry.food, !fav);
          setFav(!fav);
        }}
      >
        <Icon name="star" filled={fav} size={20} /> {fav ? 'In favorites' : 'Add to favorites'}
      </button>
      {entry.food.sourceDetail && <p class="hint">Source: {entry.food.sourceDetail}</p>}
    </Sheet>
  );
}
