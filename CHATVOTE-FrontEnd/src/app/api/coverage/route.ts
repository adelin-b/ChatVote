import { NextResponse } from "next/server";

import { db } from "@lib/firebase/firebase-admin";
import { type PartyDetails } from "@lib/party-details";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommuneCoverage = {
  code: string;
  name: string;
  list_count: number;
  question_count: number;
  chunk_count: number;
};

export type PartyCoverage = {
  party_id: string;
  name: string;
  short_name: string;
  chunk_count: number;
  has_manifesto: boolean;
};

export type CandidateCoverage = {
  candidate_id: string;
  name: string;
  commune_code: string;
  commune_name: string;
  has_website: boolean;
  has_manifesto: boolean;
  chunk_count: number;
  party_label: string;
};

export type CoverageSummary = {
  total_communes: number;
  total_parties: number;
  total_questions: number;
  total_chunks: number;
  total_candidates: number;
};

export type CoverageResponse = {
  communes: CommuneCoverage[];
  parties: PartyCoverage[];
  candidates: CandidateCoverage[];
  summary: CoverageSummary;
};

// ---------------------------------------------------------------------------
// Backend topic-stats (Qdrant chunk counts per namespace/party)
// ---------------------------------------------------------------------------

type TopicStatsResponse = {
  total_chunks: number;
  classified_chunks: number;
  themes: Array<{
    by_party: Record<string, number>;
  }>;
  collections: Record<string, { total: number; classified: number }>;
};

async function fetchTopicStats(): Promise<TopicStatsResponse | null> {
  const backendUrl =
    process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:8080";
  try {
    const res = await fetch(`${backendUrl}/api/v1/experiment/topic-stats`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<TopicStatsResponse>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Build per-party chunk counts from topic-stats by_party fields
// ---------------------------------------------------------------------------

function buildPartyChunkCounts(
  topicStats: TopicStatsResponse | null,
): Record<string, number> {
  if (!topicStats) return {};
  const counts: Record<string, number> = {};
  for (const theme of topicStats.themes) {
    for (const [party, count] of Object.entries(theme.by_party)) {
      counts[party] = (counts[party] ?? 0) + count;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    // Fetch all data in parallel
    const [partiesSnap, municipalitiesSnap, sessionsSnap, topicStats] =
      await Promise.all([
        db.collection("parties").get(),
        db.collection("municipalities").get(),
        db.collection("chat_sessions").get(),
        fetchTopicStats(),
      ]);

    // Build question counts per municipality code
    const questionsByCommune: Record<string, number> = {};
    for (const doc of sessionsSnap.docs) {
      const data = doc.data();
      const code: string | null =
        data.municipality_code ?? data.commune_code ?? null;
      if (code) {
        questionsByCommune[code] = (questionsByCommune[code] ?? 0) + 1;
      }
    }

    // Build chunk counts per party (by party_id matched to namespace/party_name)
    const partyChunkCounts = buildPartyChunkCounts(topicStats);

    // Build parties list
    const parties: PartyCoverage[] = partiesSnap.docs.map((doc) => {
      const data = doc.data() as PartyDetails & { short_name?: string };
      const partyId = data.party_id ?? doc.id;
      const name = data.name ?? "";
      const shortName = data.short_name ?? name;

      // Match by party_id, short_name, or name (backend uses namespace = party_id usually)
      const chunkCount =
        partyChunkCounts[partyId] ??
        partyChunkCounts[shortName] ??
        partyChunkCounts[name] ??
        0;

      return {
        party_id: partyId,
        name: data.long_name ?? name,
        short_name: shortName,
        chunk_count: chunkCount,
        has_manifesto: Boolean(data.election_manifesto_url),
      };
    });

    parties.sort((a, b) => b.chunk_count - a.chunk_count);

    // Build communes list
    const communes: CommuneCoverage[] = municipalitiesSnap.docs.map((doc) => {
      const data = doc.data();
      const code: string = data.code ?? doc.id;
      return {
        code,
        name: data.name ?? code,
        list_count: data.list_count ?? 0,
        question_count: questionsByCommune[code] ?? 0,
        chunk_count: 0, // Qdrant doesn't index per-commune; placeholder for future use
      };
    });

    communes.sort((a, b) => b.question_count - a.question_count);

    // Fetch candidates with details
    let candidates: CandidateCoverage[] = [];
    let totalCandidates = 0;
    try {
      const candidatesSnap = await db.collection("candidates").get();
      totalCandidates = candidatesSnap.size;
      candidates = candidatesSnap.docs.map((doc) => {
        const data = doc.data();
        return {
          candidate_id: doc.id,
          name: [data.first_name, data.last_name].filter(Boolean).join(" ") || doc.id,
          commune_code: data.commune_code ?? data.municipality_code ?? "",
          commune_name: data.commune_name ?? data.municipality_name ?? "",
          has_website: Boolean(data.website_url || data.website),
          has_manifesto: Boolean(data.manifesto_url || data.election_manifesto_url),
          chunk_count: 0, // Will be populated from Qdrant if available
          party_label: data.list_label ?? data.nuance_label ?? data.party_name ?? "",
        };
      });
      candidates.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      // candidates collection may not exist
    }

    const summary: CoverageSummary = {
      total_communes: communes.length,
      total_parties: parties.length,
      total_questions: sessionsSnap.size,
      total_chunks: topicStats?.total_chunks ?? 0,
      total_candidates: totalCandidates,
    };

    const response: CoverageResponse = { communes, parties, candidates, summary };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[coverage] Error fetching coverage data:", error);
    return NextResponse.json(
      { error: "Failed to fetch coverage data" },
      { status: 500 },
    );
  }
}
