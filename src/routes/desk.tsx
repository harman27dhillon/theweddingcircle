import { createFileRoute } from "@tanstack/react-router";
import { DeskScreen } from "@/components/wedding/extra-screens";

export const Route = createFileRoute("/desk")({ component: DeskScreen });
