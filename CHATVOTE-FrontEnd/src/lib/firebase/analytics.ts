import { getApp } from "firebase/app";
import { getAnalytics, isSupported, logEvent, type Analytics } from "firebase/analytics";

let analyticsInstance: Analytics | null = null;

export async function initAnalytics(): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    const supported = await isSupported();
    if (!supported) return;

    if (analyticsInstance) return;

    analyticsInstance = getAnalytics(getApp());

    captureUtmParams(analyticsInstance);
  } catch {
    // Analytics may fail in dev/emulator — silently ignore
  }
}

function captureUtmParams(analytics: Analytics): void {
  const SESSION_KEY = "utm_captured";
  if (sessionStorage.getItem(SESSION_KEY)) return;

  const params = new URLSearchParams(window.location.search);
  const utmSource = params.get("utm_source");
  const utmMedium = params.get("utm_medium");
  const utmCampaign = params.get("utm_campaign");

  if (utmSource ?? utmMedium ?? utmCampaign) {
    logEvent(analytics, "referral_source", {
      ...(utmSource ? { utm_source: utmSource } : {}),
      ...(utmMedium ? { utm_medium: utmMedium } : {}),
      ...(utmCampaign ? { utm_campaign: utmCampaign } : {}),
    });
  }

  sessionStorage.setItem(SESSION_KEY, "1");
}

export function trackEvent(
  name: string,
  params?: Record<string, string | number>,
): void {
  if (!analyticsInstance) return;
  logEvent(analyticsInstance, name, params);
}

export function trackPageView(pagePath: string, pageTitle: string): void {
  trackEvent("page_view", { page_path: pagePath, page_title: pageTitle });
}

export function trackChatSessionStart(params: {
  municipality_code?: string;
  party_ids?: string[];
  scope: string;
}): void {
  trackEvent("chat_session_start", {
    ...(params.municipality_code
      ? { municipality_code: params.municipality_code }
      : {}),
    ...(params.party_ids ? { party_ids: params.party_ids.join(",") } : {}),
    scope: params.scope,
  });
}

export function trackChatMessageSent(params: {
  session_id: string;
  message_length: number;
  has_demographics: boolean;
}): void {
  trackEvent("chat_message_sent", {
    session_id: params.session_id,
    message_length: params.message_length,
    has_demographics: params.has_demographics ? 1 : 0,
  });
}

export function trackDemographicAnswered(params: {
  field: string;
  value: string;
  message_number: number;
}): void {
  trackEvent("demographic_answered", {
    field: params.field,
    value: params.value,
    message_number: params.message_number,
  });
}

export function trackDemographicSkipped(params: {
  field: string;
  message_number: number;
}): void {
  trackEvent("demographic_skipped", {
    field: params.field,
    message_number: params.message_number,
  });
}

export function trackSuggestionClicked(params: {
  question_id: string;
}): void {
  trackEvent("suggestion_clicked", { question_id: params.question_id });
}

export function trackCommunePageView(params: {
  commune_code: string;
  commune_name: string;
}): void {
  trackEvent("commune_page_view", {
    commune_code: params.commune_code,
    commune_name: params.commune_name,
  });
}

export function trackElectoralListSelected(params: {
  panel_number: number;
  list_label: string;
}): void {
  trackEvent("electoral_list_selected", {
    panel_number: params.panel_number,
    list_label: params.list_label,
  });
}
