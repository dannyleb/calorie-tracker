# Food Log

A personal food tracker for iPhone, built to keep logging fast and simple. Snap a photo of food, a barcode or a nutrition label, check what it found, tap **Add**. It totals your day and shows weekly, monthly, quarterly and yearly trends, with extra focus on **saturated fat, cholesterol, fiber and sodium**.

It's a web app you install to your home screen (a PWA). You don't need the App Store or an Apple developer account.

## What it does

| Input | How it works | Accuracy |
|---|---|---|
| Photo of a barcode | Decoded on the phone, then looked up in USDA's branded foods database (Open Food Facts as a backup) | High |
| Photo of a Nutrition Facts label | Claude reads the label values directly | High |
| Photo of food (raw produce, a plate) | Claude identifies each item and estimates grams; nutrients come from USDA data when there's a sensible match, otherwise from Claude's estimate | Food: good. Portion: ±20–30% |
| "Say it" | Dictate with the keyboard mic ("two eggs and toast with butter"); Claude turns it into items | Good |
| Recent & favorites | One tap re-adds a food with the amount you used last time | Exact |

- **Amounts:** use the − / + buttons, or say or type an amount ("half a cup", "150 g", "2"). Simple amounts are worked out on the phone; anything else goes to Claude.
- **Today:** calories plus heart-health meters (saturated fat, cholesterol, fiber with estimated soluble fiber, sodium) and macros. Use ‹ › to view or log past days.
- **Trends:** week / month / quarter / year. Shows averages per logged day with change vs. the prior period, days over each limit, a bar chart with your target line, top food sources of any nutrient, and a totals table.
- **Data:** stored only on your phone for now. Settings has backup (JSON), CSV export and restore.

## One-time setup (about 20 minutes)

### 1. Get two API keys
1. **Anthropic (Claude):** sign in at [platform.claude.com](https://platform.claude.com), add billing, create an API key, and **set a monthly spend limit** (e.g. $20).
2. **USDA FoodData Central** (free): sign up at [api.data.gov/signup](https://api.data.gov/signup/) and the key is emailed to you. Without it the app still works, but nutrients come from AI estimates instead of USDA data.

### 2. Deploy on Cloudflare Pages (free)
Cloudflare's menus change from time to time, so these names may differ slightly.

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Go to **Workers & Pages → Create → Pages → Connect to Git**, authorize GitHub, and pick `dannyleb/calorie-tracker`.
3. Build settings:
   - Framework preset: **None** (or Vite)
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Deploy. You'll get a URL like `https://calorie-tracker-xxx.pages.dev`.
5. In the project, open **Settings → Variables and Secrets** (Production) and add these, each as a **Secret**:

   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your Anthropic key |
   | `USDA_API_KEY` | your USDA key |
   | `APP_PASSCODE` | a long passcode you make up; the app sends it with every AI request so strangers can't use your key |
   | `CLAUDE_MODEL` *(optional)* | defaults to `claude-opus-5-5` |
   | `CLAUDE_EFFORT` *(optional)* | `low` (default, fastest), `medium` or `high` |

6. **Redeploy** (Deployments → latest → Retry deployment) so the new variables take effect.

From now on, every push to `main` redeploys automatically.

### 3. Install on your iPhone
1. Open your `pages.dev` URL in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open the app from the new icon, go to **Settings**, enter your passcode and tap **Save and test**. It should say "Connected".

## Cost

You pay Anthropic per AI call; everything else is free. Rough estimate at ~10 photo scans a day:

| `CLAUDE_MODEL` | Per scan | Per month |
|---|---|---|
| `claude-opus-5-5` (default) | ~$0.02–0.03 | ~$5–10 |
| `claude-sonnet-5-5` | ~$0.01 | ~$3–5 |
| `claude-haiku-5-5` | < $0.001 | < $1 |

Barcode scans that are found in the databases and "Recent" re-adds don't call the AI at all. To switch models, change `CLAUDE_MODEL` in Cloudflare and redeploy.

## Your data

- Everything is stored in the app's storage on your phone (IndexedDB). Nothing leaves the phone except the photo, text or barcode number you're looking up.
- **Deleting the home-screen icon deletes the data.** Use **Settings → Back up (JSON)** now and then and save it to Files. **Restore backup** brings it back.
- A synced database is the next planned feature (see Roadmap).

## Health note

The default targets follow common guidance for high LDL: saturated fat under ~13 g (AHA: under 6% of calories), dietary cholesterol under 200 mg (TLC diet), fiber 30 g with 10 g+ soluble, sodium under 2,300 mg. For most people, saturated and trans fat raise LDL more than cholesterol in food does, and soluble fiber lowers it, so the app shows all of them. Confirm your targets with your doctor and change them in Settings. Photo-based portions are estimates.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in your keys
npm run cf:dev                   # app + API at http://localhost:8788
```

- `npm test`: unit tests (nutrition math, barcode handling, USDA/Open Food Facts parsing, amount parsing, trends)
- `npm run typecheck`: TypeScript checks for the app and the API
- `npm run dev`: front-end only, with hot reload (proxies `/api` to `cf:dev` on port 8788)

## How it's built

```
src/                 Phone app (Preact + TypeScript, ~22 KB gzipped)
  components/        Today, Trends, Settings, review/edit sheets, bar chart
  lib/               IndexedDB storage, image resizing, barcode detection, stats
functions/api/       Cloudflare Pages Functions (the server)
  analyze.ts         Photo/text → Claude (structured JSON) → USDA lookup
  barcode.ts         Barcode → USDA branded foods → Open Food Facts
  amount.ts          "half a cup" → quantity
  _middleware.ts     Passcode check for every /api route
shared/types.ts      Nutrient types used by both sides
tests/               Vitest unit tests
```

- **AI:** one Claude call per photo or description, using structured outputs so the response is always valid JSON. Server-side refusal fallback is enabled for Opus/Sonnet models.
- **Barcodes:** read on the phone with ZXing (WebAssembly), cached for offline use.
- **Offline:** the app shell is cached by a service worker; logging from Recent works offline, while AI and barcode lookups need a connection.

## Roadmap

- Cloud database with sync and backups (Cloudflare D1)
- Custom foods and saved meals
- Reminders
