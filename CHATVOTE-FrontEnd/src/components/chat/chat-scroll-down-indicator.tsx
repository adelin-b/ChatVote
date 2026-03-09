"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@components/ui/button";
import { SCROLL_CONTAINER_ID } from "@lib/scroll-constants";
import { chatViewScrollToBottom } from "@lib/scroll-utils";
import { cn } from "@lib/utils";
import { ArrowDownIcon } from "lucide-react";

import { useChatStore } from "../providers/chat-store-provider";

function ChatScrollDownIndicator() {
  const [isVisible, setIsVisible] = useState(false);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const isVisibleRef = useRef(false);

  const currentStreamingMessages = useChatStore(
    (state) => state.currentStreamingMessages,
  );

  // Track scroll position.
  // The scroll container may not exist on first render (Suspense boundary),
  // so we poll until it appears, then attach the listener.
  useEffect(() => {
    if (typeof document === "undefined") return;

    let scrollContainer: HTMLElement | null = null;

    const handleScroll = () => {
      if (!scrollContainer) return;
      const isScrolled =
        scrollContainer.scrollTop +
          scrollContainer.clientHeight -
          scrollContainer.scrollHeight <
        -100;
      isVisibleRef.current = isScrolled;
      setIsVisible(isScrolled);

      // Clear "new message" badge when user scrolls to bottom
      if (!isScrolled) {
        setHasNewMessage(false);
      }
    };

    const tryAttach = () => {
      scrollContainer = document.getElementById(SCROLL_CONTAINER_ID);
      if (!scrollContainer) return false;
      scrollContainer.addEventListener("scroll", handleScroll);
      return true;
    };

    if (!tryAttach()) {
      const interval = setInterval(() => {
        if (tryAttach()) clearInterval(interval);
      }, 200);
      return () => clearInterval(interval);
    }

    return () => {
      scrollContainer?.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Show "new message" when streaming arrives while scrolled up
  useEffect(() => {
    if (currentStreamingMessages && isVisibleRef.current) {
      setHasNewMessage(true);
    }
  }, [currentStreamingMessages]);

  const handleClick = useCallback(() => {
    chatViewScrollToBottom();
    setHasNewMessage(false);
  }, []);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-4 -top-10 flex items-center justify-end gap-2",
      )}
    >
      {hasNewMessage && isVisible && (
        <button
          onClick={handleClick}
          className="text-muted-foreground pointer-events-auto animate-in fade-in slide-in-from-bottom-1 cursor-pointer text-xs font-medium"
        >
          New message
        </button>
      )}
      <Button
        variant="default"
        className={cn(
          "bg-surface border-border hover:bg-muted size-8 rounded-full border shadow-xl",
          "z-40 transition-all duration-200 ease-in-out",
          "md:hover:-translate-y-1 md:hover:scale-110",
          isVisible
            ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
            : "pointer-events-none translate-y-2 scale-0 opacity-0",
        )}
        onClick={handleClick}
        size="icon"
      >
        <ArrowDownIcon className="text-muted-foreground size-4" />
      </Button>
    </div>
  );
}

export default ChatScrollDownIndicator;
