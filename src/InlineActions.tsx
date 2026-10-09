import React from "react";
import { Check, Trash2, X } from "lucide-react";

export function InlineDelete<T>({
  label,
  snapshot,
  disabled,
  onDelete,
}: {
  label: string;
  snapshot: T;
  disabled: boolean;
  onDelete: (expected: T) => Promise<boolean>;
}) {
  const running = React.useRef(false);
  return (
    <button
      className="iconbtn danger"
      disabled={disabled}
      aria-label={`Excluir ${label}`}
      title="Excluir"
      onClick={async () => {
        if (disabled || running.current) return;
        running.current = true;
        try {
          await onDelete(snapshot);
        } finally {
          running.current = false;
        }
      }}
    >
      <Trash2 size={15} />
    </button>
  );
}

export function InlineEditor({
  current,
  disabled,
  onClose,
  onSave,
  label = "Comentário do item",
  multiline = true,
  allowEmpty = true,
  limit = 10000,
}: {
  label?: string;
  multiline?: boolean;
  allowEmpty?: boolean;
  limit?: number;
  current: string;
  disabled: boolean;
  onClose: () => void;
  onSave: (value: string, expected: string) => Promise<boolean>;
}) {
  const [value, setValue] = React.useState(current);
  const [base, setBase] = React.useState(current);
  const [failed, setFailed] = React.useState(false);
  const id = React.useId();
  const changed = current !== base;
  return (
    <form
      className="inline-comment"
      onSubmit={async (event) => {
        event.preventDefault();
        if (disabled || changed || (!allowEmpty && !value.trim())) return;
        if (await onSave(value.trim(), base)) onClose();
        else setFailed(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !disabled) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          autoFocus
          rows={3}
          maxLength={limit}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            setValue(event.target.value);
            setFailed(false);
          }}
        />
      ) : (
        <input
          id={id}
          autoFocus
          maxLength={limit}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            setValue(event.target.value);
            setFailed(false);
          }}
        />
      )}
      {changed && (
        <div className="notice" role="alert">
          <strong>
            {allowEmpty
              ? "Outra pessoa alterou este comentário."
              : "Outra pessoa alterou este texto."}
          </strong>
          <p className="current-version">
            Versão atual: {current || "(sem comentário)"}
          </p>
          <div className="button-row">
            <button
              type="button"
              className="btn small"
              disabled={disabled}
              onClick={() => {
                setValue(current);
                setBase(current);
              }}
            >
              Usar versão atual
            </button>
            <button
              type="button"
              className="btn small"
              disabled={disabled}
              onClick={() => setBase(current)}
            >
              Manter meu texto
            </button>
          </div>
        </div>
      )}
      {failed && (
        <p className="error" role="alert">
          Não foi possível salvar. Seu texto foi mantido; confira a conexão e as
          alterações.
        </p>
      )}
      <div className="inline-comment-footer">
        <span className="field-hint">
          {allowEmpty
            ? "Deixe vazio para remover o comentário."
            : multiline
              ? "Salve para atualizar o item."
              : "Enter salva. Escape cancela."}
        </span>
        <div className="button-row">
          <button
            type="button"
            className="btn small"
            disabled={disabled}
            onClick={onClose}
          >
            <X size={15} /> Cancelar
          </button>
          <button
            className="btn primary small"
            disabled={disabled || changed || (!allowEmpty && !value.trim())}
          >
            <Check size={15} /> Salvar
          </button>
        </div>
      </div>
    </form>
  );
}

export const InlineComment = InlineEditor;
