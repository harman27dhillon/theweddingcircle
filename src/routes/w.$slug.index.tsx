import { createFileRoute } from "@tanstack/react-router";
import { HomeScreen } from "@/components/wedding/home-screen";

export const Route = createFileRoute("/w/$slug/")({ component: HomeScreen });
