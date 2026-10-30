import Link from "next/link";

import { listJobIds, loadJob } from "@/lib/fixtures";

export default async function Home() {
  const jobs = await Promise.all((await listJobIds()).map(loadJob));
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold">muse-fieldnotes</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Job close-outs where every line cites its evidence.</p>
      </header>
      <ul className="flex flex-col gap-2">
        {jobs.map((job) => (
          <li key={job.id}>
            <Link
              href={`/jobs/${job.id}`}
              className="block rounded-lg border border-zinc-200 px-4 py-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <span className="font-mono text-xs text-zinc-500">{job.id}</span>
              <span className="block font-medium">{job.title}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/dev/segment" className="text-sm text-zinc-500 underline">
        Dev: try SAM 3.1 on any photo
      </Link>
    </main>
  );
}
