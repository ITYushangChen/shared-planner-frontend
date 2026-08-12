-- =============================================================================
-- ShareTodo AI — 数据库初始化（对照需求文档）
-- 用法：打开本文件，全选复制 SQL 正文，粘贴到 Supabase → SQL Editor → Run
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. 清理旧对象（便于重复执行；首次执行也会安全跳过）
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

DROP FUNCTION IF EXISTS public.accept_invitation(TEXT);
DROP FUNCTION IF EXISTS public.check_schedule_conflicts(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID);
DROP FUNCTION IF EXISTS public.transfer_space_ownership(UUID, UUID);
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.is_space_member(UUID);
DROP FUNCTION IF EXISTS public.is_space_owner_or_admin(UUID);
DROP FUNCTION IF EXISTS public.set_updated_at();

DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.ai_actions CASCADE;
DROP TABLE IF EXISTS public.ai_messages CASCADE;
DROP TABLE IF EXISTS public.ai_conversations CASCADE;
DROP TABLE IF EXISTS public.todo_comments CASCADE;
DROP TABLE IF EXISTS public.todo_assignees CASCADE;
DROP TABLE IF EXISTS public.todos CASCADE;
DROP TABLE IF EXISTS public.space_invitations CASCADE;
DROP TABLE IF EXISTS public.space_members CASCADE;
DROP TABLE IF EXISTS public.spaces CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

DROP TYPE IF EXISTS public.todo_status;
DROP TYPE IF EXISTS public.todo_priority;
DROP TYPE IF EXISTS public.invite_status;
DROP TYPE IF EXISTS public.space_role;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 枚举
-- ---------------------------------------------------------------------------
CREATE TYPE public.space_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE public.invite_status AS ENUM ('pending', 'accepted', 'expired', 'revoked');
CREATE TYPE public.todo_priority AS ENUM ('high', 'medium', 'low');
CREATE TYPE public.todo_status AS ENUM ('todo', 'in_progress', 'done');

-- =============================================================================
-- 模块 1：账号与空间体系（多租户）
-- =============================================================================

-- 用户资料（登录账号在 auth.users；业务用户看本表）
CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  timezone      TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.profiles IS '业务用户表；id 与 auth.users.id 一一对应';

-- 协作空间（家庭 / 工作 / 项目组）
CREATE TABLE public.spaces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  avatar_url    TEXT,
  owner_id      UUID NOT NULL REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_spaces_owner ON public.spaces(owner_id);
COMMENT ON TABLE public.spaces IS '共享空间；注册时自动创建个人默认空间';

-- 空间成员（支持多空间切换）
CREATE TABLE public.space_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id      UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role          public.space_role NOT NULL DEFAULT 'member',
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (space_id, user_id)
);

CREATE INDEX idx_space_members_user ON public.space_members(user_id);
CREATE INDEX idx_space_members_space ON public.space_members(space_id);
COMMENT ON TABLE public.space_members IS '空间成员与角色：owner / admin / member';

-- 邀请码 / 邀请链接
CREATE TABLE public.space_invitations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id      UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  inviter_id    UUID NOT NULL REFERENCES public.profiles(id),
  code          TEXT NOT NULL UNIQUE,
  invite_type   TEXT NOT NULL DEFAULT 'code' CHECK (invite_type IN ('code', 'link')),
  max_uses      INT,                          -- NULL=不限；1=一次性
  used_count    INT NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ,                  -- NULL=不过期
  status        public.invite_status NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invitations_space ON public.space_invitations(space_id);
CREATE INDEX idx_invitations_code ON public.space_invitations(code);
COMMENT ON TABLE public.space_invitations IS '空间邀请：一次性或有效期邀请码/链接';

-- =============================================================================
-- 模块 2 + 3：待办管理 + 日历时间段
-- =============================================================================

-- 待办本体；start_at/end_at 为空 = 侧边栏「待排期」
CREATE TABLE public.todos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id      UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  creator_id    UUID NOT NULL REFERENCES public.profiles(id),
  title         TEXT NOT NULL,
  description   TEXT,
  priority      public.todo_priority NOT NULL DEFAULT 'medium',
  status        public.todo_status NOT NULL DEFAULT 'todo',

  -- 日历排期（精确到分钟）；拖拽改期只更新这两列
  start_at      TIMESTAMPTZ,
  end_at        TIMESTAMPTZ,
  is_all_day    BOOLEAN NOT NULL DEFAULT FALSE,
  due_at        TIMESTAMPTZ,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0),

  -- 标记完成
  completed_by  UUID REFERENCES public.profiles(id),
  completed_at  TIMESTAMPTZ,

  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai')),
  sort_score    NUMERIC(10, 4),               -- AI 智能重排序缓存分

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_todo_time CHECK (
    (start_at IS NULL AND end_at IS NULL)
    OR (start_at IS NOT NULL AND end_at IS NOT NULL AND end_at > start_at)
    OR (is_all_day = TRUE AND start_at IS NOT NULL)
  )
);

