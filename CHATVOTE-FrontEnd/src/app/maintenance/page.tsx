"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  "http://localhost:8080";

const DEFAULT_MESSAGE =
  "Notre service est temporairement indisponible. Nous travaillons à améliorer votre expérience. Veuillez réessayer dans quelques minutes.";

export default function MaintenancePage() {
  const router = useRouter();
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [countdown, setCountdown] = useState(30);

  // Poll every 30 seconds; if maintenance is off, redirect to home
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/maintenance`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          if (data.message) setMessage(data.message);
          if (!data.enabled) {
            router.replace("/");
            return;
          }
        }
      } catch {
        // ignore — backend may be unavailable during maintenance
      }
      setCountdown(30);
      timer = setTimeout(check, 30_000);
    };

    // First check immediately, then schedule
    check();

    return () => clearTimeout(timer);
  }, [router]);

  // Visual countdown
  useEffect(() => {
    const id = setInterval(
      () => setCountdown((c) => (c > 0 ? c - 1 : 30)),
      1_000,
    );
    return () => clearInterval(id);
  }, []);

  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center px-4">
      {/* Pulsing status dot */}
      <div className="mb-8 flex items-center gap-3">
        <span className="relative flex h-4 w-4">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
          <span className="relative inline-flex h-4 w-4 rounded-full bg-orange-500" />
        </span>
        <span className="text-muted-foreground text-sm font-medium tracking-widest uppercase">
          Maintenance
        </span>
      </div>

      {/* Logo */}
      <div className="text-foreground mb-6 text-5xl font-bold tracking-tight">
        ChatVote
      </div>

      {/* Title */}
      <h1 className="text-foreground mb-4 text-center text-2xl font-semibold">
        Maintenance en cours
      </h1>

      {/* Message */}
      <p className="text-muted-foreground max-w-md text-center leading-relaxed">
        {message}
      </p>

      {/* Progress bar */}
      <div className="mt-10 w-64">
        <div className="text-muted-foreground mb-2 flex justify-between text-xs">
          <span>Prochaine vérification</span>
          <span>{countdown}s</span>
        </div>
        <div className="bg-muted h-1 w-full overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-all duration-1000"
            style={{ width: `${((30 - countdown) / 30) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
