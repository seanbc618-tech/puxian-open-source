import { createFileRoute } from "@tanstack/react-router";
import { HomeApp } from "@/components/home-landing";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <HomeApp />;
}
