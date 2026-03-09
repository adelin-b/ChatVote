import { doc, getDoc, getFirestore, setDoc, Timestamp } from "firebase/firestore";
import { initializeApp, getApps } from "firebase/app";
import { firebaseConfig } from "./firebase-config";

export type UserDemographics = {
  gender?: "female" | "male" | "other";
  age_range?: "18-25" | "26-35" | "36-50" | "51-65" | "65+";
  occupation?: "student" | "employee" | "self_employed" | "retired" | "job_seeker" | "other";
  concern_topics?: string[];
  updated_at?: Date;
};

function getDb() {
  const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  return getFirestore(app);
}

export async function getUserDemographics(userId: string): Promise<UserDemographics | null> {
  const db = getDb();
  const snapshot = await getDoc(doc(db, "users", userId, "profile", "demographics"));

  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data();

  return {
    gender: data.gender,
    age_range: data.age_range,
    occupation: data.occupation,
    concern_topics: data.concern_topics,
    updated_at: data.updated_at?.toDate?.() ?? undefined,
  } as UserDemographics;
}

export async function saveUserDemographic(
  userId: string,
  field: string,
  value: unknown,
): Promise<void> {
  const db = getDb();
  await setDoc(
    doc(db, "users", userId, "profile", "demographics"),
    {
      [field]: value,
      updated_at: Timestamp.now(),
    },
    { merge: true },
  );
}
