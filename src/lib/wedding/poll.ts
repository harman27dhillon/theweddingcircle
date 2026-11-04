/** Poll tally and visibility. Anonymous polls never leave this module with voter ids. */

export type PollResults = "immediate" | "after_vote" | "after_close";

export type PollVote = { optionId: string; memberKey: string };

export type PollInput = {
  id: string;
  postId: string;
  question: string;
  multiple: boolean;
  anonymous: boolean;
  changeVotes: boolean;
  addOptions: boolean;
  results: PollResults;
  expiresAt: number | null;
  createdAt: number;
  options: { id: string; label: string }[];
  votes: PollVote[];
};

export type PollView = {
  id: string;
  postId: string;
  question: string;
  multiple: boolean;
  anonymous: boolean;
  changeVotes: boolean;
  addOptions: boolean;
  results: PollResults;
  expiresAt: number | null;
  createdAt: number;
  closed: boolean;
  voted: boolean;
  voterCount: number | null;
  countsVisible: boolean;
  tie: boolean;
  options: { id: string; label: string; count: number | null; mine: boolean; leading: boolean }[];
};

export function pollClosed(poll: Pick<PollInput, "expiresAt">, now: number) {
  return poll.expiresAt != null && poll.expiresAt <= now;
}

export function presentPoll(poll: PollInput, memberKey: string, now: number): PollView {
  const closed = pollClosed(poll, now);
  const mine = new Set(poll.votes.filter((vote) => vote.memberKey === memberKey).map((vote) => vote.optionId));
  const voted = mine.size > 0;
  const countsVisible = poll.results === "immediate" || (poll.results === "after_vote" && (voted || closed)) || (poll.results === "after_close" && closed);
  const counts = new Map<string, number>();
  const voters = new Set<string>();
  for (const vote of poll.votes) {
    voters.add(vote.memberKey);
    counts.set(vote.optionId, (counts.get(vote.optionId) ?? 0) + 1);
  }
  const tallies = poll.options.map((option) => counts.get(option.id) ?? 0);
  const top = tallies.length ? Math.max(...tallies) : 0;
  const leaders = countsVisible && closed && top > 0 ? tallies.filter((count) => count === top).length : 0;
  return {
    id: poll.id,
    postId: poll.postId,
    question: poll.question,
    multiple: poll.multiple,
    anonymous: poll.anonymous,
    changeVotes: poll.changeVotes,
    addOptions: poll.addOptions && !closed,
    results: poll.results,
    expiresAt: poll.expiresAt,
    createdAt: poll.createdAt,
    closed,
    voted,
    voterCount: countsVisible ? voters.size : null,
    countsVisible,
    tie: leaders > 1,
    options: poll.options.map((option) => {
      const count = counts.get(option.id) ?? 0;
      return {
        id: option.id,
        label: option.label,
        count: countsVisible ? count : null,
        mine: mine.has(option.id),
        leading: countsVisible && closed && top > 0 && count === top,
      };
    }),
  };
}

export function voteAllowed(poll: PollInput, memberKey: string, optionIds: string[], now: number) {
  if (pollClosed(poll, now)) return "This poll is closed.";
  const known = new Set(poll.options.map((option) => option.id));
  if (!optionIds.length || optionIds.some((id) => !known.has(id))) return "Choose an option on this poll.";
  if (!poll.multiple && optionIds.length !== 1) return "This poll takes one choice.";
  if (new Set(optionIds).size !== optionIds.length) return "Choose each option once.";
  const previous = poll.votes.filter((vote) => vote.memberKey === memberKey).map((vote) => vote.optionId).sort();
  const next = [...optionIds].sort();
  if (!poll.changeVotes && previous.length && previous.join() !== next.join()) return "Votes on this poll cannot be changed.";
  return "";
}
