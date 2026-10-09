import React from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  SlidersHorizontal,
  Pencil,
  Flag,
} from "lucide-react";
import {
  type Checklist,
  type Operation,
  type Section,
  type Task,
  type Access,
  type Attachment,
  uniqueId,
} from "./model";
import { QuickAdd } from "./QuickAdd";
import { InlineDelete, InlineEditor } from "./InlineActions";
import { ItemDetails, priorityLabels } from "./ItemDetails";

type DragItem =
  | { kind: "section"; sectionId: string }
  | { kind: "task"; sectionId: string; taskId: string };
const sectionKey = (id: string) => `section:${id}`;
const taskKey = (sectionId: string, taskId: string) =>
  `task:${JSON.stringify([sectionId, taskId])}`;
type VisibleSection = Section & { visible: Task[] };
type Props = {
  access: Access;
  attachments: Attachment[];
  onRefresh: () => Promise<void>;
  document: Checklist;
  sections: VisibleSection[];
  closed: string[];
  disabled: boolean;
  filtered: boolean;
  onClosed: React.Dispatch<React.SetStateAction<string[]>>;
  onSave: (operation: Operation) => Promise<boolean>;
};

export function ChecklistSections(props: Props) {
  const [active, setActive] = React.useState<DragItem | null>(null);
  const baseline = React.useRef<Checklist | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const collision: CollisionDetection = (args) => {
    const sectionDrag = args.active.data.current?.kind === "section";
    const candidates = args.droppableContainers.filter((container) =>
      sectionDrag
        ? container.data.current?.kind === "section"
        : ["task", "container"].includes(container.data.current?.kind),
    );
    const options = { ...args, droppableContainers: candidates };
    const hits = pointerWithin(options);
    if (hits.length) {
      const taskHit = hits.find(
        (hit) =>
          candidates.find((candidate) => candidate.id === hit.id)?.data.current
            ?.kind === "task",
      );
      return taskHit ? [taskHit] : hits;
    }
    return closestCenter(options);
  };
  const start = (event: DragStartEvent) => {
    baseline.current = structuredClone(props.document);
    setActive(event.active.data.current as DragItem);
  };
  async function end(event: DragEndEvent) {
    const drag = event.active.data.current as DragItem;
    const over = event.over?.data.current;
    const original = baseline.current;
    setActive(null);
    baseline.current = null;
    if (!original || !over || props.disabled || props.filtered) return;
    if (drag.kind === "section") {
      if (over.kind !== "section" || drag.sectionId === over.sectionId) return;
      const ids = original.sections.map((s) => s.id);
      const order = arrayMove(
        ids,
        ids.indexOf(drag.sectionId),
        ids.indexOf(over.sectionId),
      );
      await props.onSave({
        type: "move_section",
        sectionId: drag.sectionId,
        beforeId: order[order.indexOf(drag.sectionId) + 1] ?? null,
        expectedOrder: ids,
      });
      return;
    }
    const source = original.sections.find((s) => s.id === drag.sectionId);
    const target = original.sections.find((s) => s.id === over.sectionId);
    if (
      !source ||
      !target ||
      (over.kind === "task" && over.taskId === drag.taskId && source === target)
    )
      return;
    const ids = target.tasks.map((t) => t.id);
    let beforeId: string | null = null;
    if (over.kind === "task") {
      if (source === target) {
        const order = arrayMove(
          ids,
          ids.indexOf(drag.taskId),
          ids.indexOf(over.taskId),
        );
        beforeId = order[order.indexOf(drag.taskId) + 1] ?? null;
      } else {
        const rect = event.active.rect.current.translated;
        const below =
          rect &&
          event.over &&
          rect.top + rect.height / 2 >
            event.over.rect.top + event.over.rect.height / 2;
        beforeId = below
          ? (ids[ids.indexOf(over.taskId) + 1] ?? null)
          : over.taskId;
      }
    }
    if (
      source === target &&
      beforeId === null &&
      ids[ids.length - 1] === drag.taskId
    )
      return;
    const saved = await props.onSave({
      type: "move_task",
      sectionId: source.id,
      taskId: drag.taskId,
      toSectionId: target.id,
      beforeId,
      expectedSourceOrder: source.tasks.map((t) => t.id),
      expectedTargetOrder: ids,
    });
    if (saved) props.onClosed((old) => old.filter((id) => id !== target.id));
  }
  const activeSection = props.document.sections.find(
    (s) => s.id === active?.sectionId,
  );
  const label =
    active?.kind === "section"
      ? activeSection?.title
      : active?.kind === "task"
        ? activeSection?.tasks.find((t) => t.id === active.taskId)?.text
        : "";
  return (
    <>
      <p className="ordering-help">
        {props.filtered
          ? "Limpe a pesquisa e os filtros para arrastar os itens."
          : "Arraste pelo ícone de pontos para ordenar. Itens também podem mudar de seção."}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={start}
        onDragEnd={(event) => void end(event)}
        onDragCancel={() => {
          setActive(null);
          baseline.current = null;
        }}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Para mover, pressione Espaço. Use as setas e pressione Espaço para soltar, ou Escape para cancelar.",
          },
          announcements: {
            onDragStart: () => "Item selecionado para mover.",
            onDragOver: ({ over }) =>
              over ? "Nova posição disponível." : "Fora da área de destino.",
            onDragEnd: () => "Movimento encerrado.",
            onDragCancel: () => "Movimento cancelado.",
          },
        }}
      >
        <SortableContext
          items={props.sections.map((s) => sectionKey(s.id))}
          strategy={verticalListSortingStrategy}
        >
          <div className="sections">
            {props.sections.map((section) => (
              <SortableSection
                key={section.id}
                {...props}
                section={section}
                index={props.document.sections.findIndex(
                  (s) => s.id === section.id,
                )}
                dragging={active}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {active && (
            <div className={`drag-preview ${active.kind}`}>
              <GripVertical size={17} />
              <span>{label}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function SortableSection(
  props: Props & {
    section: VisibleSection;
    index: number;
    dragging: DragItem | null;
  },
) {
  const { section, index } = props;
  const [editing, setEditing] = React.useState(false);
  const disabled = props.disabled || props.filtered;
  const sortable = useSortable({
    id: sectionKey(section.id),
    data: { kind: "section", sectionId: section.id },
    disabled,
  });
  const drop = useDroppable({
    id: `container:${section.id}`,
    data: { kind: "container", sectionId: section.id },
    disabled: disabled || props.dragging?.kind === "section",
  });
  const isOpen = !props.closed.includes(section.id);
  const original = props.document.sections.find((s) => s.id === section.id)!;
  const highlight = drop.isOver && props.dragging?.kind === "task";
  return (
    <article
      ref={(node) => {
        sortable.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      data-section-id={section.id}
      className={`checklist-section ${sortable.isDragging ? "drag-source" : ""} ${highlight ? "drop-target" : ""}`}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
    >
      <div className="section-header">
        <button
          ref={sortable.setActivatorNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
          className="iconbtn drag-handle"
          aria-label={`Mover seção ${section.title}`}
          title="Arrastar seção"
          disabled={disabled}
        >
          <GripVertical size={17} />
        </button>
        <button
          className="section-toggle"
          aria-expanded={isOpen}
          onClick={() =>
            props.onClosed((old) =>
              isOpen
                ? [...old, section.id]
                : old.filter((id) => id !== section.id),
            )
          }
        >
          {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <span className="section-number">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h2>{section.title}</h2>
        </button>
        <div className="section-actions">
          <span className="section-count">
            {section.tasks.filter((t) => t.done).length}/{section.tasks.length}
          </span>
          <button
            className="iconbtn"
            aria-label={`Renomear seção ${section.title}`}
            disabled={props.disabled}
            aria-expanded={editing}
            onClick={() => setEditing((open) => !open)}
          >
            <Pencil size={15} />
          </button>
          <InlineDelete
            label={`seção ${section.title}`}
            disabled={props.disabled}
            snapshot={original}
            onDelete={(expected) =>
              props.onSave({
                type: "delete_section",
                sectionId: section.id,
                expected,
              })
            }
          />
        </div>
      </div>
      {editing && (
        <InlineEditor
          label="Nome da seção"
          current={section.title}
          disabled={props.disabled}
          multiline={false}
          allowEmpty={false}
          limit={120}
          onClose={() => setEditing(false)}
          onSave={(title, expected) =>
            props.onSave({
              type: "update_section",
              sectionId: section.id,
              title,
              expected,
            })
          }
        />
      )}
      {isOpen && (
        <div className="section-body">
          <SortableContext
            items={section.visible.map((t) => taskKey(section.id, t.id))}
            strategy={verticalListSortingStrategy}
          >
            {section.visible.map((task) => (
              <SortableTask
                key={task.id}
                {...props}
                section={original}
                task={task}
              />
            ))}
          </SortableContext>
          <QuickAdd
            label={`Novo item em ${section.title}`}
            placeholder="Adicionar item…"
            maxLength={2000}
            disabled={props.disabled}
            onAddMany={(values) =>
              props.onSave({
                type: "add_tasks",
                sectionId: section.id,
                tasks: values.map((text) => ({
                  id: uniqueId(),
                  text,
                  done: false,
                  comment: "",
                })),
              })
            }
            onAdd={(text) =>
              props.onSave({
                type: "add_task",
                sectionId: section.id,
                task: { id: uniqueId(), text, done: false, comment: "" },
              })
            }
          />
        </div>
      )}
      {!isOpen && highlight && (
        <p className="collapsed-drop-hint">
          Solte aqui para mover a item para esta seção.
        </p>
      )}
    </article>
  );
}

function SortableTask(props: Props & { section: Section; task: Task }) {
  const { task, section } = props;
  const [commentOpen, setCommentOpen] = React.useState(false);
  const [detailsBusy, setDetailsBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const files = props.attachments.filter(
    (file) => file.sectionId === section.id && file.taskId === task.id,
  );
  const sortable = useSortable({
    id: taskKey(section.id, task.id),
    data: { kind: "task", sectionId: section.id, taskId: task.id },
    disabled: props.disabled || props.filtered || detailsBusy,
  });
  return (
    <div
      ref={sortable.setNodeRef}
      data-task-id={task.id}
      className={`task ${task.done ? "finished" : ""} ${sortable.isDragging ? "drag-source" : ""} ${sortable.isOver ? "task-drop-target" : ""}`}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
    >
      <div className="task-row">
        <button
          ref={sortable.setActivatorNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
          className="iconbtn drag-handle task-drag-handle"
          aria-label={`Mover item: ${task.text}`}
          title="Arrastar item"
          disabled={props.disabled || props.filtered || detailsBusy}
        >
          <GripVertical size={16} />
        </button>
        {task.priority && task.priority !== "none" && (
          <span
            className={`priority-badge priority-${task.priority}`}
            role="img"
            aria-label={`Prioridade ${priorityLabels[task.priority].toLowerCase()}`}
            title={`Prioridade ${priorityLabels[task.priority]}`}
          >
            <Flag size={14} />
            <small>
              {task.priority === "high"
                ? "!"
                : task.priority === "medium"
                  ? "2"
                  : "1"}
            </small>
          </span>
        )}
        <label className="task-label">
          <input
            type="checkbox"
            checked={task.done}
            disabled={props.disabled || detailsBusy}
            onChange={(event) =>
              void props.onSave({
                type: "update_task",
                sectionId: section.id,
                taskId: task.id,
                patch: { done: event.target.checked },
                expected: { done: task.done },
              })
            }
          />
          <span className="custom-checkbox">
            <Check size={13} />
          </span>
          <span className="task-text">{task.text}</span>
        </label>
        <div className="task-actions">
          <button
            className={`iconbtn ${task.comment || files.length || (task.priority && task.priority !== "none") ? "with-comment" : ""}`}
            aria-label={`Detalhes do item: ${task.text}`}
            title="Comentário, prioridade e anexos"
            disabled={props.disabled || detailsBusy}
            aria-expanded={commentOpen}
            onClick={() => {
              setEditing(false);
              setCommentOpen((open) => !open);
            }}
          >
            <SlidersHorizontal size={16} />
            {(task.comment ||
              files.length > 0 ||
              (task.priority && task.priority !== "none")) && (
              <span className="comment-dot" />
            )}
          </button>
          <button
            className="iconbtn"
            aria-label={`Editar item: ${task.text}`}
            title="Editar item"
            aria-expanded={editing}
            disabled={props.disabled || detailsBusy}
            onClick={() => {
              setCommentOpen(false);
              setEditing((open) => !open);
            }}
          >
            <Pencil size={15} />
          </button>
          <InlineDelete
            label={`item: ${task.text}`}
            disabled={props.disabled || detailsBusy}
            snapshot={task}
            onDelete={(expected) =>
              props.onSave({
                type: "delete_task",
                sectionId: section.id,
                taskId: task.id,
                expected,
              })
            }
          />
        </div>
      </div>
      {editing && (
        <InlineEditor
          label="Descrição do item"
          current={task.text}
          disabled={props.disabled || detailsBusy}
          allowEmpty={false}
          limit={2000}
          onClose={() => setEditing(false)}
          onSave={(text, expected) =>
            props.onSave({
              type: "update_task",
              sectionId: section.id,
              taskId: task.id,
              patch: { text },
              expected: { text: expected },
            })
          }
        />
      )}
      {commentOpen && (
        <ItemDetails
          access={props.access}
          sectionId={section.id}
          task={task}
          files={files}
          onRefresh={props.onRefresh}
          onWorking={setDetailsBusy}
          disabled={props.disabled}
          onClose={() => setCommentOpen(false)}
          onSave={props.onSave}
        />
      )}
    </div>
  );
}