CREATE INDEX idx_todos_space_status ON public.todos(space_id, status);
CREATE INDEX idx_todos_space_time ON public.todos(space_id, start_at, end_at);
CREATE INDEX idx_todos_space_priority ON public.todos(space_id, priority);
CREATE INDEX idx_todos_creator ON public.todos(creator_id);
CREATE INDEX idx_todos_unscheduled ON public.todos(space_id)
  WHERE start_at IS NULL AND status <> 'done';

ALTER TABLE public.todos
  ADD COLUMN time_range tstzrange
  GENERATED ALWAYS AS (
    CASE
      WHEN start_at IS NOT NULL AND end_at IS NOT NULL
        THEN tstzrange(start_at, end_at, '[)')
      ELSE NULL
    END
  ) STORED;

CREATE INDEX idx_todos_time_range ON public.todos USING GIST (time_range);
COMMENT ON TABLE public.todos IS '待办+日程：时间段绑定、全天事件、待排期列表';

-- 多人指派（支持「全员」「小李+小王」）
CREATE TABLE public.todo_assignees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id       UUID NOT NULL REFERENCES public.todos(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (todo_id, user_id)
);

CREATE INDEX idx_todo_assignees_user ON public.todo_assignees(user_id);
CREATE INDEX idx_todo_assignees_todo ON public.todo_assignees(todo_id);
COMMENT ON TABLE public.todo_assignees IS '待办指派人；冲突检测按指派人时间轴判断';

-- 评论 / 协作动态
CREATE TABLE public.todo_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id       UUID NOT NULL REFERENCES public.todos(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES public.profiles(id),
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_todo_comments_todo ON public.todo_comments(todo_id);
COMMENT ON TABLE public.todo_comments IS '待办评论与协作沟通';

-- =============================================================================
-- 模块 4：AI 智能能力
-- =============================================================================

CREATE TABLE public.ai_conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id      UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id),
  title         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_conversations_space ON public.ai_conversations(space_id);
CREATE INDEX idx_ai_conversations_user ON public.ai_conversations(user_id);
COMMENT ON TABLE public.ai_conversations IS 'AI 会话（自然语言建待办、智能排期等）';

CREATE TABLE public.ai_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_messages_conv ON public.ai_messages(conversation_id);
COMMENT ON TABLE public.ai_messages IS 'AI 对话消息';

