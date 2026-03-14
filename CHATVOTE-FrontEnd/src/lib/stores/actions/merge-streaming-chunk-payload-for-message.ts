import { chatViewScrollToBottom, isNearBottom } from "@lib/scroll-utils";
import { type ChatStoreActionHandlerFor } from "@lib/stores/chat-store.types";
import { generateUuid } from "@lib/utils";

export const mergeStreamingChunkPayloadForMessage: ChatStoreActionHandlerFor<
  "mergeStreamingChunkPayloadForMessage"
> = (get, set) => (sessionId, partyId, chunkPayload) => {
  const wasNearBottom = isNearBottom();

  set((state) => {
    if (!state.currentStreamingMessages) return;
    if (state.chatId !== sessionId) return;

    const currentStreamingMessage =
      state.currentStreamingMessages?.messages[partyId];

    if (!currentStreamingMessage) {
      state.currentStreamingMessages.messages[partyId] = {
        party_id: partyId,
        content: chunkPayload.chunk_content,
        id: generateUuid(),
        role: "assistant",
        sources: [],
      };

      return;
    }

    state.currentStreamingMessages.messages[partyId].content =
      currentStreamingMessage.content
        ? currentStreamingMessage.content + chunkPayload.chunk_content
        : chunkPayload.chunk_content;
  });

  if (wasNearBottom) {
    chatViewScrollToBottom({ behavior: "instant" });
  }
};
