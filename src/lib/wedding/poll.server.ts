import { weddingDataSql } from "@/lib/developer/core-route.server";
import { addPollOptionOn, createPollOn, listPollsOn, votePollOn } from "./poll.db";

export async function listPollsFor(input: { slug: string; memberKey: string; editKey: string; name: string }) {
  return listPollsOn(await weddingDataSql(), input);
}

export async function createPollFor(input: { slug: string; memberKey: string; editKey: string; name: string; question: string; options: string[]; multiple: boolean; anonymous: boolean; changeVotes: boolean; addOptions: boolean; results: string; expiresAt: string }) {
  return createPollOn(await weddingDataSql(), input);
}

export async function votePollFor(input: { slug: string; memberKey: string; editKey: string; name: string; pollId: string; optionIds: string[] }) {
  return votePollOn(await weddingDataSql(), input);
}

export async function addPollOptionFor(input: { slug: string; memberKey: string; editKey: string; name: string; pollId: string; label: string }) {
  return addPollOptionOn(await weddingDataSql(), input);
}
