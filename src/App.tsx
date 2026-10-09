import React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronsDown,
  ChevronsUp,
  CircleCheck,
  ClipboardList,
  Copy,
  Link2,
  ListChecks,
  LoaderCircle,
  Moon,
  Pencil,
  Plus,
  Search,
  Share2,
  Shield,
  Sun,
  Trash2,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import * as api from "./api";
import {
  accessLink,
  newChecklist,
  parseAccess,
  uniqueId,
  type Access,
} from "./model";
import { Modal, Share } from "./components";
import { useChecklist } from "./useChecklist";
import { ChecklistSections } from "./ChecklistSections";
import { QuickAdd } from "./QuickAdd";
import { InlineEditor } from "./InlineActions";

function currentAccess(): Access | null {
  const parsed = parseAccess(window.location.hash);
  if (!parsed) return null;
  const old = api
    .recents()
    .find((item) => item.id === parsed.id && item.token === parsed.token);
  return { ...parsed, editToken: old?.editToken };
}

export default function App() {
  const [theme, setTheme] = React.useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("checklist-pro-theme", theme);
    } catch {
      // The toggle still works when browser storage is unavailable.
    }
  }, [theme]);
  const [access, setAccess] = React.useState<Access | null>(currentAccess);
  React.useEffect(() => {
    const change = () => setAccess(currentAccess());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  function open(next: Access) {
    window.location.hash = new URL(accessLink(next)).hash;
    setAccess(next);
  }
  function home() {
    window.history.pushState(null, "", window.location.pathname);
    setAccess(null);
  }
  // Keep browser back/forward navigation aligned with the current checklist.
  React.useEffect(() => {
    const change = () => setAccess(currentAccess());
    window.addEventListener("popstate", change);
    return () => window.removeEventListener("popstate", change);
  }, []);
  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <button className="brand" onClick={home}>
            <span className="brand-icon">
              <ListChecks size={23} />
            </span>
            <span>
              checklist<span className="brand-pro">pro</span>
            </span>
          </button>
          <div className="topbar-actions">
            <span className="topbar-note">
              <Users size={15} /> Organize juntos.
            </span>
            <button
              className="btn theme-toggle"
              aria-label={
                theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"
              }
              title={
                theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"
              }
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
            </button>
          </div>
        </div>
      </header>
      {!api.configured && (
        <div className="demo-banner">
          <span>Demonstração local</span> Seus dados ficam neste navegador.
          Configure o serviço para compartilhar com outras pessoas.
        </div>
      )}
      {access ? (
        <Board
          key={access.id + access.token}
          access={access}
          onHome={home}
          onOpen={open}
          onAccessChange={setAccess}
        />
      ) : (
        <Home onOpen={open} />
      )}
      <footer className="container footer">
        <span>Checklist Pro</span>
        <span>Um passo de cada vez. Todo mundo na mesma página.</span>
      </footer>
    </>
  );
}