-- AI 动作审计：创建待办 / 排期 / 重排序 / 每日摘要 / 冲突建议
CREATE TABLE public.ai_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  space_id        UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.profiles(id),
  action_type     TEXT NOT NULL,
  -- create_todo | reschedule | reorder | daily_summary | conflict_suggest
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_todo_ids UUID[] DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'applied'
                  CHECK (status IN ('applied', 'undone', 'failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_actions_space ON public.ai_actions(space_id);
CREATE INDEX idx_ai_actions_type ON public.ai_actions(action_type);
COMMENT ON TABLE public.ai_actions IS 'AI 操作审计，支持撤销与冲突建议追溯';

-- =============================================================================
-- 模块 5：通知（每日摘要、冲突、被指派、邀请）
-- =============================================================================

CREATE TABLE public.notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  space_id      UUID REFERENCES public.spaces(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  -- daily_summary | conflict | assigned | invite
  title         TEXT NOT NULL,
  body          TEXT,
  payload       JSONB,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON public.notifications(user_id, is_read);
COMMENT ON TABLE public.notifications IS '站内通知：每日摘要、冲突提醒等';

-- =============================================================================
-- 辅助函数
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_space_member(p_space_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.space_members
    WHERE space_id = p_space_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_space_owner_or_admin(p_space_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.space_members
    WHERE space_id = p_space_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 注册后：建 profile + 个人空间 + owner
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_space_id UUID;
  uname TEXT;
BEGIN
  uname := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    split_part(NEW.email, '@', 1),
    'User'
  );

  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, uname);

  INSERT INTO public.spaces (name, description, owner_id)
  VALUES (uname || '的空间', '个人默认空间', NEW.id)
  RETURNING id INTO new_space_id;

  INSERT INTO public.space_members (space_id, user_id, role)
  VALUES (new_space_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER trg_profiles_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_spaces_updated
  BEFORE UPDATE ON public.spaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_todos_updated
  BEFORE UPDATE ON public.todos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_comments_updated
  BEFORE UPDATE ON public.todo_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todo_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todo_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- spaces
CREATE POLICY "spaces_select_member"
  ON public.spaces FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.is_space_member(id)
  );

CREATE POLICY "spaces_insert_auth"
  ON public.spaces FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "spaces_update_admin"
  ON public.spaces FOR UPDATE TO authenticated
  USING (public.is_space_owner_or_admin(id));

CREATE POLICY "spaces_delete_owner"
  ON public.spaces FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- space_members
CREATE POLICY "members_select_same_space"
  ON public.space_members FOR SELECT TO authenticated
  USING (public.is_space_member(space_id));

CREATE POLICY "members_insert_admin_or_self"
  ON public.space_members FOR INSERT TO authenticated
  WITH CHECK (
    public.is_space_owner_or_admin(space_id) OR user_id = auth.uid()
  );

CREATE POLICY "members_update_admin"
  ON public.space_members FOR UPDATE TO authenticated
  USING (public.is_space_owner_or_admin(space_id));

CREATE POLICY "members_delete_admin_or_self"
  ON public.space_members FOR DELETE TO authenticated
  USING (
    user_id = auth.uid() OR public.is_space_owner_or_admin(space_id)
  );

-- invitations
CREATE POLICY "invites_select_member"
  ON public.space_invitations FOR SELECT TO authenticated
  USING (public.is_space_member(space_id));

CREATE POLICY "invites_insert_admin"
  ON public.space_invitations FOR INSERT TO authenticated
  WITH CHECK (public.is_space_owner_or_admin(space_id));

CREATE POLICY "invites_update_admin"
  ON public.space_invitations FOR UPDATE TO authenticated
  USING (public.is_space_owner_or_admin(space_id));

CREATE POLICY "invites_delete_admin"
  ON public.space_invitations FOR DELETE TO authenticated
  USING (public.is_space_owner_or_admin(space_id));

-- todos
CREATE POLICY "todos_select_member"
  ON public.todos FOR SELECT TO authenticated
  USING (public.is_space_member(space_id));

CREATE POLICY "todos_insert_member"
  ON public.todos FOR INSERT TO authenticated
  WITH CHECK (public.is_space_member(space_id) AND creator_id = auth.uid());

CREATE POLICY "todos_update_member"
  ON public.todos FOR UPDATE TO authenticated
  USING (public.is_space_member(space_id));

CREATE POLICY "todos_delete_member"
  ON public.todos FOR DELETE TO authenticated
  USING (
    public.is_space_member(space_id)
    AND (creator_id = auth.uid() OR public.is_space_owner_or_admin(space_id))
  );

-- todo_assignees
CREATE POLICY "assignees_select_member"
  ON public.todo_assignees FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.todos t
      WHERE t.id = todo_id AND public.is_space_member(t.space_id)
    )
  );

CREATE POLICY "assignees_insert_member"
  ON public.todo_assignees FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.todos t
      WHERE t.id = todo_id AND public.is_space_member(t.space_id)
    )
  );

CREATE POLICY "assignees_update_member"
  ON public.todo_assignees FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.todos t
      WHERE t.id = todo_id AND public.is_space_member(t.space_id)
    )
  );

CREATE POLICY "assignees_delete_member"
  ON public.todo_assignees FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.todos t
      WHERE t.id = todo_id AND public.is_space_member(t.space_id)
    )
  );

-- todo_comments
CREATE POLICY "comments_select_member"
  ON public.todo_comments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.todos t
      WHERE t.id = todo_id AND public.is_space_member(t.space_id)
    )
  );

CREATE POLICY "comments_insert_member"
  ON public.todo_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.todos t
      WHERE t.id = todo_id AND public.is_space_member(t.space_id)
    )
  );

CREATE POLICY "comments_update_own"
  ON public.todo_comments FOR UPDATE TO authenticated
  USING (author_id = auth.uid());

CREATE POLICY "comments_delete_own"
  ON public.todo_comments FOR DELETE TO authenticated
  USING (author_id = auth.uid());

-- AI
CREATE POLICY "ai_conv_select_own"
  ON public.ai_conversations FOR SELECT TO authenticated
  USING (public.is_space_member(space_id) AND user_id = auth.uid());

