import { useEffect, useState } from 'preact/hooks';
import { NUTRIENT_INFO, NUTRIENT_KEYS } from '../../shared/types';
import { health } from '../lib/api';
import { countEntries, entriesInRange, eraseAll, exportAll, importAll, type Backup } from '../lib/db';
import { MAX_BACKUP_BYTES, sanitizeTargets } from '../lib/backup';
import { csvRow } from '../lib/csv';
import { describeAmount } from '../lib/format';
import { DEFAULT_TARGETS, TARGET_DEFS, type Settings as SettingsT } from '../lib/settings';
import { entryNutrients } from '../lib/stats';

async function shareOrDownload(name: string, type: string, content: string) {
  const file = new File([content], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function Settings({
  settings,
  onChange,
  onDataChanged,
  notify,
}: {
  settings: SettingsT;
  onChange: (s: SettingsT) => void;
  onDataChanged: () => void;
  notify: (msg: string, error?: boolean) => void;
}) {
  const [passcode, setPasscode] = useState(settings.passcode);
  const [status, setStatus] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

  useEffect(() => {
    countEntries().then(setCount);
  }, []);

  async function saveAndTest() {
    onChange({ ...settings, passcode: passcode.trim() });
    setStatus('Checking…');
    // Settings are saved synchronously by onChange, so the call below uses the new passcode.
    try {
      const h = await health();
      setStatus(
        `Connected. AI model: ${h.model}.${h.anthropic ? '' : ' Missing ANTHROPIC_API_KEY.'} USDA lookups: ${h.usda ? 'on' : 'off (no USDA_API_KEY)'}.`,
      );
    } catch (err) {
      setStatus((err as Error).message);
    }
  }

  async function exportJson() {
    const { passcode: _omit, ...rest } = settings;
    const data = await exportAll(rest);
    await shareOrDownload(`food-log-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json', JSON.stringify(data));
  }

  async function exportCsv() {
    const entries = (await entriesInRange('0000-00-00', '9999-99-99')).sort((a, b) => a.ts - b.ts);
    const head = ['date', 'time', 'food', 'brand', 'amount', 'source', ...NUTRIENT_KEYS.map((k) => `${k}_${NUTRIENT_INFO[k].unit}`)];
    const rows = entries.map((e) => {
      const n = entryNutrients(e);
      return csvRow([
        e.date,
        new Date(e.ts).toTimeString().slice(0, 5),
        e.food.name,
        e.food.brand ?? '',
        describeAmount(e.food, e.qty),
        e.food.source,
        ...NUTRIENT_KEYS.map((k) => Math.round(n[k] * 10) / 10),
      ]);
    });
    await shareOrDownload(`food-log-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv', [csvRow(head), ...rows].join('\n'));
  }

  async function importFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      notify('That file is too large to be a Food Log backup.', true);
      return;
    }
    try {
      const backup = JSON.parse(await file.text()) as Backup;
      const { imported, skipped, recipes } = await importAll(backup);
      const s = backup.settings as { targets?: unknown } | undefined;
      const targets = sanitizeTargets(s?.targets);
      if (Object.keys(targets).length) onChange({ ...settings, targets: { ...settings.targets, ...targets } });
      notify(`Restored ${imported} entries${recipes ? ` and ${recipes} recipe${recipes === 1 ? '' : 's'}` : ''}.${skipped ? ` Skipped ${skipped} damaged entries.` : ''}`);
      setCount(await countEntries());
      onDataChanged();
    } catch (err) {
      notify((err as Error).message || 'Could not read that file.', true);
    }
  }

  async function erase() {
    if (!confirm('Erase every logged entry and saved food on this phone? Export a backup first if you might want it.')) return;
    if (!confirm('This cannot be undone. Erase everything?')) return;
    await eraseAll();
    setCount(0);
    onDataChanged();
    notify('All data erased.');
  }

  return (
    <>
      <header class="page-head">
        <h1>Settings</h1>
      </header>

      {!standalone && (
        <section class="card callout">
          <strong>Install on your iPhone</strong>
          <p>
            In Safari, tap the Share button, then <b>Add to Home Screen</b>. The app then opens full screen from its own icon.
          </p>
        </section>
      )}

      <section class="card">
        <h3 class="section-label">Connection</h3>
        <label class="field">
          <span>Passcode</span>
          <input
            type="password"
            autoComplete="current-password"
            value={passcode}
            placeholder="The APP_PASSCODE you set in Cloudflare"
            maxLength={200}
            onInput={(e) => setPasscode((e.target as HTMLInputElement).value)}
          />
        </label>
        <p class="hint">At least 12 characters. It must match APP_PASSCODE in Cloudflare.</p>
        <button class="primary-btn" onClick={saveAndTest}>
          Save and test
        </button>
        {status && <p class="hint">{status}</p>}
      </section>

      <section class="card">
        <h3 class="section-label">Daily targets</h3>
        <p class="hint">Confirm your targets with your doctor. Set any to 0 to hide it.</p>
        {TARGET_DEFS.map((d) => (
          <label class="field" key={d.key}>
            <span>
              {NUTRIENT_INFO[d.key].label} <span class="muted">({NUTRIENT_INFO[d.key].unit}, {d.kind === 'goal' ? 'at least' : 'at most'})</span>
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={settings.targets[d.key] ?? ''}
              onChange={(e) => {
                const v = parseFloat((e.target as HTMLInputElement).value);
                onChange({ ...settings, targets: { ...settings.targets, [d.key]: Number.isFinite(v) && v >= 0 ? v : 0 } });
              }}
            />
            <small class="muted">{d.hint}</small>
          </label>
        ))}
        <button class="secondary-btn" onClick={() => onChange({ ...settings, targets: { ...DEFAULT_TARGETS } })}>
          Reset to defaults
        </button>
      </section>

      <section class="card">
        <h3 class="section-label">Your data</h3>
        <p class="hint">
          {count === null ? '' : `${count.toLocaleString()} entries stored on this phone. `}
          Data lives only on this phone for now. Export a backup now and then, and before deleting the app icon.
        </p>
        <div class="btn-grid">
          <button class="secondary-btn" onClick={exportJson}>
            Back up (JSON)
          </button>
          <button class="secondary-btn" onClick={exportCsv}>
            Export CSV
          </button>
          <label class="secondary-btn file-btn">
            Restore backup
            <input type="file" accept="application/json,.json" onChange={importFile} />
          </label>
          <button class="danger-btn" onClick={erase}>
            Erase all data
          </button>
        </div>
      </section>

      <p class="footnote muted">
        Nutrition data: USDA FoodData Central, Open Food Facts, and AI estimates. Photo portions are estimates; adjust amounts when you know them.
      </p>
    </>
  );
}
