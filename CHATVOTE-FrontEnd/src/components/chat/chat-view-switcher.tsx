"use client";

import { AI_SDK_ENABLED } from "@lib/ai/feature-flags";
import { useChatModeStore } from "@lib/stores/chat-mode-store";
import { useAppContext } from "@components/providers/app-provider";

import AiSdkChatView from "./ai-sdk/ai-sdk-chat-view";

type Props = {
  sessionId?: string;
  municipalityCode?: string;
  children: React.ReactNode;
};

/**
 * Client-side switcher between Classic (Socket.IO) and AI SDK chat modes.
 * When AI SDK mode is active, renders AiSdkChatView instead of the classic view.
 * When Classic mode is active, renders children (the existing ChatViewSsr flow).
 */
export default function ChatViewSwitcher({ sessionId, municipalityCode, children }: Props) {
  const { chatMode } = useChatModeStore();
  const { locale } = useAppContext();

  if (AI_SDK_ENABLED && chatMode === "ai-sdk") {
    return <AiSdkChatView chatId={sessionId} locale={locale} municipalityCode={municipalityCode} />;
  }

  return <>{children}</>;
}
