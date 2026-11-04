import { createFileRoute } from "@tanstack/react-router";
import { ServicesScreen } from "@/components/wedding/plan-screen";

export const Route = createFileRoute("/w/$slug/services")({ component: ServicesScreen });
