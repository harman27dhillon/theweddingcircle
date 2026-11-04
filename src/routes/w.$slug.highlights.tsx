import { createFileRoute } from "@tanstack/react-router";
import { HighlightsScreen } from "@/components/wedding/memory-screen";

export const Route = createFileRoute("/w/$slug/highlights")({ component: HighlightsScreen });
