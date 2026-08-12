-- 待办部门：新建/编辑时可选择，默认「通用」
ALTER TABLE public.todos
  ADD COLUMN department TEXT NOT NULL DEFAULT '通用'
  CHECK (department IN (
    '通用',
    '人力资源部',
    '技术部',
    '制造部',
    '计划科',
    '营业部',
    '品管部',
    '采购部',
    '财务部',
    '仓库',
    '开发部'
  ));

COMMENT ON COLUMN public.todos.department IS '任务所属部门；未选择时为「通用」';
