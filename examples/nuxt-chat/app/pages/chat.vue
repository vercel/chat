<script setup lang="ts">
import { type UIMessage, useChat } from "@chat-adapter/web/vue";
import { computed, nextTick, ref, watch } from "vue";

const chat = useChat({ api: "/api/chat", threadId: "demo" });

const input = ref("");
const scrollContainer = ref<HTMLDivElement | null>(null);

const busy = computed(
  () => chat.status === "submitted" || chat.status === "streaming"
);
const lastMessage = computed(() => chat.messages.at(-1));

function textOf(message: UIMessage): string {
  let text = "";
  for (const part of message.parts) {
    if (part.type === "text") {
      text += part.text;
    }
  }
  return text;
}

watch(
  () => [chat.messages.length, chat.status] as const,
  async () => {
    await nextTick();
    scrollContainer.value?.scrollTo({
      top: scrollContainer.value.scrollHeight,
      behavior: "smooth",
    });
  }
);

function onSubmit() {
  const text = input.value.trim();
  if (!text || busy.value) {
    return;
  }
  chat.sendMessage({ text });
  input.value = "";
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    onSubmit();
  }
}
</script>

<template>
  <main class="chat-page">
    <div ref="scrollContainer" aria-live="polite" class="chat-scroll">
      <div v-if="chat.messages.length === 0 && !busy" class="chat-empty">
        <p>What can I help you with?</p>
      </div>
      <template v-else>
        <div v-for="message in chat.messages" :key="message.id">
          <div v-if="message.role === 'user'" class="chat-bubble-user">
            {{ textOf(message) }}
          </div>
          <div v-else class="chat-bubble-assistant">
            {{ textOf(message)
            }}<span
              v-if="
                message === lastMessage &&
                chat.status === 'streaming' &&
                !textOf(message)
              "
              class="chat-cursor"
            />
          </div>
        </div>
        <div v-if="chat.status === 'submitted'" class="chat-thinking">
          Thinking...
        </div>
      </template>
    </div>

    <div v-if="chat.error" class="chat-error">{{ chat.error.message }}</div>

    <form class="chat-form" @submit.prevent="onSubmit">
      <textarea
        v-model="input"
        aria-label="Message"
        class="chat-input"
        :disabled="busy"
        :placeholder="
          chat.messages.length === 0 ? 'What can I help you with?' : 'Reply...'
        "
        rows="1"
        @keydown="onKeydown"
      />
      <div class="chat-actions">
        <button
          v-if="busy"
          class="chat-stop"
          type="button"
          @click="chat.stop()"
        >
          Stop
        </button>
        <button
          v-else
          class="chat-send"
          :disabled="!input.trim()"
          type="submit"
        >
          Send
        </button>
      </div>
    </form>
  </main>
</template>
