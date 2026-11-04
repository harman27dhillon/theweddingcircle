import { createFileRoute } from "@tanstack/react-router";
import { MemoriesScreen } from "@/components/wedding/memory-screen";

export const Route = createFileRoute("/w/$slug/memories")({ component: MemoriesScreen });
