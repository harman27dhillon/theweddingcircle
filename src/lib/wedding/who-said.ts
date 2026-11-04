/** Pure rules for Who Said It. The server clock and these checks decide every phase. */

export const SUBMIT_MS = 60_000;
export const GUESS_MS = 120_000;
export const PROMPT_MAX = 80;
export const LINE_MAX = 200;

export type Phase = "submit" | "guess" | "revealed" | "empty";
export type ResultMark = "correct" | "wrong" | "missed";

export type Statement = {
  id: string;
  authorKey: string;
  authorName: string;
  text: string;
  order: number;
  token: string;
};

export type Guess = {
  statementId: string;
  guessKey: string;
};

export type Round = {
  id: string;
  slug: string;
  starterKey: string;
  starterName: string;
  prompt: string;
  phase: Phase;
  submitDeadline: number;
  guessDeadline: number;
  statements: Statement[];
  guesses: Guess[];
  scored: boolean;
  score: number;
};

export type PublicLine = {
  id: string;
  text: string;
  authorName?: string;
  guessName?: string;
  result?: ResultMark;
};

export type PublicRound = {
  id: string;
  slug: string;
  phase: Phase;
  prompt: string;
  starterName: string;
  youStarted: boolean;
  submitted: boolean;
  submitDeadline: number;
  guessDeadline: number;
  serverNow: number;
  lines: PublicLine[];
  authors: { token: string; name: string }[];
  picks: { statementId: string; token: string; name: string }[];
  score: number | null;
  scoreText: string;
};

export function cleanLine(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.replace(/[<>]/g, "").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function activePhase(phase: Phase) {
  return phase === "submit" || phase === "guess";
}

/** Same order for every reader. The seed is the round id, not the caller's clock. */
export function shuffle<T>(items: T[], seed: string): T[] {
  const copy = [...items];
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  const next = () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const swap = copy[i];
    copy[i] = copy[j]!;
    copy[j] = swap!;
  }
  return copy;
}