CREATE POLICY "ai_conv_insert_own"
  ON public.ai_conversations FOR INSERT TO authenticated
  WITH CHECK (public.is_space_member(space_id) AND user_id = auth.uid());

CREATE POLICY "ai_conv_update_own"
  ON public.ai_conversations FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "ai_conv_delete_own"
  ON public.ai_conversations FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "ai_msg_select_own_conv"
  ON public.ai_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "ai_msg_insert_own_conv"
  ON public.ai_messages FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "ai_msg_delete_own_conv"
  ON public.ai_messages FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "ai_actions_select_member"
  ON public.ai_actions FOR SELECT TO authenticated
  USING (public.is_space_member(space_id));

CREATE POLICY "ai_actions_insert_member"
  ON public.ai_actions FOR INSERT TO authenticated
  WITH CHECK (public.is_space_member(space_id) AND user_id = auth.uid());

CREATE POLICY "ai_actions_update_own"
  ON public.ai_actions FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- notifications
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notifications_insert_own"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notifications_delete_own"
  ON public.notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =============================================================================
-- RPC
-- =============================================================================

-- 接受邀请码加入空间
CREATE OR REPLACE FUNCTION public.accept_invitation(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.space_invitations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO inv
  FROM public.space_invitations
  WHERE code = p_code AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid invite';
  END IF;

  IF inv.expires_at IS NOT NULL AND inv.expires_at < NOW() THEN
    UPDATE public.space_invitations SET status = 'expired' WHERE id = inv.id;
    RAISE EXCEPTION 'invite expired';
  END IF;

  IF inv.max_uses IS NOT NULL AND inv.used_count >= inv.max_uses THEN
    RAISE EXCEPTION 'invite exhausted';
  END IF;

  INSERT INTO public.space_members (space_id, user_id, role)
  VALUES (inv.space_id, auth.uid(), 'member')
  ON CONFLICT (space_id, user_id) DO NOTHING;

  UPDATE public.space_invitations
  SET used_count = used_count + 1,
      status = CASE
        WHEN max_uses IS NOT NULL AND used_count + 1 >= max_uses
          THEN 'accepted'::public.invite_status
        ELSE status
      END
  WHERE id = inv.id;

  RETURN inv.space_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT) TO authenticated;

-- 转让空间所有者（创建者退出前须先转让）
CREATE OR REPLACE FUNCTION public.transfer_space_ownership(
  p_space_id UUID,
  p_new_owner_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.spaces
    WHERE id = p_space_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'only owner can transfer';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.space_members
    WHERE space_id = p_space_id AND user_id = p_new_owner_id
  ) THEN
    RAISE EXCEPTION 'new owner must be a space member';
  END IF;

  UPDATE public.spaces
  SET owner_id = p_new_owner_id
  WHERE id = p_space_id;

  UPDATE public.space_members
  SET role = 'member'
  WHERE space_id = p_space_id AND user_id = auth.uid();

  UPDATE public.space_members
  SET role = 'owner'
  WHERE space_id = p_space_id AND user_id = p_new_owner_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_space_ownership(UUID, UUID) TO authenticated;

-- 日程冲突检测（同一指派人时间重叠，跨空间）
CREATE OR REPLACE FUNCTION public.check_schedule_conflicts(
  p_space_id UUID,
  p_user_id UUID,
  p_start_at TIMESTAMPTZ,
  p_end_at TIMESTAMPTZ,
  p_exclude_todo_id UUID DEFAULT NULL
)
RETURNS SETOF public.todos
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.*
  FROM public.todos t
  WHERE t.status <> 'done'
    AND t.time_range IS NOT NULL
    AND t.time_range && tstzrange(p_start_at, p_end_at, '[)')
    AND (p_exclude_todo_id IS NULL OR t.id <> p_exclude_todo_id)
    AND (auth.uid() IS NULL OR public.is_space_member(p_space_id))
    AND EXISTS (
      SELECT 1
      FROM public.space_members sm
      WHERE sm.space_id = t.space_id
        AND sm.user_id = p_user_id
    )
    AND (
      EXISTS (
        SELECT 1
        FROM public.todo_assignees a
        WHERE a.todo_id = t.id
          AND a.user_id = p_user_id
      )
      OR (
        t.creator_id = p_user_id
        AND NOT EXISTS (
          SELECT 1 FROM public.todo_assignees a WHERE a.todo_id = t.id
        )
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.check_schedule_conflicts(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID)
  TO authenticated;
