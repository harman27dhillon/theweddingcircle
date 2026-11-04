import { createFileRoute } from "@tanstack/react-router";
import { LiveScreen } from "@/components/wedding/live-screen";

export const Route = createFileRoute("/w/$slug/live")({ component: LiveScreen });
