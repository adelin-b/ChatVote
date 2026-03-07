"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type ElectoralList,
  type ElectoralListsByCommune,
} from "@lib/election/election.types";
import { cn } from "@lib/utils";
import { useTranslations } from "next-intl";

import { useChatStore } from "../providers/chat-store-provider";

type ElectoralListCardProps = {
  list: ElectoralList;
  isSelected?: boolean;
  onSelect: (list: ElectoralList) => void;
};

function ElectoralListCard({
  list,
  isSelected,
  onSelect,
}: ElectoralListCardProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-lg border p-3 text-center transition-all duration-200",
        "hover:border-primary/50 hover:bg-purple-100 dark:hover:bg-purple-900/30",
        isSelected
          ? "border-primary bg-purple-50 dark:bg-purple-900/40"
          : "border-border-subtle bg-surface",
      )}
      onClick={() => onSelect(list)}
    >
      <span className="text-xs text-muted-foreground">
        {list.head_first_name}
      </span>
      <span className="text-sm font-bold uppercase">
        {list.head_last_name}
      </span>
      {list.nuance_code && (
        <div className="mt-0.5 h-px w-8 bg-primary/40" />
      )}
      <span className="line-clamp-2 text-xs text-muted-foreground">
        {list.list_short_label}
      </span>
    </button>
  );
}

const ChatContextSidebar = () => {
  const t = useTranslations("chat.sidebar");
  const municipalityCode = useChatStore((s) => s.municipalityCode);
  const selectedElectoralLists = useChatStore(
    (s) => s.selectedElectoralLists,
  );
  const toggleElectoralList = useChatStore((s) => s.toggleElectoralList);
  const setElectoralListsData = useChatStore((s) => s.setElectoralListsData);
  const [data, setData] = useState<ElectoralListsByCommune | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!municipalityCode) {
      setData(null);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);

    fetch(`/api/electoral-lists?commune_code=${municipalityCode}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json() as Promise<ElectoralListsByCommune>;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setElectoralListsData(result.lists);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("Failed to fetch electoral lists:", err);
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [municipalityCode]);

  const handleSelectList = useCallback(
    (list: ElectoralList) => {
      toggleElectoralList(list.panel_number);
    },
    [toggleElectoralList],
  );

  if (!municipalityCode) return null;

  return (
    <div className="hidden w-72 flex-none flex-col border-r border-border-subtle bg-surface md:flex">
      <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase text-muted-foreground">
            {t("lists")}
          </span>
          {data && (
            <span className="text-xs text-muted-foreground">
              {data.commune_name} · {data.list_count} {t("lists")}
            </span>
          )}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {data && !isLoading && (
          <div className="grid grid-cols-2 gap-2">
            {data.lists.map((list) => (
              <ElectoralListCard
                key={list.panel_number}
                list={list}
                isSelected={selectedElectoralLists.includes(list.panel_number)}
                onSelect={handleSelectList}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatContextSidebar;
