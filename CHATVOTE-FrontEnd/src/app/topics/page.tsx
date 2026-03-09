import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import IconSidebar from "@components/layout/icon-sidebar";
import TopicInsights from "@components/experiment/topic-insights";

export const metadata = {
  title: "ChatVote - Topic Insights",
};

export default function TopicInsightsPage() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <IconSidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
          <div className="mb-6 flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center justify-center size-10 rounded-full bg-surface hover:bg-white/5 transition-colors shrink-0"
            >
              <ArrowLeft className="size-5 text-muted-foreground" />
            </Link>
            <h1 className="text-2xl font-bold">Topic Insights</h1>
          </div>
          <TopicInsights />
        </div>
      </div>
    </div>
  );
}
