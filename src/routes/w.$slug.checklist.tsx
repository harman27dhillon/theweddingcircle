import { createFileRoute } from "@tanstack/react-router";
import { ChecklistScreen } from "@/components/wedding/extra-screens";

export const Route = createFileRoute("/w/$slug/checklist")({ component: ChecklistScreen });
