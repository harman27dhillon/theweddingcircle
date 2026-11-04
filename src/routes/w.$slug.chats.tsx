import { createFileRoute } from "@tanstack/react-router";
import { ChatsScreen } from "@/components/wedding/people-screen";

export const Route = createFileRoute("/w/$slug/chats")({ component: ChatsScreen });
