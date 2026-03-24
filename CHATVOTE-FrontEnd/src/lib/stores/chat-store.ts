import { DEFAULT_LLM_SIZE } from "@lib/firebase/firebase.types";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";

import { hydrateChatSession } from "./actions/hydrate-chat-session";
import { initializedChatSession } from "./actions/initialized-chat-session";
import { loadChatSession } from "./actions/load-chat-session";
import { newChat } from "./actions/new-chat";
import { setChatId } from "./actions/set-chat-id";
import { setChatSessionIsPublic } from "./actions/set-chat-session-is-public";
import { setInput } from "./actions/set-input";
import { setMessageFeedback } from "./actions/set-message-feedback";
import { setPartyIds } from "./actions/set-party-ids";
import { setPreSelectedParties } from "./actions/set-pre-selected-parties";
import {
  loadUserDemographics,
  setUserDemographic,
} from "./actions/user-demographics";
import { type ChatStore, type ChatStoreState } from "./chat-store.types";

export const SURVEY_BANNER_MIN_MESSAGE_COUNT = 8;

const defaultState: ChatStoreState = {
  userId: undefined,
  isAnonymous: true,
  chatId: undefined,
  localPreliminaryChatId: undefined,
  partyIds: new Set(),
  messages: [],
  input: "",
  loading: {
    general: false,
    chatSession: false,
    proConPerspective: undefined,
    newMessage: false,
    votingBehaviorSummary: undefined,
  },
  pendingStreamingMessageTimeoutHandler: {},
  error: undefined,
  initialQuestionError: undefined,
  currentQuickReplies: [],
  currentChatTitle: undefined,
  chatSessionIsPublic: false,
  preSelectedParties: undefined,
  currentStreamingMessages: undefined,
  currentStreamedVotingBehavior: undefined,
  clickedProConButton: undefined,
  clickedVotingBehaviorSummaryButton: undefined,
  tenant: undefined,
  scope: "national",
  municipalityCode: undefined,
  selectedElectoralLists: [],
  electoralListsData: [],
  locale: "fr",
  userDemographics: null,
  demographicsLoaded: false,
  debugLlmCalls: [],
  secondRoundPartyIds: null,
};

export function createChatStore(initialState?: Partial<ChatStore>) {
  return createStore<ChatStore>()(
    devtools(
      immer((set, get) => ({
        ...defaultState,
        ...initialState,
        setIsAnonymous: (isAnonymous: boolean) => set({ isAnonymous }),
        setLocale: (locale: string) => set({ locale }),
        setInput: setInput(get, set),
        addUserMessage: () => {},
        setChatId: setChatId(get, set),
        newChat: newChat(get, set),
        selectRespondingParties: () => {},
        loadChatSession: loadChatSession(get, set),
        hydrateChatSession: hydrateChatSession(get, set),
        generateProConPerspective: async () => {},
        generateCandidateProConPerspective: async () => {},
        completeCandidateProConPerspective: async () => {},
        setChatSessionIsPublic: setChatSessionIsPublic(get, set),
        setMessageFeedback: setMessageFeedback(get, set),
        setPreSelectedParties: setPreSelectedParties(get, set),
        initializedChatSession: initializedChatSession(get, set),
        streamingMessageSourcesReady: () => {},
        mergeStreamingChunkPayloadForMessage: () => {},
        updateQuickRepliesAndTitleForCurrentStreamingMessage: async () => {},
        completeStreamingMessage: async () => {},
        cancelStreamingMessages: async () => {},
        startTimeoutForStreamingMessages: async () => {},
        completeProConPerspective: async () => {},
        generateVotingBehaviorSummary: () => {},
        addVotingBehaviorResult: async () => {},
        addVotingBehaviorSummaryChunk: async () => {},
        completeVotingBehavior: async () => {},
        setPartyIds: setPartyIds(get, set),
        setSelectedElectoralLists: (panelNumbers: number[]) =>
          set({ selectedElectoralLists: panelNumbers }),
        setElectoralListsData: (lists) => set({ electoralListsData: lists }),
        toggleElectoralList: (panelNumber: number) =>
          set((state) => {
            const idx = state.selectedElectoralLists.indexOf(panelNumber);
            if (idx >= 0) {
              state.selectedElectoralLists.splice(idx, 1);
            } else {
              state.selectedElectoralLists.push(panelNumber);
            }
          }),
        getLLMSize: () => get().tenant?.llm_size ?? DEFAULT_LLM_SIZE,
        resetStreamingMessage: () => {},
        setUserDemographic: setUserDemographic(get, set),
        loadUserDemographics: loadUserDemographics(get, set),
        addDebugLlmCall: (payload) =>
          set((state) => {
            state.debugLlmCalls.push(payload);
          }),
        clearDebugLlmCalls: () => set({ debugLlmCalls: [] }),
        setSecondRoundPartyIds: (ids) => set({ secondRoundPartyIds: ids }),
      })),
    ),
  );
}
