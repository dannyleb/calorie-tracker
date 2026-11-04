// Finds a retail barcode (UPC/EAN) in a photo. Uses the browser's BarcodeDetector when
// available, otherwise ZXing compiled to WebAssembly (loaded on first use).

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
const RETAIL = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

let nativeDetector: Detector | null | undefined;

async function getNative(): Promise<Detector | null> {
  if (nativeDetector !== undefined) return nativeDetector;
  nativeDetector = null;
  const BD = (globalThis as any).BarcodeDetector;
  if (BD?.getSupportedFormats) {
    try {
      const supported: string[] = await BD.getSupportedFormats();
      const formats = RETAIL.filter((f) => supported.includes(f));
      if (formats.length) nativeDetector = new BD({ formats }) as Detector;
    } catch {
      /* fall through to ZXing */
    }
  }
  return nativeDetector;
}

const isRetailCode = (s: string) => /^\d{8}$|^\d{12,14}$/.test(s);

export async function detectBarcode(canvas: HTMLCanvasElement): Promise<string | null> {
  const native = await getNative();
  if (native) {
    try {
      const hit = (await native.detect(canvas)).find((r) => isRetailCode(r.rawValue));
      if (hit) return hit.rawValue;
    } catch {
      /* fall through */
    }
  }
  const { readWithZxing } = await import('./zxing');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const text = await readWithZxing(ctx.getImageData(0, 0, canvas.width, canvas.height));
  return text && isRetailCode(text) ? text : null;
}
