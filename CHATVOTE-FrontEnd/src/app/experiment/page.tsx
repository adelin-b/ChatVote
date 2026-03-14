import Link from "next/link";

import ExperimentPlayground from "@components/experiment/experiment-playground";
import IconSidebar from "@components/layout/icon-sidebar";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "ChatVote - Chunk Metadata Explorer",
};

export default function ExperimentPage() {
  return (
    <div className="bg-background text-foreground flex h-screen">
      <IconSidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <div className="mb-6 flex items-center gap-4">
            <Link
              href="/chat"
              className="border-border-subtle bg-surface hover:bg-border-subtle/30 flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors"
            >
              <ArrowLeft className="text-muted-foreground size-5" />
            </Link>
            <h1 className="text-2xl font-bold">Experiment</h1>
          </div>
          <ExperimentPlayground />
        </div>
      </div>
    </div>
  );
}
