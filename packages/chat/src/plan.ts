import { parseMarkdown, toPlainText } from "./markdown";
import type {
  Adapter,
  AddTaskOptions,
  CompletePlanOptions,
  PlanContent,
  PlanModel,
  PlanModelTask,
  PlanTask,
  PostableObject,
  PostableObjectContext,
  StartPlanOptions,
  UpdateTaskInput,
} from "./types";

/**
 * Convert PlanContent to plain text for titles/labels.
 */
function contentToPlainText(content: PlanContent | undefined): string {
  if (!content) {
    return "";
  }
  if (Array.isArray(content)) {
    return content.join(" ").trim();
  }
  if (typeof content === "string") {
    return content;
  }
  if ("markdown" in content) {
    return toPlainText(parseMarkdown(content.markdown));
  }
  if ("ast" in content) {
    return toPlainText(content.ast);
  }
  return "";
}

/** Symbol identifying Plan objects */
const POSTABLE_OBJECT = Symbol.for("chat.postable");

/**
 * Type guard to check if a value is a PostableObject.
 */
export function isPostableObject(value: unknown): value is PostableObject {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as PostableObject).$$typeof === POSTABLE_OBJECT
  );
}

interface BoundState {
  adapter: Adapter;
  messageId: string;
  threadId: string;
  updateChain: Promise<void>;
}

/**
 * A Plan represents a task list that can be posted to a thread.
 *
 * Create a plan with `new Plan({ initialMessage: "..." })` and post it with `thread.post(plan)`.
 * After posting, use methods like `addTask()`, `updateTask()`, and `complete()` to update it.
 *
 * @example
 * ```typescript
 * const plan = new Plan({ initialMessage: "Starting task..." });
 * await thread.post(plan);
 * await plan.addTask({ title: "Fetch data" });
 * await plan.updateTask("Got 42 results");
 * await plan.complete({ completeMessage: "Done!" });
 * ```
 */
export class Plan implements PostableObject {
  readonly $$typeof = POSTABLE_OBJECT;
  readonly kind = "plan";

  private _model: PlanModel;
  private _bound: BoundState | null = null;

  constructor(options: StartPlanOptions) {
    const title = contentToPlainText(options.initialMessage) || "Plan";
    const firstTask: PlanModelTask = {
      id: crypto.randomUUID(),
      title,
      status: "in_progress",
    };
    this._model = { title, tasks: [firstTask] };
  }

  isSupported(adapter: Adapter): boolean {
    return !!adapter.postObject && !!adapter.editObject;
  }
  getPostData(): PlanModel {
    return this._model;
  }

  onPosted(context: PostableObjectContext): void {
    this._bound = {
      adapter: context.adapter,
      messageId: context.messageId,
      threadId: context.threadId,
      updateChain: Promise.resolve(),
    };
  }

  get id(): string {
    return this._bound?.messageId ?? "";
  }
  get threadId(): string {
    return this._bound?.threadId ?? "";
  }
  get title(): string {
    return this._model.title;
  }
  get tasks(): readonly PlanTask[] {
    return this._model.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
    }));
  }
  get currentTask(): PlanTask | null {
    const current =
      [...this._model.tasks]
        .reverse()
        .find((t) => t.status === "in_progress") ?? this._model.tasks.at(-1);
    if (!current) {
      return null;
    }
    return { id: current.id, title: current.title, status: current.status };
  }

  async addTask(options: AddTaskOptions): Promise<PlanTask | null> {
    if (!this.canMutate()) {
      return null;
    }
    const title = contentToPlainText(options.title) || "Task";
    for (const task of this._model.tasks) {
      if (task.status === "in_progress") {
        task.status = "complete";
      }
    }
    const nextTask: PlanModelTask = {
      id: crypto.randomUUID(),
      title,
      status: "in_progress",
      details: options.children,
    };
    this._model.tasks.push(nextTask);
    this._model.title = title;

    await this.enqueueEdit();
    return { id: nextTask.id, title: nextTask.title, status: nextTask.status };
  }

  async updateTask(update?: UpdateTaskInput): Promise<PlanTask | null> {
    if (!this.canMutate()) {
      return null;
    }
    const current =
      [...this._model.tasks]
        .reverse()
        .find((t) => t.status === "in_progress") ?? this._model.tasks.at(-1);

    if (!current) {
      return null;
    }
    if (update !== undefined) {
      if (typeof update === "object" && update !== null && "output" in update) {
        if (update.output !== undefined) {
          current.output = update.output;
        }
        if (update.status) {
          current.status = update.status;
        }
      } else {
        current.output = update as PlanContent;
      }
    }
    await this.enqueueEdit();
    return { id: current.id, title: current.title, status: current.status };
  }

  async reset(options: StartPlanOptions): Promise<PlanTask | null> {
    if (!this.canMutate()) {
      return null;
    }

    const title = contentToPlainText(options.initialMessage) || "Plan";
    const firstTask: PlanModelTask = {
      id: crypto.randomUUID(),
      title,
      status: "in_progress",
    };
    this._model = { title, tasks: [firstTask] };

    await this.enqueueEdit();
    return {
      id: firstTask.id,
      title: firstTask.title,
      status: firstTask.status,
    };
  }

  async complete(options: CompletePlanOptions): Promise<void> {
    if (!this.canMutate()) {
      return;
    }
    for (const task of this._model.tasks) {
      if (task.status === "in_progress") {
        task.status = "complete";
      }
    }
    this._model.title =
      contentToPlainText(options.completeMessage) || this._model.title;
    await this.enqueueEdit();
  }

  private canMutate(): boolean {
    return !!(this._bound && this.isSupported(this._bound.adapter));
  }

  private enqueueEdit(): Promise<void> {
    if (!this._bound) {
      return Promise.resolve();
    }
    const editObject = this._bound.adapter.editObject;
    if (!editObject) {
      return Promise.resolve();
    }
    const bound = this._bound;
    const doEdit = async (): Promise<void> => {
      await editObject.call(
        bound.adapter,
        bound.threadId,
        bound.messageId,
        this.kind,
        this._model
      );
    };
    const chained = bound.updateChain.then(doEdit, doEdit);
    bound.updateChain = chained.then(
      () => undefined,
      (err) => {
        console.warn("[Plan] Failed to edit plan:", err);
      }
    );
    return chained;
  }
}
