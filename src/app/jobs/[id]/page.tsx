import { notFound } from "next/navigation";
import { Suspense } from "react";

import { listJobIds, loadJob } from "@/lib/fixtures";

import { JobView } from "./job-view";

export async function generateStaticParams() {
  return (await listJobIds()).map((id) => ({ id }));
}

// Reading the job id waits on the URL, so it sits inside Suspense to keep navigation instant.
export default function JobPage({ params }: PageProps<"/jobs/[id]">) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-zinc-500">Loading the job…</p>}>
      <Job params={params} />
    </Suspense>
  );
}

async function Job({ params }: { params: PageProps<"/jobs/[id]">["params"] }) {
  const { id } = await params;
  if (!(await listJobIds()).includes(id)) notFound();
  return <JobView job={await loadJob(id)} />;
}
