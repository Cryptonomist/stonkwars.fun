import type { Metadata } from "next";
import { Suspense } from "react";

import { CreateFight } from "./CreateFight";

export const metadata: Metadata = { title: "Pick a fight" };

export default function NewFightPage() {
  return (
    <Suspense>
      <CreateFight />
    </Suspense>
  );
}
