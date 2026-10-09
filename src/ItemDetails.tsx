import React from "react";
import {
  Check,
  Download,
  Image as ImageIcon,
  Paperclip,
  Trash2,
  X,
} from "lucide-react";
import type { Access, Attachment, Operation, Priority, Task } from "./model";
import { fileAction, fileTypes, uploadFile } from "./attachments";
import { ImageViewer } from "./ImageViewer";

export const priorityLabels: Record<Priority, string> = {
  none: "Sem prioridade",
  low: "Baixa",
  medium: "Média",
  high: "Alta",
};

function AttachmentThumbnail({
  access,
  file,
}: {
  access: Access;
  file: Attachment;
}) {
  const [url, setUrl] = React.useState<string>();
  const [failed, setFailed] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const thumbnail = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setUrl(undefined);
    setFailed(false);
    void fileAction(access, "download", file.id).then(
      (result) => {
        if (result.url?.startsWith("blob:")) objectUrl = result.url;
        if (active) {
          if (result.url) setUrl(result.url);
          else setFailed(true);
        } else if (objectUrl) URL.revokeObjectURL(objectUrl);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [access.id, access.token, access.demo, file.id]);
  return (
    <>
      <button
        type="button"
        className="attachment-thumbnail"
        ref={thumbnail}
        aria-label={`Abrir imagem ${file.name}`}
        onClick={() => setOpen(true)}
      >
        {url && !failed ? (
          <img
            src={url}
            alt={`Miniatura de ${file.name}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        ) : (
          <ImageIcon
            size={22}
            aria-label={
              failed ? "Miniatura indisponível" : "Carregando miniatura"
            }
          />
        )}
      </button>
      {open && (
        <ImageViewer
          access={access}
          file={file}
          onClose={() => {
            setOpen(false);
            requestAnimationFrame(() => thumbnail.current?.focus());
          }}
        />
      )}
    </>
  );
}

export function ItemDetails({
  access,
  sectionId,
  task,
  files,
  disabled,
  onClose,
  onSave,
  onRefresh,
  onWorking,
}: {
  access: Access;
  sectionId: string;
  task: Task;
  files: Attachment[];
  disabled: boolean;
  onClose: () => void;
  onSave: (op: Operation) => Promise<boolean>;
  onRefresh: () => Promise<void>;
  onWorking: (working: boolean) => void;
}) {
  const [comment, setComment] = React.useState(task.comment);
  const [priority, setPriority] = React.useState<Priority>(
    task.priority ?? "none",
  );
  const [base, setBase] = React.useState({
    comment: task.comment,
    priority: task.priority ?? "none",
  });
  const [working, setWorking] = React.useState(false);
  React.useEffect(() => {
    onWorking(working);
    return () => onWorking(false);
  }, [working, onWorking]);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [error, setError] = React.useState("");
  const id = React.useId();
  const changedComment = task.comment !== base.comment;
  const changedPriority = (task.priority ?? "none") !== base.priority;
  const changed = changedComment || changedPriority;
  React.useEffect(() => {
    if (task.comment !== base.comment && comment === base.comment) {
      setComment(task.comment);
      setBase((old) => ({ ...old, comment: task.comment }));
    }
    const currentPriority = task.priority ?? "none";
    if (currentPriority !== base.priority && priority === base.priority) {
      setPriority(currentPriority);
      setBase((old) => ({ ...old, priority: currentPriority }));
    }
  }, [
    task.comment,
    task.priority,
    base.comment,
    base.priority,
    comment,
    priority,
  ]);
  const blocked = disabled || working;
  const lock = React.useRef(false);
  async function run(action: () => Promise<void>) {
    if (lock.current || disabled) return;
    lock.current = true;
    setWorking(true);
    setError("");
    try {
      await action();
      await onRefresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível concluir. Tente novamente.",
      );
    } finally {
      setWorking(false);
      setProgress(null);
      lock.current = false;
    }
  }
  return (
    <div
      className="item-details"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !blocked) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <h3>Detalhes do item</h3>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (blocked || changed) return;
          const patch: { comment?: string; priority?: Priority } = {};
          const expected: { comment?: string; priority?: Priority } = {};
          if (comment.trim() !== base.comment) {
            patch.comment = comment.trim();
            expected.comment = base.comment;
          }
          if (priority !== base.priority) {
            patch.priority = priority;
            expected.priority = base.priority;
          }
          if (!Object.keys(patch).length) {
            onClose();
            return;
          }
          if (
            await onSave({
              type: "update_task",
              sectionId,
              taskId: task.id,
              patch,
              expected,
            })
          )
            onClose();
          else setError("Não foi possível salvar. Seu rascunho foi mantido.");
        }}
      >
        <label className="field-label" htmlFor={`${id}-comment`}>
          Comentário do item
        </label>
        <textarea
          id={`${id}-comment`}
          autoFocus
          rows={3}
          maxLength={10000}
          value={comment}
          disabled={blocked}
          onChange={(event) => setComment(event.target.value)}
        />
        <label className="field-label" htmlFor={`${id}-priority`}>
          Prioridade
        </label>
        <select
          id={`${id}-priority`}
          value={priority}
          disabled={blocked}
          onChange={(event) => setPriority(event.target.value as Priority)}
        >
          {Object.entries(priorityLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {changed && (
          <div className="notice" role="alert">
            <strong>
              {changedComment
                ? "Outra pessoa alterou este comentário."
                : "Outra pessoa alterou a prioridade."}
            </strong>
            <p className="current-version">
              Comentário atual: {task.comment || "(sem comentário)"}
              <br />
              Prioridade atual: {priorityLabels[task.priority ?? "none"]}
            </p>
            <div className="button-row">
              <button
                className="btn small"
                type="button"
                disabled={blocked}
                onClick={() => {
                  setComment(task.comment);
                  setPriority(task.priority ?? "none");
                  setBase({
                    comment: task.comment,
                    priority: task.priority ?? "none",
                  });
                }}
              >
                Usar versão atual
              </button>
              <button
                className="btn small"
                type="button"
                disabled={blocked}
                onClick={() =>
                  setBase({
                    comment: task.comment,
                    priority: task.priority ?? "none",
                  })
                }
              >
                Manter meu texto
              </button>
            </div>
          </div>
        )}
        <div className="inline-comment-footer">
          <span className="field-hint">
            Deixe o comentário vazio para removê-lo.
          </span>
          <div className="button-row">
            <button
              type="button"
              className="btn small"
              disabled={blocked}
              onClick={onClose}
            >
              <X size={15} /> Cancelar
            </button>
            <button className="btn primary small" disabled={blocked || changed}>
              <Check size={15} /> Salvar
            </button>
          </div>
        </div>
      </form>
      <div className="attachments-panel">
        <h4>
          <Paperclip size={16} /> Anexos <span>{files.length}/5</span>
        </h4>
        {files.map((file) => (
          <div className="attachment-row" key={file.id}>
            {file.mime.startsWith("image/") && (
              <AttachmentThumbnail access={access} file={file} />
            )}
            <span className="attachment-name">
              {file.name}
              <small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small>
            </span>
            <button
              className="iconbtn"
              disabled={blocked}
              aria-label={`Baixar ${file.name}`}
              onClick={() =>
                void run(async () => {
                  const { url } = await fileAction(access, "download", file.id);
                  const link = document.createElement("a");
                  link.href = url!;
                  link.download = file.name;
                  link.rel = "noopener noreferrer";
                  document.body.append(link);
                  link.click();
                  link.remove();
                  if (url?.startsWith("blob:"))
                    setTimeout(() => URL.revokeObjectURL(url), 60000);
                })
              }
            >
              <Download size={16} />
            </button>
            <button
              className="iconbtn danger"
              disabled={blocked}
              aria-label={`Excluir anexo ${file.name}`}
              onClick={() =>
                void run(async () => {
                  await fileAction(access, "delete", file.id);
                })
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <label
          className={`btn small attachment-upload ${blocked || files.length >= 5 ? "disabled" : ""}`}
        >
          <Paperclip size={15} /> Adicionar anexo
          <input
            type="file"
            aria-label="Adicionar anexo"
            accept={fileTypes}
            disabled={blocked || files.length >= 5}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file)
                void run(async () => {
                  setProgress(0);
                  await uploadFile(
                    access,
                    sectionId,
                    task.id,
                    file,
                    setProgress,
                  );
                });
            }}
          />
        </label>
        {progress !== null && (
          <div className="upload-progress" role="status">
            <progress max={100} value={progress} />
            <span>Enviando… {progress}%</span>
          </div>
        )}
        <p className="field-hint">
          Imagens e PDFs, até 10 MB por arquivo. Anexos são salvos ao enviar,
          independentemente do botão Salvar.
          {access.demo && " Na demonstração, ficam apenas neste navegador."}
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