export function ordered(round: Round) {
  return [...round.statements].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function scoreOf(round: Round) {
  const authors = new Map(round.statements.map((item) => [item.id, item.authorKey]));
  let score = 0;
  for (const guess of round.guesses) {
    if (authors.get(guess.statementId) === guess.guessKey) score += 1;
  }
  return score;
}

export function resultOf(statement: Statement, guess: Guess | undefined): ResultMark {
  if (!guess) return "missed";
  return guess.guessKey === statement.authorKey ? "correct" : "wrong";
}

export function canLock(round: Round) {
  if (round.phase !== "guess" || round.statements.length === 0) return false;
  const picked = new Set(round.guesses.map((item) => item.statementId));
  return round.statements.every((item) => picked.has(item.id));
}

export function addStatement(round: Round, statement: Statement, now: number): { round: Round; error?: string } {
  if (round.phase !== "submit") return { round, error: "That round is no longer taking lines." };
  if (now >= round.submitDeadline) return { round, error: "The minute for lines has ended." };
  const text = cleanLine(statement.text, LINE_MAX);
  if (!text) return { round, error: "Write a short line first." };
  if (statement.authorKey === round.starterKey) {
    return { round, error: "The person who started this round does not send a line." };
  }
  if (round.statements.some((item) => item.authorKey === statement.authorKey)) {
    return { round, error: "You already sent a line for this round." };
  }
  return {
    round: {
      ...round,
      statements: [...round.statements, { ...statement, text, order: round.statements.length }],
    },
  };
}

export function assignGuess(round: Round, statementId: string, guessKey: string, actorKey: string, now: number): { round: Round; error?: string } {
  if (actorKey !== round.starterKey) return { round, error: "Only the person who started this round can guess." };
  if (round.phase !== "guess") return { round, error: "Guessing is closed." };
  if (now >= round.guessDeadline) return { round, error: "The two minutes for guessing have ended." };
  const statement = round.statements.find((item) => item.id === statementId);
  if (!statement) return { round, error: "That line is not in this round." };
  if (!round.statements.some((item) => item.authorKey === guessKey)) {
    return { round, error: "Choose someone who sent a line." };
  }
  const guesses = round.guesses.filter((item) => item.statementId !== statementId);
  guesses.push({ statementId, guessKey });
  return { round: { ...round, guesses } };
}

export function closeSubmit(round: Round, now: number): Round {
  if (round.phase !== "submit" || now < round.submitDeadline) return round;
  if (round.statements.length === 0) return { ...round, phase: "empty", scored: true, score: 0 };
  const shuffled = shuffle(round.statements, round.id).map((item, index) => ({ ...item, order: index }));
  return { ...round, phase: "guess", statements: shuffled, guessDeadline: now + GUESS_MS };
}

export function reveal(round: Round): Round {
  if (round.phase === "revealed" || round.phase === "empty") return round;
  return { ...round, phase: "revealed", scored: true, score: scoreOf(round) };
}

export function lockEarly(round: Round, actorKey: string): { round: Round; error?: string } {
  if (actorKey !== round.starterKey) return { round, error: "Only the person who started this round can lock it." };
  if (round.phase !== "guess") return { round, error: "This round is not open for guessing." };
  if (!canLock(round)) return { round, error: "Every line needs a guess before it can lock." };
  return { round: reveal(round) };
}

export function closeGuess(round: Round, now: number): Round {
  if (round.phase !== "guess" || now < round.guessDeadline) return round;
  return reveal(round);
}

export function advance(round: Round, now: number): Round {
  return closeGuess(closeSubmit(round, now), now);
}

export function scoreText(round: Round) {
  const total = round.statements.length;
  if (round.phase === "empty") return "Nobody sent a line.";
  if (round.phase !== "revealed") return "";
  return `${round.score} out of ${total} correct`;
}

export function toPublic(round: Round, viewerKey: string, now: number): PublicRound {
  const live = advance(round, now);
  const open = live.phase === "revealed" || live.phase === "empty";
  const youStarted = viewerKey === live.starterKey;
  const names = new Map(live.statements.map((item) => [item.authorKey, item.authorName]));
  const tokens = new Map(live.statements.map((item) => [item.authorKey, item.token]));
  const guesses = new Map(live.guesses.map((item) => [item.statementId, item]));
  const lines: PublicLine[] = ordered(live).map((item) => {
    if (!open) return { id: item.id, text: item.text };
    const guess = guesses.get(item.id);
    const result = live.phase === "revealed" ? resultOf(item, guess) : undefined;
    return {
      id: item.id,
      text: item.text,
      authorName: item.authorName,
      guessName: guess ? names.get(guess.guessKey) ?? "" : "",
      result,
    };
  });
  return {
    id: live.id,
    slug: live.slug,
    phase: live.phase,
    prompt: live.prompt,
    starterName: live.starterName,
    youStarted,
    submitted: live.statements.some((item) => item.authorKey === viewerKey),
    submitDeadline: live.submitDeadline,
    guessDeadline: live.guessDeadline,
    serverNow: now,
    lines: live.phase === "submit" ? [] : lines,
    authors: youStarted && live.phase === "guess"
      ? ordered(live)
          .map((item) => ({ token: item.token, name: item.authorName }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.token.localeCompare(b.token))
      : [],
    picks: youStarted && live.phase === "guess"
      ? live.guesses.flatMap((item) => {
          const token = tokens.get(item.guessKey);
          const name = names.get(item.guessKey);
          return token && name ? [{ statementId: item.statementId, token, name }] : [];
        })
      : [],
    score: live.phase === "revealed" ? live.score : null,
    scoreText: scoreText(live),
  };
}

export type GameCard = {
  roundId: string;
  phase: Phase;
  prompt: string;
  endsAt: number;
  lines: PublicLine[];
  scoreText: string;
};

export function cardFor(round: Round, now: number): { id: string; gameRev: number; text: string; gameCard: GameCard }[] {
  const live = advance(round, now);
  const invite = {
    id: `ws-${live.id}-invite`,
    gameRev: 1,
    text: `Who Said It?\n${live.prompt}\nOne minute to send one anonymous line.`,
    gameCard: {
      roundId: live.id,
      phase: "submit" as const,
      prompt: live.prompt,
      endsAt: live.submitDeadline,
      lines: [],
      scoreText: "",
    },
  };
  if (live.phase === "submit") return [invite];
  if (live.phase === "empty") {
    return [invite, {
      id: `ws-${live.id}-card`,
      gameRev: 2,
      text: `Who Said It?\n${live.prompt}\nNobody sent a line, so this round is closed.`,
      gameCard: { roundId: live.id, phase: "empty", prompt: live.prompt, endsAt: live.submitDeadline, lines: [], scoreText: "Nobody sent a line." },
    }];
  }
  const shown = toPublic(live, "", now);
  const numbered = shown.lines.map((line, index) => `${index + 1}. ${line.text}`).join("\n");
  if (live.phase === "guess") {
    return [invite, {
      id: `ws-${live.id}-card`,
      gameRev: 2,
      text: `Who Said It?\n${live.prompt}\n${numbered}`,
      gameCard: { roundId: live.id, phase: "guess", prompt: live.prompt, endsAt: live.guessDeadline, lines: shown.lines, scoreText: "" },
    }];
  }
  const detail = shown.lines.map((line, index) => {
    const mark = line.result === "correct" ? "Correct" : line.result === "wrong" ? "Incorrect" : "Not guessed";
    return `${index + 1}. ${line.text} — ${line.authorName}. Guess: ${line.guessName || "Not guessed"}. ${mark}.`;
  }).join("\n");
  return [invite, {
    id: `ws-${live.id}-card`,
    gameRev: 3,
    text: `Who Said It?\n${live.prompt}\n${detail}\n${shown.scoreText}`,
    gameCard: { roundId: live.id, phase: "revealed", prompt: live.prompt, endsAt: live.guessDeadline, lines: shown.lines, scoreText: shown.scoreText },
  }];
}

export function publicHasSecrets(view: PublicRound) {
  return JSON.stringify(view).includes("authorKey");
}


