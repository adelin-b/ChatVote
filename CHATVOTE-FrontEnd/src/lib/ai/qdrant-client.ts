import { QdrantClient } from "@qdrant/js-client-rest";

const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
const qdrantApiKey = process.env.QDRANT_API_KEY;

if (!process.env.QDRANT_URL) {
  console.warn(
    "[qdrant] QDRANT_URL not set — defaulting to http://localhost:6333",
  );
}

export const qdrantClient = new QdrantClient({
  url: qdrantUrl,
  apiKey: qdrantApiKey,
  timeout: 10000,
  // For HTTPS endpoints (Scaleway), disable gRPC and use port 443
  ...(qdrantUrl.startsWith("https") ? { port: 443 } : {}),
});

// Collection names — bare names resolve via Qdrant aliases (e.g. all_parties → all_parties_prod)
export const COLLECTIONS = {
  allParties: "all_parties",
  candidatesWebsites: "candidates_websites",
  votingBehavior: "justified_voting_behavior",
  parliamentaryQuestions: "parliamentary_questions",
} as const;
