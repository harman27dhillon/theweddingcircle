import { getSql } from "@/lib/db";
import { guessOn, lockRoundOn, startRoundOn, submitLineOn, syncRoundOn, type PlayInput } from "./who-said.db.ts";

async function sql() {
  return getSql();
}

export async function startWhoSaid(input: PlayInput) {
  return startRoundOn(await sql(), input);
}

export async function submitWhoSaid(input: PlayInput) {
  return submitLineOn(await sql(), input);
}

export async function guessWhoSaid(input: PlayInput) {
  return guessOn(await sql(), input);
}

export async function lockWhoSaid(input: PlayInput) {
  return lockRoundOn(await sql(), input);
}

export async function syncWhoSaid(input: PlayInput) {
  return syncRoundOn(await sql(), input);
}
