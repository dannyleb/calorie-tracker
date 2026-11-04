import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { FoodItem } from '../shared/types';
import { EditSheet } from './components/EditSheet';
import { Icon } from './components/Icon';
import { RecentSheet } from './components/RecentSheet';
import { ReviewSheet, type ReviewState } from './components/ReviewSheet';
import { Settings } from './components/Settings';
import { TextSheet } from './components/TextSheet';
import { Toast, type ToastState } from './components/Toast';
import { Today } from './components/Today';
import { Trends } from './components/Trends';
import { analyzePhoto, analyzeText, lookupBarcode } from './lib/api';
import { detectBarcode } from './lib/barcode';
import { dayLabel, todayKey } from './lib/dates';
import { deleteEntries, entriesForDate, logFoods, requestPersistence, updateEntry, type Entry, type SavedFood } from './lib/db';
import { blobToBase64, canvasToBlob, drawScaled, loadImage } from './lib/image';
import { loadSettings, saveSettings, type Settings as SettingsT } from './lib/settings';

type Tab = 'today' | 'trends' | 'settings';
type SheetState =
  | null
  | { type: 'review'; id: number; review: ReviewState }
  | { type: 'text' }
  | { type: 'recent' }
  | { type: 'edit'; entry: Entry };

export function App() {
  const [tab, setTab] = useState<Tab>('today');
  const [date, setDate] = useState(todayKey());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [settings, setSettingsState] = useState<SettingsT>(loadSettings);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [version, setVersion] = useState(0);
  const job = useRef(0);
  const lastToday = useRef(todayKey());

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    entriesForDate(date).then(setEntries);
  }, [date, version]);

  useEffect(() => {
    requestPersistence();
    // Roll over to the new day if the app stays open past midnight.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setDate((d) => (d < todayKey() && d === lastToday.current ? todayKey() : d));
        lastToday.current = todayKey();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const setSettings = (s: SettingsT) => {
    saveSettings(s);
    setSettingsState(s);
  };

  const notify = (message: string, error = false) => setToast({ id: Date.now(), message, error });

  const closeSheet = () => {
    job.current++; // ignore results from any request still in flight
    setSheet(null);
  };

  // ---- Logging flows ----

  async function addItems(items: { food: FoodItem; qty: number }[]) {
    const ids = await logFoods(items, date);
    setSheet(null);
    refresh();
    setToast({
      id: Date.now(),
      message: items.length === 1 ? `Added ${items[0].food.name}` : `Added ${items.length} items`,
      actionLabel: 'Undo',
      onAction: async () => {
        await deleteEntries(ids);
        refresh();
      },
    });
  }

  async function onPhoto(file: File) {
    const id = ++job.current;
    const show = (review: ReviewState) => job.current === id && setSheet({ type: 'review', id, review });
    show({ status: 'working', message: 'Reading photo…' });
    try {
      const img = await loadImage(file);
      const forAi = drawScaled(img, 1280);
      const blob = await canvasToBlob(forAi);
      const thumb = URL.createObjectURL(blob);
      show({ status: 'working', thumb, message: 'Checking for a barcode…' });

      let note = '';
      const code = await detectBarcode(drawScaled(img, 2000)).catch(() => null);
      if (code) {
        show({ status: 'working', thumb, message: `Looking up barcode ${code}…` });
        const r = await lookupBarcode(code);
        if (r.found && r.food) {
          show({ status: 'ready', thumb, note: `Barcode ${code}`, items: [r.food] });
          return;
        }
        note = `Barcode ${code} isn't in the food databases, so this is an AI read of the photo. A photo of the Nutrition Facts label is more accurate.`;
      }

      show({ status: 'working', thumb, message: 'Identifying food…' });
      const res = await analyzePhoto(await blobToBase64(blob));
      show({
        status: 'ready',
        thumb,
        note: [note, res.note].filter(Boolean).join(' '),
        items: res.items,
      });
    } catch (err) {
      show({ status: 'error', message: (err as Error).message || 'Something went wrong.' });
    }
  }

  async function onText(text: string) {
    const id = ++job.current;
    const show = (review: ReviewState) => job.current === id && setSheet({ type: 'review', id, review });
    show({ status: 'working', message: 'Working it out…' });
    try {
      const res = await analyzeText(text);
      show({ status: 'ready', note: res.note, items: res.items });
    } catch (err) {
      show({ status: 'error', message: (err as Error).message });
    }
  }

  async function onPickRecent(f: SavedFood) {
    const ids = await logFoods([{ food: f.food, qty: f.lastQty }], date);
    refresh();
    setToast({
      id: Date.now(),
      message: `Added ${f.food.name}`,
      actionLabel: 'Undo',
      onAction: async () => {
        await deleteEntries(ids);
        refresh();
      },
    });
  }

  const fileInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) onPhoto(file);
  };

  const label = dayLabel(date);

  return (
    <div class="app">
      <main class={`content ${tab === 'today' ? 'with-addbar' : ''}`}>
        {tab === 'today' && (
          <Today
            date={date}
            setDate={setDate}
            entries={entries}
            targets={settings.targets}
            onEdit={(entry) => setSheet({ type: 'edit', entry })}
          />
        )}
        {tab === 'trends' && <Trends targets={settings.targets} version={version} />}
        {tab === 'settings' && (
          <Settings settings={settings} onChange={setSettings} onDataChanged={refresh} notify={notify} />
        )}
      </main>

      {tab === 'today' && (
        <div class="addbar">
          <label class="add-camera" aria-label="Take a photo">
            <Icon name="camera" size={26} />
            <span>Snap food</span>
            <input type="file" accept="image/*" capture="environment" onChange={fileInput} />
          </label>
          <label class="add-btn" aria-label="Choose a photo">
            <Icon name="image" />
            <span>Photo</span>
            <input type="file" accept="image/*" onChange={fileInput} />
          </label>
          <button class="add-btn" onClick={() => setSheet({ type: 'text' })}>
            <Icon name="mic" />
            <span>Say it</span>
          </button>
          <button class="add-btn" onClick={() => setSheet({ type: 'recent' })}>
            <Icon name="clock" />
            <span>Recent</span>
          </button>
        </div>
      )}

      <nav class="tabbar">
        {(
          [
            ['today', 'today', 'Today'],
            ['trends', 'trends', 'Trends'],
            ['settings', 'settings', 'Settings'],
          ] as [Tab, string, string][]
        ).map(([id, icon, text]) => (
          <button key={id} class={tab === id ? 'on' : ''} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
            <Icon name={icon} />
            <span>{text}</span>
          </button>
        ))}
      </nav>

      {sheet?.type === 'review' && (
        <ReviewSheet
          key={sheet.id}
          review={sheet.review}
          dayLabel={label}
          onAdd={addItems}
          onClose={closeSheet}
          onTypeInstead={() => setSheet({ type: 'text' })}
        />
      )}
      {sheet?.type === 'text' && <TextSheet onSubmit={onText} onClose={closeSheet} />}
      {sheet?.type === 'recent' && <RecentSheet onPick={onPickRecent} onClose={closeSheet} />}
      {sheet?.type === 'edit' && (
        <EditSheet
          entry={sheet.entry}
          onClose={closeSheet}
          onSave={async (e) => {
            await updateEntry(e);
            setSheet(null);
            refresh();
          }}
          onDelete={async (e) => {
            await deleteEntries([e.id]);
            setSheet(null);
            refresh();
            setToast({
              id: Date.now(),
              message: `Deleted ${e.food.name}`,
              actionLabel: 'Undo',
              onAction: async () => {
                await updateEntry(e);
                refresh();
              },
            });
          }}
        />
      )}

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
