import type { Metadata } from "next";

import { FightsBoard } from "./FightsBoard";

export const metadata: Metadata = { title: "Fights" };

export default function FightsPage() {
  return <FightsBoard />;
}
