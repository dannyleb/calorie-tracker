import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from './Sheet';

export function TextSheet({ onSubmit, onClose }: { onSubmit: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = () => text.trim() && onSubmit(text.trim());

  return (
    <Sheet
      title="What did you eat?"
      onClose={onClose}
      footer={
        <button class="primary-btn" disabled={!text.trim()} onClick={submit}>
          Analyze
        </button>
      }
    >
      <textarea
        ref={ref}
        class="big-input"
        rows={4}
        placeholder="e.g. two scrambled eggs, a slice of whole wheat toast with butter, and a coffee with milk"
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <p class="hint">Tap the microphone on your keyboard to dictate. Include amounts if you know them.</p>
    </Sheet>
  );
}
