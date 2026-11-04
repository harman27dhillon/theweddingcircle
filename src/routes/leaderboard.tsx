import { createFileRoute } from "@tanstack/react-router";
import { LeaderboardScreen } from "@/components/wedding/leaderboard-screen";

export const Route = createFileRoute("/leaderboard")({ component: LeaderboardScreen });
