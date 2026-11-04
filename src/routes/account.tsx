import { createFileRoute } from "@tanstack/react-router";
import { AccountScreen } from "@/components/wedding/extra-screens";

export const Route = createFileRoute("/account")({ component: AccountScreen });
