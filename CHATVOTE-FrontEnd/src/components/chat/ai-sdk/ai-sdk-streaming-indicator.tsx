'use client';

export default function AiSdkStreamingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-2">
      <div className="bg-muted-foreground/40 size-2 animate-bounce rounded-full [animation-delay:-0.3s]" />
      <div className="bg-muted-foreground/40 size-2 animate-bounce rounded-full [animation-delay:-0.15s]" />
      <div className="bg-muted-foreground/40 size-2 animate-bounce rounded-full" />
    </div>
  );
}
