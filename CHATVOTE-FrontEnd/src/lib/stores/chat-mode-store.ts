import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ChatMode = 'classic' | 'ai-sdk';

type ChatModeStore = {
  chatMode: ChatMode;
  setChatMode: (mode: ChatMode) => void;
  toggleChatMode: () => void;
};

export const useChatModeStore = create<ChatModeStore>()(
  persist(
    (set) => ({
      chatMode: 'classic',
      setChatMode: (mode) => set({ chatMode: mode }),
      toggleChatMode: () =>
        set((state) => ({
          chatMode: state.chatMode === 'classic' ? 'ai-sdk' : 'classic',
        })),
    }),
    {
      name: 'chat-mode',
    },
  ),
);
