import Link from "next/link";

/** 与消息页一致的黑色圆角「返回」按钮 */
export function BackToAppButton({ label = "返回" }: { label?: string }) {
  return (
    <Link
      href="/app?view=calendar&range=week"
      className="inline-flex rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800"
    >
      {label}
    </Link>
  );
}
