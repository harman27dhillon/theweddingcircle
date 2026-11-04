import { createFileRoute } from "@tanstack/react-router";
import { SettingsScreen } from "@/components/wedding/plan-screen";

export const Route = createFileRoute("/w/$slug/settings")({ component: SettingsScreen });
