import { createFileRoute } from "@tanstack/react-router";
import { InboxScreen } from "@/components/wedding/extra-screens";

export const Route = createFileRoute("/inbox")({ component: InboxScreen });
