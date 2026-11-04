import { createFileRoute } from "@tanstack/react-router";
import { PlacesScreen } from "@/components/wedding/plan-screen";

export const Route = createFileRoute("/w/$slug/places")({ component: PlacesScreen });
