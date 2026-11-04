import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max = 2000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export const developerPublicConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { publicConfig } = await import("@/lib/developer/console.server");
  return publicConfig();
});

export const developerUnlock = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { email?: unknown; password?: unknown };
    return { email: text(body?.email, 120), password: text(body?.password, 200) };
  })
  .handler(async ({ data }) => {
    const { unlockDeveloper } = await import("@/lib/developer/gate.server");
    return unlockDeveloper(data.email, data.password);
  });

export const developerLock = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { lockDeveloper } = await import("@/lib/developer/gate.server");
    return lockDeveloper(data.token);
  });

export const developerOverview = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { overview } = await import("@/lib/developer/console.server");
    return overview(data.token);
  });

export const developerCommand = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; command?: unknown };
    return { token: text(body?.token, 200), command: text(body?.command, 2000) };
  })
  .handler(async ({ data }) => {
    const { runCommand } = await import("@/lib/developer/console.server");
    return runCommand(data.token, data.command);
  });

export const developerRevise = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; id?: unknown; note?: unknown };
    return { token: text(body?.token, 200), id: text(body?.id, 80), note: text(body?.note, 2000) };
  })
  .handler(async ({ data }) => {
    const { reviseProposal } = await import("@/lib/developer/console.server");
    return reviseProposal(data.token, data.id, data.note);
  });

export const developerApprove = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; id?: unknown; confirmMigration?: unknown };
    return { token: text(body?.token, 200), id: text(body?.id, 80), confirmMigration: body?.confirmMigration === true };
  })
  .handler(async ({ data }) => {
    const { approveProposal } = await import("@/lib/developer/console.server");
    return approveProposal(data.token, data.id, data.confirmMigration);
  });

export const developerCancel = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; id?: unknown };
    return { token: text(body?.token, 200), id: text(body?.id, 80) };
  })
  .handler(async ({ data }) => {
    const { cancelProposal } = await import("@/lib/developer/console.server");
    return cancelProposal(data.token, data.id);
  });

export const developerRevert = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; id?: unknown };
    return { token: text(body?.token, 200), id: text(body?.id, 80) };
  })
  .handler(async ({ data }) => {
    const { revertProposal } = await import("@/lib/developer/console.server");
    return revertProposal(data.token, data.id);
  });

export const developerProposals = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { listProposals } = await import("@/lib/developer/console.server");
    return listProposals(data.token);
  });

export const developerAudit = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { listAudit } = await import("@/lib/developer/console.server");
    return listAudit(data.token);
  });

export const developerErrors = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { listErrors } = await import("@/lib/developer/console.server");
    return listErrors(data.token);
  });

export const developerAnalyze = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; id?: unknown };
    return { token: text(body?.token, 200), id: text(body?.id, 80) };
  })
  .handler(async ({ data }) => {
    const { analyzeError } = await import("@/lib/developer/console.server");
    return analyzeError(data.token, data.id);
  });

export const developerFlag = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; key?: unknown; enabled?: unknown };
    return { token: text(body?.token, 200), key: text(body?.key, 40), enabled: body?.enabled === true };
  })
  .handler(async ({ data }) => {
    const { setFlag } = await import("@/lib/developer/console.server");
    return setFlag(data.token, data.key, data.enabled);
  });

export const developerAnnouncement = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; text?: unknown };
    return { token: text(body?.token, 200), text: text(body?.text, 280) };
  })
  .handler(async ({ data }) => {
    const { setAnnouncement } = await import("@/lib/developer/console.server");
    return setAnnouncement(data.token, data.text);
  });

export const developerSaveCardDisplay = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; landing?: unknown; landingDesktop?: unknown; pinned?: unknown; pinnedFull?: unknown; pinnedBar?: unknown };
    return {
      token: text(body?.token, 200),
      landing: text(body?.landing, 40),
      landingDesktop: text(body?.landingDesktop, 40),
      pinned: text(body?.pinned, 40),
      pinnedFull: body?.pinnedFull === true,
      ...(typeof body?.pinnedBar === "string" ? { pinnedBar: text(body.pinnedBar, 40) } : {}),
    };
  })
  .handler(async ({ data }) => {
    const { setCardDisplay } = await import("@/lib/developer/console.server");
    return setCardDisplay(data.token, data);
  });

export const developerSaveSample = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; bride?: unknown; groom?: unknown; date?: unknown; city?: unknown; place?: unknown; cover?: unknown };
    return {
      token: text(body?.token, 200),
      bride: text(body?.bride, 80),
      groom: text(body?.groom, 80),
      date: text(body?.date, 20),
      city: text(body?.city, 80),
      place: text(body?.place, 80),
      cover: text(body?.cover, 500_000),
    };
  })
  .handler(async ({ data }) => {
    const { setSampleShowcase } = await import("@/lib/developer/console.server");
    return setSampleShowcase(data.token, data);
  });

export const developerDatabase = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { databaseReport } = await import("@/lib/developer/console.server");
    return databaseReport(data.token);
  });

export const developerWeddings = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { weddingReport } = await import("@/lib/developer/console.server");
    return weddingReport(data.token);
  });

export const developerSuspendWedding = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; slug?: unknown; paused?: unknown; confirm?: unknown };
    return {
      token: text(body?.token, 200),
      slug: text(body?.slug, 80),
      paused: body?.paused === true,
      confirm: body?.confirm === true,
    };
  })
  .handler(async ({ data }) => {
    const { suspendWedding } = await import("@/lib/developer/console.server");
    return suspendWedding(data.token, data.slug, data.paused, data.confirm);
  });

export const developerUsers = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { userReport } = await import("@/lib/developer/console.server");
    return userReport(data.token);
  });

export const developerPictures = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { pictureReport } = await import("@/lib/developer/console.server");
    return pictureReport(data.token);
  });

export const developerUploadPicture = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; slug?: unknown; mime?: unknown; data?: unknown };
    return {
      token: text(body?.token, 200),
      slug: text(body?.slug, 80),
      mime: text(body?.mime, 40),
      data: text(body?.data, 900_000),
    };
  })
  .handler(async ({ data }) => {
    const { uploadWeddingPicture } = await import("@/lib/developer/console.server");
    return uploadWeddingPicture(data.token, data.slug, data.mime, data.data);
  });

export const developerRemovePicture = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; slug?: unknown; id?: unknown; confirm?: unknown };
    return {
      token: text(body?.token, 200),
      slug: text(body?.slug, 80),
      id: text(body?.id, 80),
      confirm: body?.confirm === true,
    };
  })
  .handler(async ({ data }) => {
    const { removeWeddingPicture } = await import("@/lib/developer/console.server");
    return removeWeddingPicture(data.token, data.slug, data.id, data.confirm);
  });

export const developerDiagnose = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { diagnose } = await import("@/lib/developer/console.server");
    return diagnose(data.token);
  });

export const developerBuild = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { runBuild } = await import("@/lib/developer/console.server");
    return runBuild(data.token);
  });

export const developerConnections = createServerFn({ method: "GET" }).handler(async () => {
  const { connections } = await import("@/lib/developer/console.server");
  return connections();
});

export const reportAppError = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { source?: unknown; message?: unknown };
    return { source: text(body?.source, 40), message: text(body?.message, 500) };
  })
  .handler(async ({ data }) => {
    const { noteAppError } = await import("@/lib/developer/console.server");
    return noteAppError(data.source, data.message);
  });
