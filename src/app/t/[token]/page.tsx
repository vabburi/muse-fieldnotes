import type { Metadata } from "next";
import { Suspense } from "react";

import { TechAnswers } from "./tech-answers";

export const metadata: Metadata = { title: "Questions about your job", robots: { index: false } };

// The technician's page: the questions the agent has about one job, answered from a phone.
export default function TechPage({ params }: PageProps<"/t/[token]">) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading…</p>}>
      <Tech params={params} />
    </Suspense>
  );
}

async function Tech({ params }: { params: PageProps<"/t/[token]">["params"] }) {
  const { token } = await params;
  return <TechAnswers token={token} />;
}
