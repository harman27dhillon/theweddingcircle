import { createFileRoute } from "@tanstack/react-router";
import { PlannerScreen } from "@/components/wedding/plan-screen";

export const Route = createFileRoute("/w/$slug/planner")({ component: PlannerScreen });
