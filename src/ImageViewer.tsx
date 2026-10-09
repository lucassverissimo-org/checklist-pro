import React from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import type { Access, Attachment } from "./model";
import { fileAction } from "./attachments";
import { Modal } from "./components";

type View = { scale: number; x: number; y: number };
const initial: View = { scale: 1, x: 0, y: 0 };

export function ImageViewer({
  access,
  file,
  onClose,
}: {
  access: Access;
  file: Attachment;
  onClose: () => void;
}) {
  const [url, setUrl] = React.useState<string>();
  const [error, setError] = React.useState(false);
  const [view, setView] = React.useState(initial);
  const viewport = React.useRef<HTMLDivElement>(null);
  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const gesture = React.useRef<{
    distance: number;
    x: number;
    y: number;
    view: View;
  }>();
  const current = React.useRef(view);
  current.current = view;
  React.useEffect(() => {
    let active = true;
    let localUrl: string | undefined;
    void (async () => {
      let source: string | undefined;
      try {
        source = (await fileAction(access, "download", file.id)).url;
        if (!source) throw new Error();
        const response = await fetch(source);
        if (!response.ok) throw new Error();
        localUrl = URL.createObjectURL(await response.blob());
        if (active) setUrl(localUrl);
        else URL.revokeObjectURL(localUrl);
      } catch {
        if (active) setError(true);
      } finally {
        if (source?.startsWith("blob:")) URL.revokeObjectURL(source);
      }
    })();
    return () => {
      active = false;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [access.id, access.token, access.demo, file.id]);
  function zoom(factor: number) {
    setView((old) => {
      const scale = Math.max(1, Math.min(8, old.scale * factor));
      return {
        scale,
        x: (old.x * scale) / old.scale,
        y: (old.y * scale) / old.scale,
      };
    });
  }
  React.useEffect(() => {
    const element = viewport.current;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(Math.exp(-event.deltaY * 0.002));
    };
    element?.addEventListener("wheel", wheel, { passive: false });
    return () => element?.removeEventListener("wheel", wheel);
  }, []);
  function startGesture() {
    const points = [...pointers.current.values()];
    if (!points.length) {
      gesture.current = undefined;
      return;
    }
    const a = points[0],
      b = points[1] ?? a;
    gesture.current = {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      view: current.current,
    };
  }
  return (
    <Modal title={file.name} onClose={onClose} className="image-modal">
      <div className="image-toolbar">
        <button
          className="btn small"
          aria-label="Diminuir zoom"
          disabled={!url || view.scale <= 1}
          onClick={() => zoom(1 / 1.25)}
        >
          <Minus size={18} />
        </button>
        <output aria-label="Zoom da imagem">
          {Math.round(view.scale * 100)}%
        </output>
        <button
          className="btn small"
          aria-label="Aumentar zoom"
          disabled={!url || view.scale >= 8}
          onClick={() => zoom(1.25)}
        >
          <Plus size={18} />
        </button>
        <button
          className="btn small"
          disabled={!url}
          onClick={() => setView(initial)}
        >
          <RotateCcw size={16} /> Ajustar
        </button>
      </div>
      <div
        ref={viewport}
        className="image-viewport"
        onPointerDown={(event) => {
          if (!url || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          startGesture();
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId) || !gesture.current)
            return;
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          const points = [...pointers.current.values()];
          const a = points[0],
            b = points[1] ?? a;
          const base = gesture.current;
          const ratio =
            points.length > 1 && base.distance > 0
              ? Math.hypot(a.x - b.x, a.y - b.y) / base.distance
              : 1;
          const scale = Math.max(1, Math.min(8, base.view.scale * ratio));
          const rect = event.currentTarget.getBoundingClientRect();
          const factor = scale / base.view.scale;
          const x = (a.x + b.x) / 2,
            y = (a.y + b.y) / 2;
          setView({
            scale,
            x:
              scale === 1
                ? 0
                : base.view.x * factor +
                  x -
                  base.x +
                  (1 - factor) * (base.x - rect.left - rect.width / 2),
            y:
              scale === 1
                ? 0
                : base.view.y * factor +
                  y -
                  base.y +
                  (1 - factor) * (base.y - rect.top - rect.height / 2),
          });
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          startGesture();
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          startGesture();
        }}
        onLostPointerCapture={(event) => {
          pointers.current.delete(event.pointerId);
          startGesture();
        }}
        onDoubleClick={() =>
          setView(view.scale > 1 ? initial : { scale: 2, x: 0, y: 0 })
        }
      >
        {error ? (
          <p role="alert">
            Não foi possível abrir a imagem. Feche e tente novamente.
          </p>
        ) : url ? (
          <img
            src={url}
            alt={file.name}
            draggable={false}
            onError={() => setError(true)}
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
          />
        ) : (
          <p role="status">Carregando imagem…</p>
        )}
      </div>
      <p className="field-hint">
        Use a roda do mouse ou os botões para ampliar. No celular, use dois
        dedos. Arraste para explorar a imagem.
      </p>
    </Modal>
  );
}
