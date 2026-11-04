import { createFileRoute } from "@tanstack/react-router";
import { DeveloperCenter } from "@/components/wedding/developer-center";

export const Route = createFileRoute("/developer")({ component: DeveloperCenter });