function Home({ onOpen }: { onOpen: (access: Access) => void }) {
  const [title, setTitle] = React.useState("");
  const [example, setExample] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [recent, setRecent] = React.useState(api.recents);
  return (
    <main className="container home">
      <div className="home-grid">
        <section className="intro">
          <span className="eyebrow">
            <span className="live-dot" /> MENOS MENSAGENS. MAIS AÇÃO.
          </span>
          <h1>
            Uma lista.
            <br />
            Várias mãos.
            <br />
            <em>Tudo em ordem.</em>
          </h1>
          <p>
            Do próximo evento às tarefas da semana: crie um checklist, envie o
            link e acompanhe cada seção com sua equipe.
          </p>
          <div className="intro-features">
            <span>
              <Check size={16} /> Sem cadastro
            </span>
            <span>
              <Check size={16} /> Fácil no celular
            </span>
            <span>
              <Check size={16} /> Comentários por item
            </span>
          </div>
        </section>
        <section className="create-card">
          <div className="card-icon">
            <ClipboardList size={25} />
          </div>
          <h2>O que vamos organizar?</h2>
          <p className="muted">Dê um nome. O resto a gente resolve juntos.</p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              try {
                onOpen(
                  await api.create(
                    newChecklist(title, example),
                    !api.configured,
                  ),
                );
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Não foi possível criar.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field-label" htmlFor="checklist-title">
              Nome do checklist
            </label>
            <input
              id="checklist-title"
              placeholder="Ex.: Organização do evento"
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              disabled={busy}
            />
            <label className="example-option">
              <input
                type="checkbox"
                checked={example}
                onChange={(e) => setExample(e.target.checked)}
              />
              <span>
                Começar com alguns itens de exemplo
                <small>Você pode editar ou remover tudo depois.</small>
              </span>
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              className="btn primary create-button"
              disabled={busy || !title.trim()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Plus size={18} />
              )}
              {api.configured ? "Criar checklist" : "Experimentar checklist"}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="create-footnote">
            {api.configured
              ? "Compartilhe o link com quem vai participar. Sem e-mail, sem senha."
              : "Explore a interface. O compartilhamento fica disponível após configurar o Supabase."}
          </p>
        </section>
      </div>
      <section className="recent-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CONTINUE DE ONDE PAROU</span>
            <h2>Seus checklists recentes</h2>
          </div>
          <span className="muted small-text">Salvos neste navegador</span>
        </div>
        {recent.length ? (
          <div className="recent-grid">
            {recent.map((entry) => (
              <article className="recent-card" key={entry.id}>
                <button className="recent-open" onClick={() => onOpen(entry)}>
                  <span className="recent-icon">
                    <ListChecks size={23} />
                  </span>
                  <strong>{entry.title}</strong>
                  <span className="muted">
                    {entry.demo ? "Demonstração local" : "Abrir checklist"}
                    <ArrowRight size={15} />
                  </span>
                </button>
                <button
                  className="iconbtn forget"
                  title="Remover dos recentes"
                  aria-label={`Remover ${entry.title} dos recentes`}
                  onClick={() => {
                    api.forget(entry.id);
                    setRecent(api.recents());
                  }}
                >
                  <X size={15} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-home">
            <Link2 size={23} />
            <p>
              Seus próximos planos começam aqui.
              <br />
              <span>
                Crie um checklist ou abra um link que alguém compartilhou.
              </span>
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

function Board({
  access,
  onHome,
  onOpen,
  onAccessChange,
}: {
  access: Access;
  onHome: () => void;
  onOpen: (access: Access) => void;
  onAccessChange: (access: Access) => void;
}) {
  const { snapshot, status, error, save, clearError, undos, refreshNow } =
    useChecklist(access);
  const [closed, setClosed] = React.useState<string[]>([]);
  const [search, setSearch] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [priorityFilter, setPriorityFilter] = React.useState("all");
  const [editingTitle, setEditingTitle] = React.useState(false);
  const [share, setShare] = React.useState(false);
  const [manage, setManage] = React.useState(false);
  const [adminBusy, setAdminBusy] = React.useState(false);
  const [adminError, setAdminError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const newSectionRef = React.useRef<HTMLInputElement>(null);
  const addedSectionRef = React.useRef<string>("");
  const focusNewSection = () => {
    newSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    newSectionRef.current?.focus({ preventScroll: true });
  };
  const data = snapshot?.document;
  const busy = status === "saving" || adminBusy;
  const blocked = busy || status === "unavailable" || status === "loading";
  React.useEffect(() => {
    if (data) document.title = `${data.title} — Checklist Pro`;
    return () => {
      document.title = "Checklist Pro — organize juntos";
    };
  }, [data?.title]);
  async function rotateLink() {
    if (
      !window.confirm(
        "Gerar um novo link de edição? O link anterior deixará de funcionar para todos.",
      )
    )
      return;
    setAdminBusy(true);
    setAdminError("");
    try {
      const editToken = await api.rotate(access);
      const next = { ...access, editToken };
      api.remember(next, data!.title);
      onAccessChange(next);
      setNotice("Novo link criado. Compartilhe-o novamente com sua equipe.");
    } catch (error) {
      setAdminError((error as Error).message);
    } finally {
      setAdminBusy(false);
    }
  }
  if (!data)
    return (
      <main className="container loading-page">
        <button className="back-link" onClick={onHome}>
          <ArrowLeft size={16} /> Meus checklists
        </button>
        <div className="empty-home">
          {status === "loading" ? (
            <>
              <LoaderCircle size={26} className="spin" />
              <p>Preparando seu checklist…</p>
            </>
          ) : (
            <>
              <WifiOff size={28} />
              <h1>Não conseguimos abrir este checklist</h1>
              <p>
                {error ||
                  "Confira sua conexão e tente novamente. Se você acabou de configurar o serviço, confira também se o SQL foi aplicado."}
              </p>
              <button className="btn" onClick={() => window.location.reload()}>
                Tentar novamente
              </button>
            </>
          )}
        </div>
      </main>
    );
  const total = data.sections.reduce((sum, s) => sum + s.tasks.length, 0);
  const done = data.sections.reduce(
    (sum, s) => sum + s.tasks.filter((t) => t.done).length,
    0,
  );
  const percent = total ? Math.round((done / total) * 100) : 0;
  const filtered = data.sections
    .map((s) => ({
      ...s,
      visible: s.tasks.filter(
        (t) =>
          (!pending || !t.done) &&
          (priorityFilter === "all" ||
            (t.priority ?? "none") === priorityFilter) &&
          `${s.title} ${t.text} ${t.comment}`
            .toLocaleLowerCase("pt-BR")
            .includes(search.toLocaleLowerCase("pt-BR")),
      ),
    }))
    .filter(
      (s) =>
        (!pending && !search && priorityFilter === "all") || s.visible.length,
    );
  return (
    <main className="container board">
      <div className="board-breadcrumb">
        <button className="back-link" onClick={onHome}>
          <ArrowLeft size={16} /> Meus checklists
        </button>
        <span className={`sync-state ${status}`} role="status">
          {status === "saving" ? (
            <LoaderCircle size={14} className="spin" />
          ) : status === "offline" || status === "unavailable" ? (
            <WifiOff size={14} />
          ) : (
            <span className="live-dot" />
          )}
          {status === "saving"
            ? "Salvando…"
            : status === "offline"
              ? "Sem conexão • tentando reconectar"
              : status === "unavailable"
                ? "Acesso indisponível"
                : access.demo
                  ? "Salvo neste navegador"
                  : "Salvo • atualização automática"}
        </span>
      </div>
      <section className="board-hero">
        <div>
          <span className="eyebrow">
            {access.demo
              ? "SEU ESPAÇO DE DEMONSTRAÇÃO"
              : "UM CHECKLIST PARA FAZER JUNTOS"}
          </span>
          <div className="board-title">
            {editingTitle ? (
              <InlineEditor
                label="Nome do checklist"
                current={data.title}
                disabled={blocked}
                multiline={false}
                allowEmpty={false}
                limit={120}
                onClose={() => setEditingTitle(false)}
                onSave={(title, expected) =>
                  save({ type: "rename", title, expected })
                }
              />
            ) : (
              <h1>{data.title}</h1>
            )}
            <button
              className="iconbtn"
              aria-label="Renomear checklist"
              disabled={blocked}
              aria-expanded={editingTitle}
              onClick={() => {
                clearError();
                setEditingTitle((open) => !open);
              }}
            >
              <Pencil size={18} />
            </button>
          </div>
          <p>
            {total === 0
              ? "Comece criando uma seção. Depois, adicione seus itens."
              : done === total
                ? "Tudo concluído. Bom trabalho, equipe!"
                : `${total - done} ${total - done === 1 ? "item para concluir" : "itens para concluir"}. Cada passo faz a diferença.`}
          </p>
          <div className="hero-buttons">
            {!access.demo && (
              <button
                className="btn primary"
                onClick={() => {
                  setAdminError("");
                  setShare(true);
                }}
                disabled={status === "unavailable"}
              >
                <Share2 size={16} /> Compartilhar
              </button>
            )}
            <button
              className="btn"
              disabled={blocked}
              onClick={focusNewSection}
            >
              <Plus size={16} /> Nova seção
            </button>
            {snapshot.role === "admin" && (
              <button
                className="btn subtle"
                disabled={blocked}
                onClick={() => {
                  setAdminError("");
                  setManage(true);
                }}
              >
                <Shield size={16} /> Administração
              </button>
            )}
          </div>
        </div>
        <div className="progress-card">
          <div className="progress-label">
            <span>Progresso da equipe</span>
            <CircleCheck size={18} />
          </div>
          <strong>
            {percent}
            <span>%</span>
          </strong>
          <div className="progress-track">
            <div style={{ width: `${percent}%` }} />
          </div>
          <p>
            {done} de {total} itens concluídos
          </p>
        </div>
      </section>
      {access.demo && (
        <p className="notice">
          Esta é uma demonstração local: você pode experimentar as funções, mas
          este checklist não é compartilhado entre dispositivos.
        </p>
      )}
      {error && (
        <p className="error board-error" role="alert">
          {error}
          <button
            className="iconbtn"
            aria-label="Dispensar mensagem"
            onClick={clearError}
          >
            <X size={16} />
          </button>
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
          <button
            className="iconbtn"
            aria-label="Dispensar mensagem"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </p>
      )}
      <div className="board-toolbar">
        <label className="search">
          <Search size={18} />
          <input
            aria-label="Pesquisar itens"
            placeholder="Pesquisar itens…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          className="priority-filter"
          aria-label="Filtrar por prioridade"
          value={priorityFilter}
          onChange={(event) => setPriorityFilter(event.target.value)}
        >
          <option value="all">Todas as prioridades</option>
          <option value="high">Alta</option>
          <option value="medium">Média</option>
          <option value="low">Baixa</option>
          <option value="none">Sem prioridade</option>
        </select>
        <label className="pending-filter">
          <input
            type="checkbox"
            checked={pending}
            onChange={(e) => setPending(e.target.checked)}
          />{" "}
          Apenas pendentes
        </label>
        <div className="expand-controls">
          <button
            className="iconbtn"
            title="Expandir todas"
            aria-label="Expandir todas"
            disabled={!closed.length}
            onClick={() => setClosed([])}
          >
            <ChevronsDown size={18} />
          </button>
          <button
            className="iconbtn"
            title="Recolher todas"
            aria-label="Recolher todas"
            disabled={!data.sections.some((s) => !closed.includes(s.id))}
            onClick={() => setClosed(data.sections.map((s) => s.id))}
          >
            <ChevronsUp size={18} />
          </button>
        </div>
      </div>
      <ChecklistSections
        access={access}
        attachments={snapshot.attachments ?? []}
        onRefresh={refreshNow}
        document={data}
        sections={filtered}
        closed={closed}
        disabled={blocked}
        filtered={!!search || pending || priorityFilter !== "all"}
        onClosed={setClosed}
        onSave={save}
      />
      {undos.length > 0 && (
        <div className="undo-stack" aria-live="polite">
          {undos.map((undo) => (
            <div className="undo-toast" key={undo.id}>
              <span>{undo.label}</span>
              <button
                className="btn small"
                disabled={blocked}
                onClick={() => void save({ type: "restore", undoId: undo.id })}
              >
                Desfazer
              </button>
            </div>
          ))}
        </div>
      )}
      {!filtered.length && (
        <div className="empty-home">
          <CheckCheck size={30} />
          <h2>
            {data.sections.length
              ? "Nenhum item por aqui"
              : "Seu checklist está começando"}
          </h2>
          <p>
            {data.sections.length
              ? "Tente outra pesquisa ou desmarque Apenas pendentes."
              : "Organize os itens em seções, como Preparação, Execução e Encerramento."}
          </p>
          {!data.sections.length && (
            <button
              className="btn primary"
              disabled={blocked}
              onClick={focusNewSection}
            >
              <Plus size={16} /> Criar primeira seção
            </button>
          )}
        </div>
      )}
      <div className="new-section-row">
        <QuickAdd
          inputRef={newSectionRef}
          label="Nova seção"
          placeholder="Adicionar seção…"
          maxLength={120}
          disabled={blocked}
          onAdded={() => {
            const input = document.querySelector<HTMLInputElement>(
              `[data-section-id="${addedSectionRef.current}"] .quick-add input`,
            );
            if (input) {
              input.scrollIntoView({ block: "center" });
              input.focus({ preventScroll: true });
            } else newSectionRef.current?.focus();
          }}
          onAdd={async (title) => {
            const section = { id: uniqueId(), title, tasks: [] };
            const saved = await save({ type: "add_section", section });
            if (saved) {
              addedSectionRef.current = section.id;
              setSearch("");
              setPending(false);
              setPriorityFilter("all");
            }
            return saved;
          }}
        />
      </div>
      <div className="board-bottom">
        <p>
          <Link2 size={15} />{" "}
          {access.demo
            ? "Demonstração salva apenas neste navegador."
            : "Guarde seu link. Ele é a chave de acesso a este checklist."}
        </p>
        <button
          className="btn small"
          disabled={blocked}
          onClick={async () => {
            setAdminBusy(true);
            setAdminError("");
            try {
              onOpen(
                await api.create(
                  {
                    ...structuredClone(data),
                    title: `${data.title.slice(0, 110)} (cópia)`,
                  },
                  !!access.demo,
                ),
              );
            } catch (error) {
              setNotice((error as Error).message);
            } finally {
              setAdminBusy(false);
            }
          }}
        >
          <Copy size={15} /> Duplicar checklist
        </button>
      </div>
      {share && (
        <Share
          editLink={
            snapshot.role === "admin"
              ? access.editToken
                ? accessLink({ ...access, token: access.editToken })
                : undefined
              : accessLink(access)
          }
          adminLink={snapshot.role === "admin" ? accessLink(access) : undefined}
          onClose={() => setShare(false)}
          onGenerate={rotateLink}
          error={adminError}
          busy={adminBusy}
        />
      )}
      {manage && (
        <Modal
          title="Administração do checklist"
          busy={adminBusy}
          onClose={() => setManage(false)}
        >
          <p className="muted">
            Estas ações estão disponíveis apenas para quem possui o link de
            administração.
          </p>
          {!access.demo && (
            <div className="admin-option">
              <h3>Renovar acesso da equipe</h3>
              <p>
                Cria um novo link de edição. O anterior deixa de funcionar; seu
                link de administração é preservado.
              </p>
              <button className="btn" disabled={adminBusy} onClick={rotateLink}>
                <Link2 size={16} /> Gerar novo link
              </button>
            </div>
          )}
          <div className="admin-option">
            <h3>Excluir checklist</h3>
            <p>
              Remove o checklist inteiro e encerra o acesso de todos. Esta ação
              é definitiva.
            </p>
            <button
              className="btn destructive"
              disabled={adminBusy}
              onClick={async () => {
                setAdminBusy(true);
                setAdminError("");
                try {
                  await api.remove(access);
                  onHome();
                } catch (error) {
                  setAdminError((error as Error).message);
                } finally {
                  setAdminBusy(false);
                }
              }}
            >
              <Trash2 size={16} /> Excluir checklist
            </button>
          </div>
          {adminError && (
            <p className="error" role="alert">
              {adminError}
            </p>
          )}
        </Modal>
      )}
    </main>
  );
}
