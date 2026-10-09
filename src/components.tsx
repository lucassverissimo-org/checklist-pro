import React from "react";
import QRCode from "qrcode";
import { Check, Copy, Link2, X } from "lucide-react";

export function Modal({
  title,
  onClose,
  children,
  busy = false,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  busy?: boolean;
  className?: string;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const id = React.useId();
  React.useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-labelledby={id}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={id}>{title}</h2>
        <button
          className="iconbtn"
          aria-label="Fechar"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Share({
  editLink,
  adminLink,
  onClose,
  onGenerate,
  error,
  busy,
}: {
  editLink?: string;
  adminLink?: string;
  onClose: () => void;
  onGenerate: () => Promise<void>;
  error: string;
  busy: boolean;
}) {
  const [admin, setAdmin] = React.useState(false);
  const [qr, setQr] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [copyError, setCopyError] = React.useState("");
  const link = admin ? adminLink : editLink;
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    let active = true;
    setQr("");
    setCopied(false);
    setCopyError("");
    if (link)
      QRCode.toDataURL(link, { margin: 4, width: 320 })
        .then((image) => {
          if (active) setQr(image);
        })
        .catch(() => {
          if (active) setCopyError("Use o link abaixo para compartilhar.");
        });
    return () => {
      active = false;
    };
  }, [link]);
  const local = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(
    window.location.hostname,
  );
  return (
    <Modal title="Compartilhar checklist" onClose={onClose} busy={busy}>
      {adminLink && (
        <div className="share-tabs">
          <button
            className={!admin ? "active" : ""}
            onClick={() => setAdmin(false)}
          >
            Link de edição
          </button>
          <button
            className={admin ? "active" : ""}
            onClick={() => setAdmin(true)}
          >
            Meu link de administração
          </button>
        </div>
      )}
      <p className="muted">
        {admin
          ? "Guarde este link com você. Ele permite renovar o link de edição e excluir o checklist inteiro."
          : "Quem tiver este link poderá editar, concluir itens e acompanhar as alterações. Sem cadastro."}
      </p>
      {local && (
        <p className="notice">
          Este endereço é local. Para compartilhar entre dispositivos, use o
          endereço do site publicado ou um endereço acessível na sua rede.
        </p>
      )}
      {link ? (
        <>
          {qr && (
            <img
              className="qr"
              src={qr}
              alt={
                admin
                  ? "QR Code do link de administração"
                  : "QR Code do link de edição"
              }
            />
          )}
          <label className="field-label" htmlFor="share-link">
            {admin ? "Link de administração" : "Link para sua equipe"}
          </label>
          <div className="copy-field">
            <input
              id="share-link"
              ref={inputRef}
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                } catch {
                  inputRef.current?.focus();
                  inputRef.current?.select();
                  setCopyError(
                    "Link selecionado. Use a opção Copiar do navegador.",
                  );
                }
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
          <p className="field-hint" role="status">
            {copyError ||
              (copied
                ? "Link copiado!"
                : "O link é a chave de acesso. Compartilhe apenas com quem deve participar.")}
          </p>
        </>
      ) : (
        <div className="notice">
          <p>
            O link de edição não está salvo neste navegador. Você pode gerar um
            novo; o anterior deixará de funcionar.
          </p>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => void onGenerate()}
          >
            <Link2 size={16} /> Gerar novo link de edição
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Modal>
  );
}
