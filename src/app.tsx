import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { FoodItem } from '../shared/types';
import { EditSheet } from './components/EditSheet';
import { Icon } from './components/Icon';
import { RecentSheet } from './components/RecentSheet';
import { Recipes } from './components/Recipes';
import { ReviewSheet, type ReviewState } from './components/ReviewSheet';
import { Settings } from './components/Settings';
import { TextSheet } from './components/TextSheet';
import { Toast, type ToastState } from './components/Toast';
import { Today } from './components/Today';
import { Trends } from './components/Trends';
import { analyzeText } from './lib/api';
import { identifyPhoto } from './lib/capture';
import { dayLabel, todayKey } from './lib/dates';
import {
  allRecipes,
  deleteEntries,
  entriesForDate,
  logFoods,
  requestPersistence,
  updateEntry,
  type Entry,
  type SavedFood,
} from './lib/db';
import { fmtQty } from './lib/format';
import { recipeName, recipeServingFood, type Recipe } from './lib/recipes';
import { loadSettings, saveSettings, type Settings as SettingsT } from './lib/settings';

type Tab = 'today' | 'recipes' | 'trends' | 'settings';
type SheetState =
  | null
  | { type: 'review'; id: number; review: ReviewState }
  | { type: 'text' }
  | { type: 'recent'; recipes: Recipe[] }
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
    let thumb: string | undefined;
    try {
      const res = await identifyPhoto(file, 'log', (message, t) => {
        thumb = t ?? thumb;
        show({ status: 'working', message, thumb });
      });
      show({ status: 'ready', thumb: res.thumb, note: res.note, items: res.items });
    } catch (err) {
      show({ status: 'error', thumb, message: (err as Error).message || 'Something went wrong.' });
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

  /** Log servings of a recipe (a snapshot of its current nutrition) to the selected day. */
  async function logRecipe(r: Recipe, servings: number, goToToday = false) {
    const ids = await logFoods([{ food: recipeServingFood(r), qty: servings }], date);
    refresh();
    if (goToToday) setTab('today');
    setToast({
      id: Date.now(),
      message: `Added ${fmtQty(servings)} serving${servings === 1 ? '' : 's'} of ${recipeName(r)}`,
      actionLabel: 'Undo',
      onAction: async () => {
        await deleteEntries(ids);
        refresh();
      },
    });
  }

  const toastFn = (t: Omit<ToastState, 'id'>) => setToast({ ...t, id: Date.now() });

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
        {tab === 'recipes' && (
          <Recipes dayLabel={label} version={version} toast={toastFn} onLog={(r, n, fromEditor) => logRecipe(r, n, fromEditor)} />
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
          <button class="add-btn" onClick={async () => setSheet({ type: 'recent', recipes: await allRecipes() })}>
            <Icon name="clock" />
            <span>Recent</span>
          </button>
        </div>
      )}

      <nav class="tabbar">
        {(
          [
            ['today', 'today', 'Today'],
            ['recipes', 'recipes', 'Recipes'],
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
      {sheet?.type === 'recent' && (
        <RecentSheet recipes={sheet.recipes} onPick={onPickRecent} onPickRecipe={(r) => logRecipe(r, 1)} onClose={closeSheet} />
      )}
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
