import { createFileRoute } from "@tanstack/react-router";
import { Landing } from "@/components/wedding/landing";

export const Route = createFileRoute("/")({ component: Landing });
