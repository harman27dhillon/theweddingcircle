import { weddingDataSql } from "@/lib/developer/core-route.server";
import { deleteWhisperOn, listWhispersOn, revealWhisperOn, sendWhisperOn } from "./whisper.db";

export async function listWhispersFor(input: { slug: string; memberKey: string; editKey: string; name: string }) {
  return listWhispersOn(await weddingDataSql(), input);
}

export async function sendWhisperFor(input: { slug: string; memberKey: string; editKey: string; name: string; parentPostId: string; recipientKey: string; body: string; replyTo?: string }) {
  return sendWhisperOn(await weddingDataSql(), input);
}

export async function revealWhisperFor(input: { slug: string; memberKey: string; editKey: string; name: string; whisperId: string }) {
  return revealWhisperOn(await weddingDataSql(), input);
}

export async function deleteWhisperFor(input: { slug: string; memberKey: string; editKey: string; name: string; whisperId: string }) {
  return deleteWhisperOn(await weddingDataSql(), input);
}
