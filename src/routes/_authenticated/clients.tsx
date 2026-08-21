import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/clients")({
  component: ClientsLayout,
});

function ClientsLayout() {
  return <Outlet />;
}
