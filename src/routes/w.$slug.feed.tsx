import { createFileRoute } from "@tanstack/react-router";
import { FeedScreen } from "@/components/wedding/feed-screen";

export const Route = createFileRoute("/w/$slug/feed")({ component: FeedScreen });
