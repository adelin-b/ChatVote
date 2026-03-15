import { NextRequest, NextResponse } from "next/server";

import { db } from "@lib/firebase/firebase-admin";
import { getPartiesById } from "@lib/firebase/firebase-server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const municipalityCode = searchParams.get("municipalityCode");

  if (!municipalityCode) {
    return NextResponse.json(
      { error: "municipalityCode query parameter is required" },
      { status: 400 },
    );
  }

  try {
    const candidatesSnap = await db
      .collection("candidates")
      .where("municipality_code", "==", municipalityCode)
      .get();

    const partyIds = [
      ...new Set(
        candidatesSnap.docs.flatMap(
          (doc) => (doc.data().party_ids as string[] | undefined) ?? [],
        ),
      ),
    ];

    if (partyIds.length === 0) {
      return NextResponse.json([]);
    }

    const parties = await getPartiesById(partyIds);

    const isDev = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

    return NextResponse.json(parties, {
      headers: {
        "Cache-Control": isDev
          ? "no-store"
          : "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("[candidates] Failed to fetch candidates:", error);
    return NextResponse.json(
      { error: "Failed to fetch candidates" },
      { status: 500 },
    );
  }
}
