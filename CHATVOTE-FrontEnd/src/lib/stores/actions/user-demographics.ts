import {
  getUserDemographics,
  saveUserDemographic,
  type UserDemographics,
} from "@lib/firebase/user-profile";
import { type ChatStoreActionHandlerFor } from "@lib/stores/chat-store.types";

export const setUserDemographic: ChatStoreActionHandlerFor<
  "setUserDemographic"
> = (get, set) => (field, value) => {
  const userId = get().userId;

  set((state) => {
    state.userDemographics = {
      ...state.userDemographics,
      [field]: value,
    } as UserDemographics;
  });

  if (userId) {
    saveUserDemographic(userId, field, value).catch((error) => {
      console.error("Failed to save user demographic:", error);
    });
  }
};

export const loadUserDemographics: ChatStoreActionHandlerFor<
  "loadUserDemographics"
> = (_get, set) => async (userId) => {
  try {
    const demographics = await getUserDemographics(userId);

    set((state) => {
      state.userDemographics = demographics;
      state.demographicsLoaded = true;
    });
  } catch (error) {
    console.error("Failed to load user demographics:", error);

    set((state) => {
      state.demographicsLoaded = true;
    });
  }
};
