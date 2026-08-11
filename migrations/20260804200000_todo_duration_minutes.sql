-- 未排期任务保留「时长」，清除 start_at/end_at 后仍可展示与拖回日历
ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

ALTER TABLE public.todos
  DROP CONSTRAINT IF EXISTS chk_todo_duration_minutes;

ALTER TABLE public.todos
  ADD CONSTRAINT chk_todo_duration_minutes
  CHECK (duration_minutes IS NULL OR duration_minutes > 0);

COMMENT ON COLUMN public.todos.duration_minutes IS
  '计划时长（分钟）。未排期时保留；排期时可从 end_at-start_at 同步';
