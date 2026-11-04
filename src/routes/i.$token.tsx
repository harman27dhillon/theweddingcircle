import { createFileRoute } from "@tanstack/react-router";
import { CeremonyInvitePage } from "@/components/wedding/ceremony-invite";

export const Route = createFileRoute("/i/$token")({
  component: InviteRoute,
});

function InviteRoute() {
  const { token } = Route.useParams();
  return <CeremonyInvitePage token={token} />;
}
