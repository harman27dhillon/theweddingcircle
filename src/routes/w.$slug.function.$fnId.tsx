import { createFileRoute } from "@tanstack/react-router";
import { FunctionScreen } from "@/components/wedding/plan-screen";

export const Route = createFileRoute("/w/$slug/function/$fnId")({
  component: function FunctionPage() {
    const { fnId } = Route.useParams();
    return <FunctionScreen key={fnId} fnId={fnId} />;
  },
});
