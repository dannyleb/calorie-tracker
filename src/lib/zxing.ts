import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// Serve the .wasm from our own origin (and the offline cache) instead of a CDN.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
});

export async function readWithZxing(image: ImageData): Promise<string | null> {
  const results = await readBarcodes(image, {
    formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'],
    tryHarder: true,
    maxNumberOfSymbols: 1,
  });
  return results.find((r) => r.isValid)?.text ?? null;
}
