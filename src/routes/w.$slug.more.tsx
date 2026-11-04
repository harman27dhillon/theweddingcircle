import { createFileRoute } from "@tanstack/react-router";
import { MoreScreen } from "@/components/wedding/plan-screen";

export const Route = createFileRoute("/w/$slug/more")({ component: MoreScreen });
