import { createFileRoute } from "@tanstack/react-router";
import { CircleGate, JoinScreen } from "@/components/wedding/join-screen";
import { useCircle } from "@/lib/wedding/use-circle";

export const Route = createFileRoute("/join/$code")({
  component: JoinPage,
});

function JoinPage() {
  const { code } = Route.useParams();
  const { status, wedding, retry } = useCircle(code);
  if (status !== "ready" || !wedding) return <CircleGate status={status === "ready" ? "missing" : status} onRetry={retry} />;
  return <JoinScreen code={code} />;
}
