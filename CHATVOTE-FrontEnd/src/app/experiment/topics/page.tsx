import Link from "next/link";

import TopicInsights from "@components/experiment/topic-insights";
import IconSidebar from "@components/layout/icon-sidebar";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "ChatVote - Topic Insights",
};

export default function TopicInsightsPage() {
  return (
    <div className="bg-background text-foreground flex h-screen">
      <IconSidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <div className="mb-6 flex items-center gap-4">
            <Link
              href="/"
              className="bg-surface flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/5"
            >
              <ArrowLeft className="text-muted-foreground size-5" />
            </Link>
            <h1 className="text-2xl font-bold">Topic Insights</h1>
          </div>
          <TopicInsights />
        </div>
      </div>
    </div>
  );
}
