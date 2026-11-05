import type { AnalyzeMode, FoodItem } from '../../shared/types';
import { analyzePhoto, lookupBarcode } from './api';
import { detectBarcode } from './barcode';
import { blobToBase64, canvasToBlob, drawScaled, loadImage } from './image';

export interface PhotoResult {
  items: FoodItem[];
  note: string;
  thumb: string;
  /** Set when the food came from a barcode lookup (one serving of a product). */
  barcode?: string;
  recipeName?: string;
  servings?: number;
}

/**
 * Photo → barcode lookup if a barcode is visible, otherwise Claude.
 * `progress` reports each step (and the preview image once it's ready).
 */
export async function identifyPhoto(
  file: File,
  mode: AnalyzeMode,
  progress: (message: string, thumb?: string) => void,
): Promise<PhotoResult> {
  progress('Reading photo…');
  const img = await loadImage(file);
  const forAi = drawScaled(img, 1280);
  const blob = await canvasToBlob(forAi);
  const thumb = URL.createObjectURL(blob);
  progress('Checking for a barcode…', thumb);

  let note = '';
  const code = await detectBarcode(drawScaled(img, 2000)).catch(() => null);
  if (code) {
    progress(`Looking up barcode ${code}…`, thumb);
    const r = await lookupBarcode(code);
    if (r.found && r.food) return { items: [r.food], note: `Barcode ${code}`, thumb, barcode: code };
    note = `Barcode ${code} isn't in the food databases, so this is an AI read of the photo. A photo of the Nutrition Facts label is more accurate.`;
  }

  progress(mode === 'recipe' ? 'Reading ingredients…' : 'Identifying food…', thumb);
  const res = await analyzePhoto(await blobToBase64(blob), mode);
  return {
    items: res.items,
    note: [note, res.note].filter(Boolean).join(' '),
    thumb,
    recipeName: res.recipeName,
    servings: res.servings,
  };
}
