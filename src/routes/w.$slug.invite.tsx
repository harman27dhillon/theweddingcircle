import { createFileRoute } from "@tanstack/react-router";
import { InviteScreen } from "@/components/wedding/plan-screen";

export const Route = createFileRoute("/w/$slug/invite")({ component: InviteScreen });
