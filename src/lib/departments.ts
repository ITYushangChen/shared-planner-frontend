/** 任务部门下拉选项；未选择时默认「通用」 */
export const DEPARTMENTS = [
  "人力资源部",
  "技术部",
  "制造部",
  "计划科",
  "营业部",
  "品管部",
  "采购部",
  "财务部",
  "仓库",
  "开发部",
] as const;

export const DEFAULT_DEPARTMENT = "通用";

export const DEPARTMENT_OPTIONS = [DEFAULT_DEPARTMENT, ...DEPARTMENTS] as const;
