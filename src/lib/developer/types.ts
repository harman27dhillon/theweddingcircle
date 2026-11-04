export type ProposalHunk = { path: string; old: string; new: string };

export type ProposalView = {
  id: string;
  command: string;
  level: "green" | "yellow" | "red";
  kind: string;
  summary: string;
  reason: string;
  sideEffects: string;
  risk: string;
  hunks: ProposalHunk[];
  status: string;
  validation: string;
  needsConfirmation: boolean;
};
