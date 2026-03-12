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
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      {/* Pulsing status dot */}
      <div className="mb-8 flex items-center gap-3">
        <span className="relative flex h-4 w-4">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
          <span className="relative inline-flex h-4 w-4 rounded-full bg-orange-500" />
        </span>
        <span className="text-sm font-medium text-muted-foreground uppercase tracking-widest">
          Maintenance
        </span>
      </div>

      {/* Logo */}
      <div className="mb-6 text-5xl font-bold text-foreground tracking-tight">
        ChatVote
      </div>

      {/* Title */}
      <h1 className="mb-4 text-2xl font-semibold text-foreground text-center">
        Maintenance en cours
      </h1>

      {/* Message */}
      <p className="max-w-md text-center text-muted-foreground leading-relaxed">
        {message}
      </p>

      {/* Progress bar */}
      <div className="mt-10 w-64">
        <div className="mb-2 flex justify-between text-xs text-muted-foreground">
          <span>Prochaine vérification</span>
          <span>{countdown}s</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-1000"
            style={{ width: `${((30 - countdown) / 30) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
