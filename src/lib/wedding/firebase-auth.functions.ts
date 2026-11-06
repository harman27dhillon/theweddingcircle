import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Browser Firebase Auth config from the shared resolver. No service-account field is returned. */
export const firebaseAuthConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { publicFirebaseAuthConfig } = await import("@/lib/wedding/firebase-web.server");
  return publicFirebaseAuthConfig();
});

export const requestFirebaseVerificationEmail = createServerFn({ method: "POST" })
  .validator(z.object({ idToken: z.string().min(1).max(8192) }))
  .handler(async ({ data }) => {
    const { sendFirebaseVerificationEmail } = await import("@/lib/wedding/verification-email.server");
    return sendFirebaseVerificationEmail(data.idToken);
  });

export const redeemVerificationCode = createServerFn({ method: "POST" })
  .validator(z.object({ idToken: z.string().min(1).max(8192), code: z.string().regex(/^\d{6}$/) }))
  .handler(async ({ data }) => {
    const { redeemFirebaseVerificationCode } = await import("@/lib/wedding/verification-email.server");
    return redeemFirebaseVerificationCode(data.idToken, data.code);
  });
