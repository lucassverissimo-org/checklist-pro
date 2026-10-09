import React from "react";
import * as api from "./api";
import {
  ChecklistError,
  type Access,
  type Operation,
  type Snapshot,
} from "./model";

export function useChecklist(access: Access) {
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [status, setStatus] = React.useState<
    "loading" | "saved" | "saving" | "offline" | "unavailable"
  >("loading");
  const [error, setError] = React.useState("");
  const saving = React.useRef(false);
  const generation = React.useRef(0);
  const latestAccess = React.useRef(access);
  latestAccess.current = access;

  React.useEffect(() => {
    const session = ++generation.current;
    let reading = false;
    let loaded = false;
    setSnapshot(null);
    setStatus("loading");
    setError("");
    const refresh = async () => {
      if (reading || saving.current || document.visibilityState === "hidden")
        return;
      reading = true;
      try {
        const next = await api.read(access);
        if (generation.current !== session || saving.current) return;
        setSnapshot((old) =>
          !old || next.revision >= old.revision ? next : old,
        );
        setStatus("saved");
        if (!loaded) setError("");
        loaded = true;
        api.remember(latestAccess.current, next.document.title);
      } catch (error) {
        if (generation.current !== session) return;
        const denied =
          error instanceof ChecklistError && error.code === "access";
        setStatus(denied ? "unavailable" : "offline");
        if (denied || !loaded)
          setError(
            error instanceof Error
              ? error.message
              : "Não foi possível conectar.",
          );
      } finally {
        reading = false;
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      generation.current++;
      clearInterval(interval);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [access.id, access.token, access.demo]);

  async function save(operation: Operation): Promise<boolean> {
    if (saving.current) return false;
    const session = generation.current;
    saving.current = true;
    setStatus("saving");
    setError("");
    try {
      const next = await api.mutate(access, operation);
      if (generation.current !== session) return false;
      setSnapshot((old) =>
        !old || next.revision >= old.revision ? next : old,
      );
      setStatus("saved");
      api.remember(latestAccess.current, next.document.title);
      return true;
    } catch (error) {
      if (generation.current !== session) return false;
      setError(
        error instanceof ChecklistError &&
          error.code === "conflict" &&
          (operation.type === "move_task" || operation.type === "move_section")
          ? "A ordem dos itens mudou enquanto você arrastava. A lista foi atualizada; tente mover novamente."
          : error instanceof Error
            ? error.message
            : "Não foi possível salvar.",
      );
      if (error instanceof ChecklistError && error.code === "conflict") {
        try {
          const latest = await api.read(access);
          if (generation.current === session) {
            setSnapshot(latest);
            setStatus("saved");
          }
        } catch {
          setStatus("offline");
        }
      } else
        setStatus(
          error instanceof ChecklistError && error.code === "access"
            ? "unavailable"
            : error instanceof ChecklistError && error.code === "invalid"
              ? "saved"
              : "offline",
        );
      return false;
    } finally {
      saving.current = false;
    }
  }
  return { snapshot, status, error, save, clearError: () => setError("") };
}
