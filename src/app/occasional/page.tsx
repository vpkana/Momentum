import type { Metadata } from "next";
import { OccasionalView } from "@/components/views/occasional-view";

export const metadata: Metadata = { title: "Bucket list" };

export default function OccasionalPage() {
  return <OccasionalView />;
}
