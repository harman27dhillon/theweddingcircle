import { createServerFn } from "@tanstack/react-start";

/** Browser Firebase Auth config from the shared resolver. No service-account field is returned. */
export const firebaseAuthConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { publicFirebaseAuthConfig } = await import("@/lib/wedding/firebase-web.server");
  return publicFirebaseAuthConfig();
});
