import { createFileRoute } from "@tanstack/react-router";
import { DiscoverScreen } from "@/components/wedding/discover-screen";

export const Route = createFileRoute("/discover")({ component: DiscoverScreen });
