import type { StreamChunk } from "chat";

export const STREAM_BUFFER_SIZE = 256;
export const STREAM_SEGMENT_LIMIT = 11_500;
export const STREAM_CHUNK_LIMIT = 256;
export const STREAM_FENCE_RESERVE = 64;

type TaskChunk = Extract<StreamChunk, { type: "task_update" }>;
const FENCE_PATTERN = /^(`{3,}|~{3,})/;

export class Fence {
  private buffer = "";
  private value?: {
    marker: string;
    opening: string;
  };

  get closing(): string | undefined {
    return this.value ? `\n${this.value.marker}` : undefined;
  }

  get opening(): string | undefined {
    return this.value ? `${this.value.opening}\n` : undefined;
  }

  finish(): void {
    if (this.buffer) {
      this.track(this.buffer);
      this.buffer = "";
    }
  }

  push(text: string): void {
    const lines = `${this.buffer}${text}`.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      this.track(line);
    }
  }

  private track(line: string): void {
    const trimmed = line.trimStart();
    const match = FENCE_PATTERN.exec(trimmed);
    if (!match) {
      return;
    }

    const marker = match[1];
    if (!this.value) {
      this.value = {
        marker,
        opening: trimmed,
      };
    } else if (
      marker[0] === this.value.marker[0] &&
      marker.length >= this.value.marker.length
    ) {
      this.value = undefined;
    }
  }
}

export function splitText(text: string, limit: number): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let offset = 0;
  let remaining = Math.ceil(text.length / limit);

  while (offset < text.length) {
    const left = text.length - offset;
    if (left <= limit) {
      chunks.push(text.slice(offset));
      break;
    }

    const target = Math.min(limit, Math.ceil(left / Math.max(remaining, 1)));
    const minimum = Math.max(1, Math.floor(target * 0.75));
    let end = offset + target;
    const window = text.slice(offset, end);
    const boundary = Math.max(
      window.lastIndexOf("\n"),
      window.lastIndexOf(" ")
    );

    if (boundary >= minimum) {
      end = offset + boundary + 1;
    }

    const lastCode = text.charCodeAt(end - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
      end += end - offset === 1 ? 1 : -1;
    }

    chunks.push(text.slice(offset, end));
    offset = end;
    remaining = Math.max(1, remaining - 1);
  }

  return chunks;
}

export function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  let end = limit - 3;
  const lastCode = text.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    end -= 1;
  }
  return `${text.slice(0, end)}...`;
}

function taskId(id: string, index: number): string {
  if (index === 0) {
    return truncateText(id, STREAM_CHUNK_LIMIT);
  }
  const suffix = `:part:${index + 1}`;
  return `${truncateText(id, STREAM_CHUNK_LIMIT - suffix.length)}${suffix}`;
}

function taskTitle(title: string, index: number, total: number): string {
  if (total === 1) {
    return truncateText(title, STREAM_CHUNK_LIMIT);
  }
  const suffix = ` (${index + 1}/${total})`;
  return `${truncateText(title, STREAM_CHUNK_LIMIT - suffix.length)}${suffix}`;
}

export function splitTask(chunk: TaskChunk, previous: number): TaskChunk[] {
  const sources = (
    chunk as TaskChunk & {
      sources?: unknown;
    }
  ).sources;
  const details = chunk.details
    ? splitText(chunk.details, STREAM_CHUNK_LIMIT)
    : [];
  const output = chunk.output
    ? splitText(chunk.output, STREAM_CHUNK_LIMIT)
    : [];
  const total = Math.max(previous, details.length, output.length, 1);

  return Array.from({ length: total }, (_, index) => ({
    ...(details[index] ? { details: details[index] } : {}),
    id: taskId(chunk.id, index),
    ...(output[index] ? { output: output[index] } : {}),
    ...(index === 0 && sources !== undefined ? { sources } : {}),
    status: chunk.status,
    title: taskTitle(chunk.title, index, total),
    type: "task_update",
  }));
}
