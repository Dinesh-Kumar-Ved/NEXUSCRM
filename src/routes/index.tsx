import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getUser();
    throw redirect({ to: data.user ? "/dashboard" : "/auth" });
  },
  head: () => ({
    meta: [
      { title: "NexusCRM · Client pipeline & multi-channel outreach" },
      {
        name: "description",
        content:
          "NexusCRM keeps clients, proposal status and every email, WhatsApp, SMS and call in one workspace.",
      },
      { property: "og:title", content: "NexusCRM · Client pipeline & outreach" },
      {
        property: "og:description",
        content: "Track proposals and reach clients by email, WhatsApp, SMS or phone.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
