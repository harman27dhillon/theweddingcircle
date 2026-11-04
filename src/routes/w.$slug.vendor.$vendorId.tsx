import { createFileRoute } from "@tanstack/react-router";
import { VendorScreen } from "@/components/wedding/extra-screens";

export const Route = createFileRoute("/w/$slug/vendor/$vendorId")({
  component: function VendorPage() {
    const { vendorId } = Route.useParams();
    return <VendorScreen vendorId={vendorId} />;
  },
});
