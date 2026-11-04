import { weddingDataSql } from "@/lib/developer/core-route.server";
import { askSeekOn, considerSeekSocial, shareSeekOn } from "./seek.db";

export async function askSeekMessage(input: { slug: string; memberKey: string; editKey: string; name: string; text: string; eventId: string }) {
  const sql = await weddingDataSql();
  return askSeekOn(sql, input);
}

export async function shareSeekMessage(input: { slug: string; memberKey: string; editKey: string; name: string; turnId: string }) {
  const sql = await weddingDataSql();
  return shareSeekOn(sql, input);
}

export async function noteSeekSocial(sql: Parameters<typeof considerSeekSocial>[0], slug: string, writer: { key: string; name: string; role: string }, post: { id?: string; text?: string; images?: string[]; author?: string } | null) {
  await considerSeekSocial(sql, slug, writer, post);
}
