import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { EditSheet } from './components/EditSheet';
import { Icon } from './components/Icon';
import { RecentSheet } from './components/RecentSheet';
import { Recipes } from './components/Recipes';
import { ReviewSheet, type ReviewItem, type ReviewState } from './components/ReviewSheet';
import { Settings } from './components/Settings';
import { TextSheet } from './components/TextSheet';
import { Toast, type ToastState } from './components/Toast';
import { Today } from './components/Today';
import { Trends } from './components/Trends';
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
import { rememberBarcode, rememberText } from './lib/memory';
import { recipeName, recipeServingFood, type Recipe } from './lib/recipes';
import { loadSettings, saveSettings, type Settings as SettingsT } from './lib/settings';
import { analyzeTextSmart } from './lib/smart';

type Tab = 'today' | 'recipes' | 'trends' | 'settings';

/** Where a review came from, so a confirmed answer can be remembered (or redone with AI). */
interface ReviewContext {
  text?: string;
  file?: File;
  barcode?: string;
}
type SheetState =
  | null
  | { type: 'review'; id: number; review: ReviewState; ctx: ReviewContext }
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

  async function addItems(items: ReviewItem[]) {
    const ctx = sheet?.type === 'review' ? sheet.ctx : {};
    const ids = await logFoods(items, date);
    // Remember what was confirmed (with any corrections) so repeats skip the AI.
    const confirmed = items.map(({ food, qty }) => ({ food, qty }));
    if (ctx.text) rememberText('log', ctx.text, { items: confirmed, note: '' });
    if (ctx.barcode && confirmed.length === 1) rememberBarcode(ctx.barcode, confirmed[0].food);
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

  async function onPhoto(file: File, skipMemory = false) {
    const id = ++job.current;
    const ctx: ReviewContext = { file };
    const show = (review: ReviewState) => job.current === id && setSheet({ type: 'review', id, review, ctx });
    let thumb: string | undefined;
    try {
      const res = await identifyPhoto(
        file,
        'log',
        (message, t) => {
          thumb = t ?? thumb;
          show({ status: 'working', message, thumb });
        },
        { skipMemory },
      );
      ctx.barcode = res.barcode;
      show({
        status: 'ready',
        thumb: res.thumb,
        note: res.note,
        items: res.items.map((food) => ({ food, qty: 1 })),
        fromMemory: res.fromMemory,
      });
    } catch (err) {
      show({ status: 'error', thumb, message: (err as Error).message || 'Something went wrong.' });
    }
  }

  async function onText(text: string, force = false) {
    const id = ++job.current;
    const ctx: ReviewContext = { text };
    const show = (review: ReviewState) => job.current === id && setSheet({ type: 'review', id, review, ctx });
    show({ status: 'working', message: force ? 'Asking AI…' : 'Working it out…' });
    try {
      const res = await analyzeTextSmart(text, 'log', force);
      show({ status: 'ready', note: res.note, items: res.items, fromMemory: res.source !== 'ai' });
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
          onAskAI={() => {
            const { text, file } = sheet.ctx;
            if (text) onText(text, true);
            else if (file) onPhoto(file, true);
          }}
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
