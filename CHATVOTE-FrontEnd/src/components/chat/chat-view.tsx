import React, { Suspense } from "react";

import AiDisclaimer from "@components/legal/ai-disclaimer";
import LoadingSpinner from "@components/loading-spinner";
import { getAuth, getSystemStatus } from "@lib/firebase/firebase-server";
import { cn } from "@lib/utils";

import ChatSidebar from "./sidebar/chat-sidebar";
import ChatSidebarDesktop from "./sidebar/chat-sidebar-desktop";
import ChatContextSidebar from "./chat-context-sidebar";
import ChatDynamicChatInput from "./chat-dynamic-chat-input";
import ChatHeader from "./chat-header";
import ChatMainContent from "./chat-main-content";
import ChatScrollDownIndicator from "./chat-scroll-down-indicator";
import ChatViewSsr from "./chat-view-ssr";
import DevMetadataSidebarWrapper from "./dev-metadata-sidebar-wrapper";

type Props = {
  sessionId?: string;
  partyIds?: string[];
  initialQuestion?: string;
  municipalityCode?: string;
};

async function ChatView({
  sessionId,
  partyIds,
  initialQuestion,
  municipalityCode,
}: Props) {
  const [systemStatus, auth] = await Promise.all([
    getSystemStatus(),
    getAuth(),
  ]);

  return (
    <div className="relative flex size-full h-full items-stretch overflow-hidden">
      {/* Sidebar - full panel on desktop, overlay on mobile */}
      <ChatSidebar />
      <ChatSidebarDesktop auth={auth} />
      <ChatContextSidebar />
      <DevMetadataSidebarWrapper />
      <div className="relative flex w-full flex-col overflow-hidden">
        <ChatHeader />
        {/* Main content - adds padding when sidebar is expanded */}
        <ChatMainContent>
          <Suspense
            fallback={
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
                <LoadingSpinner />
                <p className="text-muted-foreground text-center text-sm">
                  Loading Chat Session...
                </p>
              </div>
            }
          >
            <ChatViewSsr
              chatId={sessionId}
              partyIds={partyIds}
              initialQuestion={initialQuestion}
              municipalityCode={municipalityCode}
            />
          </Suspense>
          <div
            className={cn(
              "from-background/50 absolute right-0 bottom-0 left-0 z-20 w-full bg-linear-to-t to-transparent transition-all",
              !sessionId && !municipalityCode && !partyIds?.length
                ? "h-1/3 backdrop-blur-xs dark:h-1/2"
                : "pointer-events-none h-0",
            )}
          />
          <div className="bg-background relative mx-auto w-full max-w-192 shrink-0 p-3 md:p-4">
            <ChatScrollDownIndicator />
            <ChatDynamicChatInput
              initialSystemStatus={systemStatus}
              hasValidServerUser={
                auth.session !== null && !auth.session.isAnonymous
              }
              municipalityCode={municipalityCode}
              sessionId={sessionId}
            />
            <AiDisclaimer />
          </div>
        </ChatMainContent>
      </div>
    </div>
  );
}

export default ChatView;
