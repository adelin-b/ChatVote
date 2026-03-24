import path from "path";

export async function waitForService(
  url: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url);
      if (resp.ok || resp.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Service at ${url} did not start within ${timeoutMs}ms`);
}

export async function seedEmulatorData(): Promise<void> {
  // Dynamic import returns { default: admin } in ESM context
  const adminModule = await import("firebase-admin");
  const admin = adminModule.default ?? adminModule;
  const fs = await import("fs");

  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8081";

  const apps = admin.apps ?? [];
  if (!apps.length) {
    admin.initializeApp({ projectId: "chat-vote-dev" });
  }

  const db = admin.firestore();

  // Seed parties from existing data
  const partiesPath = path.resolve(
    __dirname,
    "../../../CHATVOTE-BackEnd/firebase/firestore_data/dev/parties.json",
  );
  if (fs.existsSync(partiesPath)) {
    const parties = JSON.parse(fs.readFileSync(partiesPath, "utf-8"));

    // Handle both array and object formats
    type PartyRecord = Record<string, unknown> & {
      party_id?: string;
      id?: string;
    };
    const partyEntries: [string, PartyRecord][] = Array.isArray(parties)
      ? (parties as PartyRecord[]).map((p) => [
          String(p.party_id ?? p.id ?? ""),
          p,
        ])
      : (Object.entries(parties) as [string, PartyRecord][]);

    const batch = db.batch();
    for (const [id, data] of partyEntries) {
      batch.set(db.collection("parties").doc(id as string), data);
    }
    await batch.commit();
    console.info(`Seeded ${partyEntries.length} parties`);
  }

  // Seed system status
  await db
    .collection("system_status")
    .doc("llm_status")
    .set({ is_at_rate_limit: false });
  console.info("Seeded system status");

  // Clean up admin app to avoid conflicts with frontend firebase-admin
  await admin.app().delete();
  delete process.env.FIRESTORE_EMULATOR_HOST;
}
