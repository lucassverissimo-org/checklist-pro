import React from "react";
import { Plus, LoaderCircle } from "lucide-react";

export function QuickAdd({
  label,
  placeholder,
  maxLength,
  disabled,
  inputRef,
  onAdd,
  onAdded,
}: {
  label: string;
  placeholder: string;
  maxLength: number;
  disabled: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
  onAdd: (value: string) => Promise<boolean>;
  onAdded?: () => void;
}) {
  const [value, setValue] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const ownRef = React.useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  const saving = React.useRef(false);
  return (
    <form
      className="quick-add"
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.nativeEvent.isComposing)
          event.preventDefault();
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (disabled || saving.current || !value.trim()) return;
        saving.current = true;
        setSubmitting(true);
        let added = false;
        try {
          added = await onAdd(value.trim());
          if (added) setValue("");
        } finally {
          saving.current = false;
          setSubmitting(false);
          // Keep typing in this row after every save, without an extra click.
          requestAnimationFrame(() => {
            if (added && onAdded) onAdded();
            else ref.current?.focus();
          });
        }
      }}
    >
      <Plus size={17} aria-hidden="true" />
      <input
        ref={ref}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={maxLength}
        readOnly={submitting}
        disabled={disabled && !submitting}
        enterKeyHint="done"
      />
      <button
        type="submit"
        className="iconbtn quick-submit"
        aria-label={`Adicionar ${label.toLocaleLowerCase("pt-BR")}`}
        title="Adicionar (Enter)"
        disabled={disabled || submitting || !value.trim()}
      >
        {submitting ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <Plus size={17} />
        )}
      </button>
      <span className="quick-hint" aria-hidden="true">
        Enter ↵
      </span>
    </form>
  );
}
