import { createFileRoute } from "@tanstack/react-router";
import { ChatThread } from "@/components/wedding/people-screen";

export const Route = createFileRoute("/w/$slug/chat/$chatId")({
  component: function ChatPage() {
    const { chatId } = Route.useParams();
    return <ChatThread chatId={chatId} />;
  },
});
