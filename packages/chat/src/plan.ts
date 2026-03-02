import { parseMarkdown, toPlainText } from "./markdown";
import type {
  Adapter,
  AddTaskOptions,
  CompletePlanOptions,
  PlanContent,
  PlanMessage,
  PlanModel,
  PlanModelTask,
  PlanTask,
  StartPlanOptions,
  UpdateTaskInput,
} from "./types";

/**
 * Convert PlanContent to plain text for titles/labels.
 */
export function contentToPlainText(content: PlanContent | undefined): string {
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

interface PlanSession {
  messageId: string;
  plan: PlanModel;
  threadIdForEdits: string;
  updateChain: Promise<void>;
}

export class PlanMessageImpl implements PlanMessage {
  readonly id: string;
  readonly threadId: string;

  private readonly adapter: Adapter;
  private readonly supported: boolean;
  private readonly session: PlanSession;

  constructor(options: {
    adapter: Adapter;
    supported: boolean;
    threadId: string;
    messageId: string;
    threadIdForEdits: string;
    plan: PlanModel;
  }) {
    this.adapter = options.adapter;
    this.supported = options.supported;
    this.threadId = options.threadId;
    this.id = options.messageId;
    this.session = {
      messageId: options.messageId,
      threadIdForEdits: options.threadIdForEdits,
      plan: options.plan,
      updateChain: Promise.resolve(),
    };
  }

  title(): string {
    return this.session.plan.title;
  }

  tasks(): PlanTask[] {
    return this.session.plan.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
    }));
  }

  currentTask(): PlanTask | null {
    const current =
      [...this.session.plan.tasks]
        .reverse()
        .find((t) => t.status === "in_progress") ??
      this.session.plan.tasks.at(-1);
    if (!current) {
      return null;
    }
    return { id: current.id, title: current.title, status: current.status };
  }

  async reset(options: StartPlanOptions): Promise<PlanTask | null> {
    if (!this.supported) {
      return null;
    }

    const title = this.contentToText(options.initialMessage) || "Plan";
    const firstTask: PlanModelTask = {
      id: crypto.randomUUID(),
      title,
      status: "in_progress",
    };
    this.session.plan = { title, tasks: [firstTask] };
    await this.enqueueEdit();
    return {
      id: firstTask.id,
      title: firstTask.title,
      status: firstTask.status,
    };
  }

  async addTask(options: AddTaskOptions): Promise<PlanTask | null> {
    if (!this.supported) {
      return null;
    }
    const title = this.contentToText(options.title) || "Task";
    for (const task of this.session.plan.tasks) {
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
    this.session.plan.tasks.push(nextTask);
    this.session.plan.title = title;

    await this.enqueueEdit();
    return { id: nextTask.id, title: nextTask.title, status: nextTask.status };
  }

  async updateTask(update?: UpdateTaskInput): Promise<PlanTask | null> {
    if (!this.supported) {
      return null;
    }
    const current =
      [...this.session.plan.tasks]
        .reverse()
        .find((t) => t.status === "in_progress") ??
      this.session.plan.tasks.at(-1);

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

  async complete(options: CompletePlanOptions): Promise<void> {
    if (!this.supported) {
      return;
    }
    for (const task of this.session.plan.tasks) {
      if (task.status === "in_progress") {
        task.status = "complete";
      }
    }
    this.session.plan.title =
      this.contentToText(options.completeMessage) || this.session.plan.title;
    await this.enqueueEdit();
  }

  private contentToText(content: PlanContent | undefined): string {
    return contentToPlainText(content);
  }

  private enqueueEdit(): Promise<void> {
    const editPlan = this.adapter.editPlan;
    if (!editPlan) {
      return Promise.resolve();
    }
    const doEdit = async (): Promise<void> => {
      await editPlan.call(
        this.adapter,
        this.session.threadIdForEdits,
        this.session.messageId,
        this.session.plan
      );
    };
    const chained = this.session.updateChain.then(doEdit, doEdit);
    this.session.updateChain = chained.then(
      () => undefined,
      (err) => {
        console.warn("[PlanMessage] Failed to edit plan:", err);
      }
    );
    return chained;
  }
}
