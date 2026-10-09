import React from "react";
import { Plus, LoaderCircle } from "lucide-react";
import { detectList } from "./lists";

export function QuickAdd({
  label,
  placeholder,
  maxLength,
  disabled,
  inputRef,
  onAdd,
  onAdded,
  onAddMany,
}: {
  label: string;
  placeholder: string;
  maxLength: number;
  disabled: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
  onAdd: (value: string) => Promise<boolean>;
  onAdded?: () => void;
  onAddMany?: (values: string[]) => Promise<boolean>;
}) {
  const [value, setValue] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const ownRef = React.useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  const saving = React.useRef(false);
  const [list, setList] = React.useState<string[] | null>(null);
  const [pasteError, setPasteError] = React.useState("");
  const submit = async (values?: string[]) => {
    if (disabled || saving.current) return;
    saving.current = true;
    setSubmitting(true);
    setPasteError("");
    let added = false;
    try {
      added =
        values && onAddMany
          ? await onAddMany(values)
          : await onAdd(value.trim());
      if (added) {
        setValue("");
        setList(null);
      } else if (values)
        setPasteError(
          "Não foi possível adicionar. A lista foi mantida; confira os limites ou a conexão e tente novamente.",
        );
    } finally {
      saving.current = false;
      setSubmitting(false);
      requestAnimationFrame(() => {
        if (added && onAdded) onAdded();
        else ref.current?.focus();
      });
    }
  };
  return (
    <div className="quick-add-wrapper">
      <form
        className="quick-add"
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.nativeEvent.isComposing)
            event.preventDefault();
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!value.trim() || list || value.length > maxLength) return;
          await submit();
        }}
      >
        <Plus size={17} aria-hidden="true" />
        <input
          ref={ref}
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onPaste={(event) => {
            if (!onAddMany || submitting || disabled) return;
            const pasted = event.clipboardData.getData("text/plain");
            const field = event.currentTarget;
            const text =
              value.slice(0, field.selectionStart ?? value.length) +
              pasted +
              value.slice(field.selectionEnd ?? value.length);
            const items = detectList(text);
            if (items.length) {
              event.preventDefault();
              setValue(text.trim());
              setList(items);
              setPasteError("");
            } else if (
              text.length > maxLength ||
              text.split(/[\n;]/).filter((line) => line.trim()).length > 100
            ) {
              event.preventDefault();
              setPasteError(
                "A lista é muito grande ou contém mais de 100 itens. Cole em partes, sem cortar o texto.",
              );
            }
          }}
          maxLength={maxLength}
          readOnly={submitting || !!list}
          disabled={disabled && !submitting}
          enterKeyHint="done"
        />
        <button
          type="submit"
          className="iconbtn quick-submit"
          aria-label={`Adicionar ${label.toLocaleLowerCase("pt-BR")}`}
          title="Adicionar (Enter)"
          disabled={
            disabled ||
            submitting ||
            !!list ||
            !value.trim() ||
            value.length > maxLength
          }
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
      {pasteError && (
        <p className="error" role="alert">
          {pasteError}
        </p>
      )}
      {list && (
        <div className="paste-preview">
          <strong>Detectamos {list.length} possíveis itens.</strong>
          <p>Confira os textos antes de adicionar. A ordem será mantida.</p>
          <div className="paste-list">
            {list.map((item, index) => (
              <input
                key={index}
                aria-label={`Item colado ${index + 1}`}
                value={item}
                maxLength={2000}
                disabled={disabled || submitting}
                onChange={(event) =>
                  setList((old) =>
                    old!.map((text, i) =>
                      i === index ? event.target.value : text,
                    ),
                  )
                }
              />
            ))}
          </div>
          <div className="button-row">
            <button
              className="btn primary small"
              disabled={
                disabled || submitting || list.some((item) => !item.trim())
              }
              onClick={() => void submit(list.map((item) => item.trim()))}
            >
              Adicionar {list.length} itens
            </button>
            <button
              className="btn small"
              disabled={disabled || submitting || value.length > maxLength}
              onClick={() => setList(null)}
            >
              Manter como um item
            </button>
            <button
              className="btn small"
              disabled={submitting}
              onClick={() => {
                setList(null);
                setValue("");
                ref.current?.focus();
              }}
            >
              Cancelar
            </button>
          </div>
          {value.length > maxLength && (
            <p className="field-hint">
              O texto completo excede 2.000 caracteres; divida os itens ou
              cancele.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
