'use client';

import { useAiSdkFeaturesStore } from '@lib/stores/ai-sdk-features-store';
import {
  BarChart3,
  Database,
  Globe,
  MessageSquare,
  Search,
  Vote,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@lib/utils';

const ICON_MAP: Record<string, LucideIcon> = {
  Search,
  Database,
  Globe,
  BarChart3,
  Vote,
  MessageSquare,
};

export default function AiSdkFeatureRibbon() {
  const features = useAiSdkFeaturesStore((s) => s.features);
  const toggleFeature = useAiSdkFeaturesStore((s) => s.toggleFeature);

  return (
    <div className="border-b px-3 py-2 md:px-9">
      <div className="mx-auto flex max-w-3xl gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {features.map((feature) => {
          const Icon = ICON_MAP[feature.icon] ?? Search;
          return (
            <button
              key={feature.id}
              onClick={() => toggleFeature(feature.id)}
              title={feature.description}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                feature.enabled
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              <Icon className="size-3.5" />
              {feature.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
