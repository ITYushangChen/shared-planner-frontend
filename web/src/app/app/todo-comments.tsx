"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type CommentRow = {
  id: string;
  content: string;
  created_at: string;
  author_id: string;
  profiles?: { display_name: string } | null;
};

type Props = {
  todoId: string;
};

export function TodoComments({ todoId }: Props) {
  const supabase = createClient();
  const [items, setItems] = useState<CommentRow[]>([]);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("todo_comments")
      .select("id, content, created_at, author_id, profiles(display_name)")
      .eq("todo_id", todoId)
      .order("created_at", { ascending: true });
    if (error) {
      setMsg(error.message);
      return;
    }
    setItems((data as unknown as CommentRow[]) ?? []);
  }, [supabase, todoId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendComment() {
    const content = text.trim();
    if (!content || loading) return;
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setMsg("请先登录");
      return;
    }
    const { error } = await supabase.from("todo_comments").insert({
      todo_id: todoId,
      author_id: user.id,
      content,
    });
    setLoading(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    setText("");
    setMsg("");
    await load();
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <p className="text-sm font-medium text-zinc-700">评论</p>
      <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
        {items.length === 0 ? (
          <li className="text-xs text-zinc-400">暂无评论，记录协作沟通吧</li>
        ) : (
          items.map((c) => (
            <li key={c.id} className="rounded bg-zinc-50 px-2 py-1.5 text-xs">
              <p className="font-medium text-zinc-700">
                {c.profiles?.display_name ?? "成员"}
                <span className="ml-2 font-normal text-zinc-400">
                  {new Date(c.created_at).toLocaleString()}
                </span>
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-zinc-600">
                {c.content}
              </p>
            </li>
          ))
        )}
      </ul>
      <div className="mt-2 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-sm"
          placeholder="写一条评论…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendComment();
            }
          }}
        />
        <button
          type="button"
          disabled={loading || !text.trim()}
          onClick={() => void sendComment()}
          className="rounded-xl bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          发送
        </button>
      </div>
      {msg ? <p className="mt-1 text-xs text-zinc-500">{msg}</p> : null}
    </div>
  );
}
