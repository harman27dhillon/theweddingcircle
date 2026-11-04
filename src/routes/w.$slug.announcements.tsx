import { createFileRoute } from "@tanstack/react-router";
import { AnnouncementsScreen } from "@/components/wedding/plan-screen";

export const Route = createFileRoute("/w/$slug/announcements")({ component: AnnouncementsScreen });
