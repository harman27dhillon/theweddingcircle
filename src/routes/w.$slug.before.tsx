import { createFileRoute } from "@tanstack/react-router";
import { BeforeScreen } from "@/components/wedding/before-screen";

export const Route = createFileRoute("/w/$slug/before")({ component: BeforeScreen });
