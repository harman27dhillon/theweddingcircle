import { createFileRoute } from "@tanstack/react-router";
import { FunctionsScreen } from "@/components/wedding/plan-screen";

export const Route = createFileRoute("/w/$slug/functions")({ component: FunctionsScreen });
