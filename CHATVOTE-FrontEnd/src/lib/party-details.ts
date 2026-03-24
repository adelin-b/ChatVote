interface Party {
  party_id: string;
  name: string;
  long_name: string;
  description: string;
  website_url: string;
  candidate: string;
  election_manifesto_url: string;
  logo_url: string;
  candidate_image_url: string;
  background_color: string;
  is_small_party: boolean;
  is_already_in_parliament: boolean;
}

/** Extends backend Party model with frontend-only Firestore fields. */
export type PartyDetails = Party & {
  /** From Firestore only — not part of backend API response. */
  election_result_forecast_percent: number;
};
