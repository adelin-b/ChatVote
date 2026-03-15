'use client';

import { useEffect, useState } from 'react';
import { type PartyDetails } from '@lib/party-details';
import Image from 'next/image';

type Props = {
  municipalityCode: string;
};

export default function AiSdkCandidateBar({ municipalityCode }: Props) {
  const [parties, setParties] = useState<PartyDetails[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchParties() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/candidates?municipalityCode=${encodeURIComponent(municipalityCode)}`,
        );
        if (!res.ok) return;
        const data: PartyDetails[] = await res.json();
        if (!cancelled) setParties(data);
      } catch {
        // silently ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchParties();
    return () => {
      cancelled = true;
    };
  }, [municipalityCode]);

  if (loading || parties.length === 0) return null;

  return (
    <div className="border-b bg-muted/40 px-3 py-2 md:px-9">
      <div className="mx-auto flex max-w-3xl items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="text-muted-foreground shrink-0 text-xs font-medium">
          Listes&nbsp;:
        </span>
        {parties.map((party) => (
          <div
            key={party.party_id}
            className="border-border text-muted-foreground flex shrink-0 items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs font-medium"
          >
            {party.logo_url && (
              <Image
                src={party.logo_url}
                alt=""
                width={16}
                height={16}
                className="size-4 rounded-full object-cover"
                unoptimized
              />
            )}
            {party.name}
          </div>
        ))}
      </div>
    </div>
  );
}
