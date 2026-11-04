import { createFileRoute } from "@tanstack/react-router";
import { GuestsScreen } from "@/components/wedding/people-screen";

export const Route = createFileRoute("/w/$slug/guests")({ component: GuestsScreen });
