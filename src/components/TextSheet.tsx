import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from './Sheet';

export function TextSheet({
  onSubmit,
  onClose,
  title = 'What did you eat?',
  placeholder = 'e.g. two scrambled eggs, a slice of whole wheat toast with butter, and a coffee with milk',
  hint = 'Tap the microphone on your keyboard to dictate. Include amounts if you know them.',
  submitLabel = 'Analyze',
  maxLength = 1000,
  rows = 4,
}: {
  onSubmit: (text: string) => void;
  onClose: () => void;
  title?: string;
  placeholder?: string;
  hint?: string;
  submitLabel?: string;
  maxLength?: number;
  rows?: number;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = () => text.trim() && onSubmit(text.trim());

  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <button class="primary-btn" disabled={!text.trim()} onClick={submit}>
          {submitLabel}
        </button>
      }
    >
      <textarea
        ref={ref}
        class="big-input"
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <p class="hint">{hint}</p>
    </Sheet>
  );
}
