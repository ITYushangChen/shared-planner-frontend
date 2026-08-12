import { JoinSpaceForm } from "../join-space-form";

type Props = {
  searchParams: Promise<{ code?: string }>;
};

export default async function JoinSpacePage({ searchParams }: Props) {
  const { code } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900">加入空间</h1>
        <p className="mt-1 text-sm text-zinc-500">
          使用邀请码加入协作空间
        </p>
      </header>
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <JoinSpaceForm initialCode={code?.toUpperCase() ?? ""} />
      </div>
    </main>
  );
}
