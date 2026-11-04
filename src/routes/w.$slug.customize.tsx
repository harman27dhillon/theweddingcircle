import { createFileRoute } from "@tanstack/react-router";
import { CustomizeScreen } from "@/components/wedding/customize-screen";

export const Route = createFileRoute("/w/$slug/customize")({ component: CustomizeScreen });
