import { createFileRoute } from "@tanstack/react-router";
import { CreateFlow } from "@/components/wedding/create-flow";

export const Route = createFileRoute("/create")({ component: CreateFlow });
