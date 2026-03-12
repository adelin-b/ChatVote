import { NextRequest, NextResponse } from "next/server";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  "http://localhost:8080";

// Simple in-memory cache to avoid hammering the backend
let cachedEnabled: boolean | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10_000; // 10 seconds

async function getMaintenanceStatus(): Promise<boolean> {
  const now = Date.now();
  if (cachedEnabled !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedEnabled;
  }

  try {
    const res = await fetch(`${API_URL}/api/v1/maintenance`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      cachedEnabled = Boolean(data.enabled);
      cachedAt = now;
      return cachedEnabled;
    }
  } catch {
    // If the backend is unreachable, don't block the user
  }

  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip: static assets, Next.js internals, API routes, maintenance page itself
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/maintenance") ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|webp|gif|woff|woff2|ttf|otf|css|js|map)$/)
  ) {
    return NextResponse.next();
  }

  const enabled = await getMaintenanceStatus();

  if (enabled) {
    const url = request.nextUrl.clone();
    url.pathname = "/maintenance";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
