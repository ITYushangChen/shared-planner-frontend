import {
  addLocalDateKey,
  getOverviewBounds,
  localDateKey,
  type SpaceNavItem,
  type TodoRow,
} from "./todos";

export type ReportType = "day" | "week" | "month";

export const REPORT_TYPE_ORDER: ReportType[] = ["day", "week", "month"];

export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  day: "日报",
  week: "周报",
  month: "月报",
};

export type ReportStatus = "done" | "in_progress" | "todo";

export const REPORT_STATUS_ORDER: ReportStatus[] = [
  "done",
  "in_progress",
  "todo",
];

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  done: "已完成",
  in_progress: "进行中",
  todo: "未开始",
};

/** 按任务名称关键字分类：BUG / FEAT / OPTIMIZE / REFACTOR / DOCS / TEST / OTHER */
const TASK_CATEGORY_RULES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /bug|缺陷|修复|hotfix/i, label: "BUG" },
  { pattern: /feat|feature|新功能|新增|需求/i, label: "FEAT" },
  { pattern: /优化|性能|performance|optimize/i, label: "OPTIMIZE" },
  { pattern: /重构|refactor/i, label: "REFACTOR" },
  { pattern: /文档|doc/i, label: "DOCS" },
  { pattern: /测试|test/i, label: "TEST" },
];

export function taskCategory(title: string): string {
  for (const rule of TASK_CATEGORY_RULES) {
    if (rule.pattern.test(title)) return rule.label;
  }
  return "OTHER";
}

/** 分类显示名：BUG→修改、FEAT→新增，其余保持原样 */
export function categoryLabel(category: string): string {
  if (category === "BUG") return "修改";
  if (category === "FEAT") return "新增";
  return category;
}

/** 大白话描述：按分类 + 状态给出口语化表述 */
const PLAIN_PHRASES: Record<
  string,
  { done: string; doing: string; todo: string }
> = {
  BUG: {
    done: "已经修好了，问题解决，验证通过。",
    doing: "正在修，问题已经定位到了。",
    todo: "准备修，先把问题复现出来再动手。",
  },
  FEAT: {
    done: "已经做出来了，功能可以正常用。",
    doing: "正在做，核心功能已经差不多了。",
    todo: "准备做，先理清需求再动手。",
  },
  OPTIMIZE: {
    done: "已经优化完了，速度明显变快了。",
    doing: "正在优化，效果已经有一些了。",
    todo: "准备优化，先找找哪里慢。",
  },
  REFACTOR: {
    done: "已经重构完了，代码结构清爽多了。",
    doing: "正在重构，主体已经改完了。",
    todo: "准备重构，先把结构理清楚。",
  },
  DOCS: {
    done: "文档已经写好了，内容齐全。",
    doing: "正在写文档，主体已经差不多了。",
    todo: "准备写文档，先整理资料。",
  },
  TEST: {
    done: "已经测试完了，结果都正常。",
    doing: "正在测试，主要场景已经跑过了。",
    todo: "准备测试，先把用例列出来。",
  },
  OTHER: {
    done: "已经干完了，结果没问题。",
    doing: "正在干，进展顺利。",
    todo: "准备开工，按计划推进。",
  },
};

/** 把任务名称自动转化成大白话描述 */
export function generatePlainDescription(
  title: string,
  status: ReportStatus,
  category: string,
): string {
  const phrases = PLAIN_PHRASES[category] ?? PLAIN_PHRASES.OTHER;
  const tail =
    status === "done"
      ? phrases.done
      : status === "in_progress"
        ? phrases.doing
        : phrases.todo;
  return `「${title}」${tail}`;
}

/** 有结果导向的大白话：按分类 + 状态生成“对公司有什么好处”的描述（AI 不可用时的兜底） */
const RESULT_PHRASES: Record<
  string,
  { done: string; doing: string; todo: string }
> = {
  BUG: {
    done: "已修复完成，问题解决，功能恢复正常，减少客户使用故障。",
    doing: "正在修复，问题已定位，修复后可避免影响客户使用。",
    todo: "待修复，已记录问题，修复后可保障功能稳定。",
  },
  FEAT: {
    done: "已开发完成，功能可正常使用，帮助公司提升效率。",
    doing: "开发中，核心功能已完成大半，上线后能为公司带来新能力。",
    todo: "待开发，需求已明确，开发完成后可满足业务需要。",
  },
  OPTIMIZE: {
    done: "已完成优化，速度明显提升，提高工作效率。",
    doing: "优化中，效果已初步显现，完成后能更快响应。",
    todo: "待优化，已定位瓶颈，优化后可提升整体性能。",
  },
  REFACTOR: {
    done: "已重构完成，结构更清晰，后续维护成本更低。",
    doing: "重构中，主体结构已完成，完成后更好维护。",
    todo: "待重构，方案已定，重构后可降低维护成本。",
  },
  DOCS: {
    done: "已完成，文档内容齐全，方便团队查阅，减少沟通成本。",
    doing: "编写中，主体内容已完成，完成后团队可直接参考。",
    todo: "待编写，资料已整理，完成后便于交接和查阅。",
  },
  TEST: {
    done: "已完成测试，结果正常，降低上线风险。",
    doing: "测试中，核心场景已跑通，可降低上线风险。",
    todo: "待测试，用例已备好，执行后保障交付质量。",
  },
  OTHER: {
    done: "已完成，结果符合预期，工作顺利推进。",
    doing: "进行中，进展顺利，按计划推进。",
    todo: "待开始，已列入计划，将按计划推进。",
  },
};

/** 由任务名称自动生成有结果导向的大白话描述 */
export function generateResultDescription(
  title: string,
  status: ReportStatus,
  category: string,
): string {
  const phrases = RESULT_PHRASES[category] ?? RESULT_PHRASES.OTHER;
  const tail =
    status === "done"
      ? phrases.done
      : status === "in_progress"
        ? phrases.doing
        : phrases.todo;
  return `「${title}」${tail}`;
}

/** 开拓隆海 logo 主色（青色系） */
const LOGO_CYAN = "#007080";
const LOGO_CYAN_DARK = "#005663";
const LOGO_CYAN_TITLE_BG = "#DFEEF0";
const LOGO_CYAN_ZEBRA = "#EFF6F7";
const LOGO_CYAN_BORDER = "#C9DDE0";

/** 动作关键词：配置 / 集成 / 修复 / 实现 / 优化 / 迁移重构 */
const ACTION_KEYWORDS: Array<{ re: RegExp; label: string }> = [
  { re: /配置|部署|安装|设置|config/i, label: "配置" },
  { re: /集成|对接|接入|integrat/i, label: "集成" },
  { re: /修复|bug|缺陷|fix/i, label: "修复" },
  { re: /实现|开发|新增|搭建|创建|编写|feat|feature/i, label: "实现" },
  { re: /优化|性能|提升|改善|optimiz/i, label: "优化" },
  { re: /迁移|重构|升级|改造|refactor/i, label: "迁移重构" },
];

/** 对象关键词：数据库 / 表结构 / 接口 / 服务 / 脚本 / 文件 */
const OBJECT_KEYWORDS: Array<{ re: RegExp; label: string }> = [
  { re: /数据库|data\s*base/i, label: "数据库" },
  { re: /表结构/i, label: "表结构" },
  { re: /接口|api/i, label: "接口" },
  { re: /服务|service/i, label: "服务" },
  { re: /脚本|script/i, label: "脚本" },
  { re: /文件|file/i, label: "文件" },
];

/** 目标句式：解决..的问题 / 实现..功能 / 满足..需求 / 支持..功能 */
const GOAL_PATTERNS: Array<{
  re: RegExp;
  build: (m: RegExpExecArray) => string;
}> = [
  {
    re: /解决([^，。；;]+?)(?:的)?问题/i,
    build: (m) => `解决${m[1]}问题`,
  },
  {
    re: /实现([^，。；;]+?)功能/i,
    build: (m) => `实现${m[1]}功能`,
  },
  {
    re: /满足([^，。；;]+?)需求/i,
    build: (m) => `满足${m[1]}需求`,
  },
  {
    re: /支持([^，。；;]+?)功能/i,
    build: (m) => `支持${m[1]}功能`,
  },
];

/** 未命中任务名目标句式时，按分类 + 状态给出兜底目标 */
const GOAL_BY_CATEGORY: Record<
  string,
  { done: string; doing: string; todo: string }
> = {
  BUG: {
    done: "问题已解决，回归验证通过，功能恢复正常。",
    doing: "已定位问题原因，正在修复中。",
    todo: "将复现并定位问题，制定修复方案。",
  },
  FEAT: {
    done: "功能已实现并验证通过，满足预期需求。",
    doing: "核心逻辑已实现，正在完善细节。",
    todo: "将完成需求分析与设计后进入开发。",
  },
  OPTIMIZE: {
    done: "性能与效率明显提升，验证通过。",
    doing: "部分指标已改善，持续优化中。",
    todo: "将分析瓶颈并制定优化方案。",
  },
  REFACTOR: {
    done: "代码结构更清晰，可维护性提升。",
    doing: "核心模块已调整，持续重构中。",
    todo: "将梳理结构并制定重构方案。",
  },
  DOCS: {
    done: "内容完整、结构清晰，已发布供团队查阅。",
    doing: "主体内容已完成，正在补充细节。",
    todo: "将整理资料并编写完整文档。",
  },
  TEST: {
    done: "用例覆盖关键场景，结果符合预期。",
    doing: "核心场景已覆盖，持续推进中。",
    todo: "将设计并执行测试用例，覆盖关键场景。",
  },
  OTHER: {
    done: "相关工作已完成并跟进收尾。",
    doing: "整体进展顺利，持续推进中。",
    todo: "将按计划推进相关工作并及时跟进。",
  },
};

function detectAction(title: string): string | null {
  for (const item of ACTION_KEYWORDS) {
    if (item.re.test(title)) return item.label;
  }
  return null;
}

function detectObject(title: string): string | null {
  for (const item of OBJECT_KEYWORDS) {
    if (item.re.test(title)) return item.label;
  }
  return null;
}

function detectTitleGoal(title: string): string | null {
  for (const item of GOAL_PATTERNS) {
    const m = item.re.exec(title);
    if (m) return item.build(m);
  }
  return null;
}

const CATEGORY_ACTION: Record<string, string> = {
  BUG: "修复",
  FEAT: "实现",
  OPTIMIZE: "优化",
  REFACTOR: "迁移重构",
  DOCS: "实现",
  TEST: "实现",
  OTHER: "实现",
};

/**
 * 依据项目文档 supabase/services/api/描述关键词 的关键词体系：
 * 一、核心关键词分类
 *   1. 动作与目的：生成 / 自动化 / 处理 / 交付
 *   2. 对象与范围：报表类型 / 数据内容 / 数据来源 / 输出格式
 *   3. 质量与标准：格式要求 / 准确性 / 性能 / 易用性
 * 二、关键词组合公式：
 *   [动作/目的] + [自动化特征] + [目标报表类型] + [数据来源与处理] + [输出标准与格式]
 */
const DOC_ACTION_WORDS: Array<{ label: string; words: string[] }> = [
  {
    label: "生成",
    words: ["生成", "导出", "输出", "创建", "制作"],
  },
  {
    label: "自动化",
    words: ["自动生成", "自动化流程", "定时任务", "触发式生成", "动态更新"],
  },
  {
    label: "处理",
    words: ["汇总", "统计", "分析", "计算", "清洗", "合并"],
  },
  {
    label: "交付",
    words: ["推送", "分发", "存档", "展示", "可视化"],
  },
];

const DOC_OBJECT_WORDS: Array<{ label: string; words: string[] }> = [
  {
    label: "报表类型",
    words: ["日报", "周报", "月报", "数据看板", "运营报表", "生产报表"],
  },
  {
    label: "数据内容",
    words: [
      "生产进度",
      "缺料分析",
      "销售数据",
      "项目里程碑",
      "任务完成率",
      "关键指标",
      "KPI",
    ],
  },
  {
    label: "数据来源",
    words: ["Supabase", "MySQL", "数据库", "API", "接口"],
  },
  {
    label: "输出格式",
    words: ["Excel", ".xlsx", "工作簿", "图表", "数据透视表", "打印格式", "Sheet"],
  },
];

const DOC_QUALITY_WORDS: Array<{ label: string; words: string[] }> = [
  {
    label: "格式要求",
    words: ["单元格格式", "条件格式", "高亮", "字体", "颜色", "列宽", "Logo"],
  },
  {
    label: "准确性",
    words: ["数据准确", "实时同步", "历史数据", "数据校验"],
  },
  {
    label: "性能",
    words: ["生成速度", "大数据量", "超时"],
  },
  {
    label: "易用性",
    words: ["一键生成", "自动归档", "下载", "邮件"],
  },
];

/** 质量关键词 → 描述短语 */
const QUALITY_PHRASES: Record<string, string> = {
  单元格格式: "单元格格式规范",
  条件格式: "含条件格式高亮异常值",
  高亮: "高亮异常值",
  字体: "字体/颜色规范",
  颜色: "字体/颜色规范",
  列宽: "列宽自适应",
  Logo: "带公司 Logo",
  数据准确: "数据准确",
  实时同步: "实时同步",
  历史数据: "历史数据可追溯",
  数据校验: "支持数据校验",
  生成速度: "生成速度快",
  大数据量: "支持大数据量",
  超时: "不超时",
  一键生成: "支持一键生成",
  自动归档: "自动归档命名",
  下载: "支持下载",
  邮件: "支持邮件发送",
};

/** 输出格式关键词 → 描述短语 */
const OUTPUT_FORMAT_PHRASES: Record<string, string> = {
  Excel: "Excel 工作簿",
  ".xlsx": ".xlsx 文件",
  工作簿: "Excel 工作簿",
  图表: "包含图表",
  数据透视表: "包含数据透视表",
  打印格式: "预设打印格式",
  Sheet: "多个 Sheet",
};

function findDocKeywordHits(title: string): {
  actions: string[];
  automation: string[];
  reportTypes: string[];
  dataContents: string[];
  dataSources: string[];
  outputFormats: string[];
  quality: string[];
} {
  const buckets: Record<
    "actions" | "automation" | "reportTypes" | "dataContents" | "dataSources" | "outputFormats" | "quality",
    Array<{ word: string; pos: number }>
  > = {
    actions: [],
    automation: [],
    reportTypes: [],
    dataContents: [],
    dataSources: [],
    outputFormats: [],
    quality: [],
  };
  const lower = title.toLowerCase();
  const scan = (
    bucket: keyof typeof buckets,
    words: string[],
  ) => {
    for (const w of words) {
      const pos = lower.indexOf(w.toLowerCase());
      if (pos >= 0) buckets[bucket].push({ word: w, pos });
    }
  };
  for (const item of DOC_ACTION_WORDS) {
    scan(
      item.label === "自动化" ? "automation" : "actions",
      item.words,
    );
  }
  for (const item of DOC_OBJECT_WORDS) {
    const bucket =
      item.label === "报表类型"
        ? "reportTypes"
        : item.label === "数据内容"
          ? "dataContents"
          : item.label === "数据来源"
            ? "dataSources"
            : "outputFormats";
    scan(bucket, item.words);
  }
  for (const item of DOC_QUALITY_WORDS) {
    scan("quality", item.words);
  }
  const hits = {
    actions: [] as string[],
    automation: [] as string[],
    reportTypes: [] as string[],
    dataContents: [] as string[],
    dataSources: [] as string[],
    outputFormats: [] as string[],
    quality: [] as string[],
  };
  for (const key of Object.keys(buckets) as Array<keyof typeof buckets>) {
    buckets[key].sort((a, b) => a.pos - b.pos);
    hits[key] = buckets[key].map((f) => f.word);
  }
  return hits;
}

/** 按文档公式组合描述：[动作/目的] + [自动化特征] + [目标报表类型] + [数据来源与处理] + [输出标准与格式] */
function composeDocDescription(
  status: ReportStatus,
  hits: ReturnType<typeof findDocKeywordHits>,
): string {
  const verb =
    status === "done" ? "完成" : status === "in_progress" ? "正在" : "计划";
  const automation = hits.automation[0] ?? "";
  // 自动化词已含动作时（如“自动生成”），不再重复拼接“生成”
  const actionCandidates = automation
    ? hits.actions.filter(
        (a) => !automation.toLowerCase().includes(a.toLowerCase()),
      )
    : hits.actions;
  const action = actionCandidates[0] ?? (automation ? "" : "生成");
  const reportType = hits.reportTypes[0] ?? "报表";
  const dataContent = hits.dataContents[0] ?? "";
  const target = dataContent ? `${dataContent}${reportType}` : reportType;
  const sourceWord = hits.dataSources[0] ?? "";
  const dataSource = sourceWord
    ? `通过 ${sourceWord} 获取数据`
    : "从系统数据中整理";
  const formatWord = hits.outputFormats[0] ?? "";
  const formatPhrase = formatWord
    ? OUTPUT_FORMAT_PHRASES[formatWord] ?? formatWord
    : "Excel 工作簿";
  const outputPart = /^(包含|预设)/.test(formatPhrase)
    ? formatPhrase
    : `输出为 ${formatPhrase}`;
  const quality =
    hits.quality.length > 0
      ? hits.quality
          .map((w) => QUALITY_PHRASES[w] ?? w)
          .join("、")
      : "格式规范、数据准确";
  return `${verb}${automation}${action}${target}，${dataSource}，${outputPart}，${quality}。`;
}

/**
 * 按「动作 + 对象 + 约束/目标」的结构，根据任务名称自动生成完整描述。
 * 动作：配置 / 集成 / 修复 / 实现 / 优化 / 迁移重构；
 * 对象：数据库 / 表结构 / 接口 / 服务 / 脚本 / 文件；
 * 目标：解决..的问题、实现..功能、满足..需求、支持..功能。
 * 任务名命中《描述关键词》文档中的报表类关键词时，优先按文档公式生成。
 */
export function generateTaskDescription(
  title: string,
  status: ReportStatus,
  category: string,
): string {
  const hits = findDocKeywordHits(title);
  const hasReportContext =
    hits.reportTypes.length > 0 ||
    hits.outputFormats.length > 0 ||
    hits.dataContents.length > 0 ||
    hits.automation.length > 0 ||
    hits.actions.length > 0;
  if (hasReportContext) {
    return composeDocDescription(status, hits);
  }

  const phase =
    status === "done" ? "done" : status === "in_progress" ? "doing" : "todo";
  const action = detectAction(title) ?? CATEGORY_ACTION[category] ?? "实现";
  const object = detectObject(title) ?? "相关功能";
  const goal =
    detectTitleGoal(title) ??
    GOAL_BY_CATEGORY[category]?.[phase] ??
    "结果符合预期。";
  const verb =
    status === "done"
      ? "完成"
      : status === "in_progress"
        ? "正在进行"
        : "计划开展";
  return `针对任务“${title}”，${verb}对${object}的${action}：${goal}`;
}

export type ReportTask = {
  id: string;
  title: string;
  description: string | null;
  /** 展示用描述：有原始描述用原始描述，否则按任务名称自动生成 */
  description_display: string;
  priority: "high" | "medium" | "low";
  status: ReportStatus;
  space_id: string;
  space_name: string;
  /** 分类：按任务名称关键字，如 BUG / FEAT / OPTIMIZE / OTHER */
  category: string;
  /** 展示用时间，如 8/12 10:00~11:00、全天 8/12、完成于 8/12 */
  time_label: string;
  /** 报告条目里的日期，如 08/12 09:00~10:00、08/12 全天、08/11 完成 */
  report_date_label: string;
  /** 任务主日期 YYYY-MM-DD（排期开始日或完成日），用于默认勾选当前周期任务 */
  date_iso: string | null;
  /** Excel 明细：开始时间（展示文本），未排期时为 null */
  start_label: string | null;
  /** Excel 明细：结束时间（展示文本），未排期时为 null */
  end_label: string | null;
  /** Excel 明细：完成时间（展示文本），未完成时为 null */
  completed_label: string | null;
  /** 完成进展：已完成 / 进行中 / 未开始 */
  progress_label: string;
  /** 遇到的问题（暂无数据源时显示暂无） */
  issue_label: string;
  /** 指派成员展示名 */
  assignees: string[];
};

export type ReportSpaceGroup = {
  space_id: string;
  space_name: string;
  total: number;
  counts: Record<ReportStatus, number>;
  tasks: ReportTask[];
};

export type ReportTotals = Record<ReportStatus, number> & { total: number };

export type ReportDataLike = {
  type: ReportType;
  /** 周期标题，如 2026/08/10 ~ 2026/08/16 */
  rangeLabel: string;
  /** 输入控件回显值：日/周 YYYY-MM-DD，月 YYYY-MM */
  input: string;
  spaces: ReportSpaceGroup[];
  totals: ReportTotals;
  /** 当前已选空间展示名 */
  selectedSpacesLabel: string;
};

export type ReportData = ReportDataLike & { start: Date; end: Date };

/** 传给客户端组件时去掉 Date 字段，保持纯可序列化数据 */
export function stripReportData(data: ReportData): ReportDataLike {
  return {
    type: data.type,
    rangeLabel: data.rangeLabel,
    input: data.input,
    spaces: data.spaces,
    totals: data.totals,
    selectedSpacesLabel: data.selectedSpacesLabel,
  };
}

export function parseReportType(raw: string | null | undefined): ReportType {
  if (raw === "day" || raw === "month") return raw;
  return "week";
}

/** 从 URL 解析输入日期；非法/缺失时返回空字符串，由调用方使用今天 */
export function parseReportInput(
  type: ReportType,
  raw: string | null | undefined,
): string {
  const value = raw?.trim() ?? "";
  if (type === "month") {
    const m = /^(\d{4})-(\d{2})$/.exec(value);
    return m ? `${m[1]}-${m[2]}` : "";
  }
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!d) return "";
  const date = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
  if (
    Number.isNaN(date.getTime()) ||
    localDateKey(date) !== `${d[1]}-${d[2]}-${d[3]}`
  ) {
    return "";
  }
  return `${d[1]}-${d[2]}-${d[3]}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatSlashDate(d: Date) {
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

function formatMonthLabel(y: number, m: number) {
  return `${y} 年 ${m} 月`;
}

export function resolveReportRange(
  type: ReportType,
  rawDate: string | null | undefined,
): { start: Date; end: Date; input: string; rangeLabel: string } {
  const now = new Date();
  if (type === "month") {
    const m = /^(\d{4})-(\d{2})$/.exec(rawDate?.trim() ?? "");
    const base = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const start = new Date(
      base.getFullYear(),
      base.getMonth(),
      1,
      0,
      0,
      0,
      0,
    );
    const end = new Date(
      base.getFullYear(),
      base.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    return {
      start,
      end,
      input: `${base.getFullYear()}-${pad2(base.getMonth() + 1)}`,
      rangeLabel: formatMonthLabel(base.getFullYear(), base.getMonth() + 1),
    };
  }

  const parsed = parseReportInput(type, rawDate);
  const base = parsed
    ? new Date(
        Number(parsed.slice(0, 4)),
        Number(parsed.slice(5, 7)) - 1,
        Number(parsed.slice(8, 10)),
      )
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const { start, end } = getOverviewBounds(type, base);
  const input = localDateKey(base);
  const rangeLabel =
    type === "day"
      ? formatSlashDate(start)
      : `${formatSlashDate(start)} ~ ${formatSlashDate(end)}`;
  return { start, end, input, rangeLabel };
}

/** URL 中逗号分隔的空间 id；只保留当前用户可见的空间 */
export function parseReportSpaceIds(
  raw: string | null | undefined,
  spaces: SpaceNavItem[],
): string[] {
  const valid = new Set(spaces.map((s) => s.id));
  const picked = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => valid.has(s));
  return picked.length > 0 ? picked : spaces.map((s) => s.id);
}

function formatTimeLabel(todo: TodoRow): string {
  if (todo.status === "done" && todo.completed_at) {
    const d = new Date(todo.completed_at);
    return `完成于 ${d.getMonth() + 1}/${d.getDate()}`;
  }
  if (todo.is_all_day && todo.start_at) {
    const s = new Date(todo.start_at);
    const label = `${s.getMonth() + 1}/${s.getDate()}`;
    if (todo.end_at) {
      const e = new Date(todo.end_at);
      const endMidnight =
        e.getHours() === 0 && e.getMinutes() === 0 && e.getSeconds() === 0;
      if (!endMidnight || e.getTime() <= s.getTime()) return `全天 ${label}`;
      const endYmd = localDateKey(e);
      if (endYmd === addLocalDateKey(localDateKey(s), 1)) {
        return `全天 ${label}`;
      }
      return `全天 ${label} ~ ${e.getMonth() + 1}/${e.getDate()}`;
    }
    return `全天 ${label}`;
  }
  if (todo.start_at) {
    const s = new Date(todo.start_at);
    const hm = (d: Date) =>
      `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const dateLabel = `${s.getMonth() + 1}/${s.getDate()}`;
    if (!todo.end_at) return `${dateLabel} ${hm(s)}`;
    const e = new Date(todo.end_at);
    const sameDay =
      s.getFullYear() === e.getFullYear() &&
      s.getMonth() === e.getMonth() &&
      s.getDate() === e.getDate();
    return sameDay
      ? `${dateLabel} ${hm(s)}~${hm(e)}`
      : `${dateLabel} ${hm(s)} ~ ${e.getMonth() + 1}/${e.getDate()} ${hm(e)}`;
  }
  return "待排期";
}

function formatFullDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatFullDateTime(d: Date) {
  return `${formatFullDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatMd(d: Date) {
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

/** Excel 用：日期只显示到天，如 08/11；无日期显示待排期 */
function formatDayLabel(dateIso: string | null): string {
  if (!dateIso) return "待排期";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) return dateIso;
  return `${m[2]}/${m[3]}`;
}

/** 下一周期边界：日报=明天，周报=下周（周一~周日），月报=下月 */
export function nextPeriodBounds(
  type: ReportType,
  input: string,
): { startKey: string; endKey: string } | null {
  if (type === "month") {
    const m = /^(\d{4})-(\d{2})$/.exec(input);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const start = new Date(y, mo, 1);
    const end = new Date(y, mo + 1, 0, 23, 59, 59, 999);
    return { startKey: localDateKey(start), endKey: localDateKey(end) };
  }
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!d) return null;
  if (type === "day") {
    const next = addLocalDateKey(`${d[1]}-${d[2]}-${d[3]}`, 1);
    return { startKey: next, endKey: next };
  }
  const base = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
  const { start, end } = getOverviewBounds("week", base);
  return {
    startKey: addLocalDateKey(localDateKey(start), 7),
    endKey: addLocalDateKey(localDateKey(end), 7),
  };
}

/** 下一周期的计划任务：未开始且排期落在下一周期 */
export function nextPlanTasks(data: ReportDataLike): ReportTask[] {
  const bounds = nextPeriodBounds(data.type, data.input);
  if (!bounds) return [];
  return data.spaces
    .flatMap((g) => g.tasks)
    .filter(
      (t) =>
        t.status === "todo" &&
        !!t.date_iso &&
        t.date_iso >= bounds.startKey &&
        t.date_iso <= bounds.endKey,
    )
    .sort((a, b) =>
      (a.date_iso ?? "9999").localeCompare(b.date_iso ?? "9999"),
    );
}

/** 任务明细字段：Excel 使用的完整时间文本 + 展示用简短标签 */
function formatTaskLabels(todo: TodoRow): {
  time_label: string;
  report_date_label: string;
  date_iso: string | null;
  start_label: string | null;
  end_label: string | null;
  completed_label: string | null;
} {
  let start_label: string | null = null;
  let end_label: string | null = null;
  let completed_label: string | null = null;
  let report_date_label = "待排期";
  let date_iso: string | null = null;
  if (todo.completed_at) {
    const c = new Date(todo.completed_at);
    completed_label = formatFullDateTime(c);
    date_iso = localDateKey(c);
    report_date_label = formatMd(c);
  }
  if (todo.start_at) {
    const s = new Date(todo.start_at);
    if (todo.is_all_day) {
      start_label = formatFullDate(s);
      if (todo.end_at) {
        const e = new Date(todo.end_at);
        end_label = formatFullDate(e);
        const endMidnight =
          e.getHours() === 0 && e.getMinutes() === 0 && e.getSeconds() === 0;
        const lastDay = endMidnight
          ? new Date(e.getTime() - 60 * 1000)
          : e;
        if (!todo.completed_at) {
          date_iso = localDateKey(s);
          report_date_label =
            localDateKey(lastDay) !== localDateKey(s)
              ? `${formatMd(s)}~${formatMd(lastDay)}`
              : formatMd(s);
        }
      } else if (!todo.completed_at) {
        date_iso = localDateKey(s);
        report_date_label = formatMd(s);
      }
    } else {
      start_label = formatFullDateTime(s);
      end_label = todo.end_at
        ? formatFullDateTime(new Date(todo.end_at))
        : null;
      if (!todo.completed_at) {
        date_iso = localDateKey(s);
        report_date_label = formatMd(s);
      }
      if (todo.end_at && !todo.completed_at) {
        const e = new Date(todo.end_at);
        const sameDay =
          s.getFullYear() === e.getFullYear() &&
          s.getMonth() === e.getMonth() &&
          s.getDate() === e.getDate();
        report_date_label = sameDay
          ? formatMd(s)
          : `${formatMd(s)}~${formatMd(e)}`;
      }
    }
  }
  return {
    time_label: formatTimeLabel(todo),
    report_date_label,
    date_iso,
    start_label,
    end_label,
    completed_label,
  };
}

export function buildReportData(args: {
  type: ReportType;
  range: { start: Date; end: Date; input: string; rangeLabel: string };
  selectedSpaces: SpaceNavItem[];
  todos: TodoRow[];
  canAssignBySpace: Record<string, boolean>;
  userId: string;
}): ReportData {
  const { type, range, selectedSpaces, todos, canAssignBySpace, userId } = args;
  const spaceById = new Map(selectedSpaces.map((s) => [s.id, s]));
  const groups = new Map<string, ReportSpaceGroup>();

  for (const todo of todos) {
    const canAssign = canAssignBySpace[todo.space_id] === true;
    const assignedToMe = (todo.todo_assignees ?? []).some(
      (a) => a.user_id === userId,
    );
    if (!canAssign && !assignedToMe) continue;

    const space = spaceById.get(todo.space_id);
    const spaceName = space?.name ?? "空间";
    let group = groups.get(todo.space_id);
    if (!group) {
      group = {
        space_id: todo.space_id,
        space_name: spaceName,
        total: 0,
        counts: { done: 0, in_progress: 0, todo: 0 },
        tasks: [],
      };
      groups.set(todo.space_id, group);
    }
    const status = todo.status === "done" ? "done" : todo.status === "in_progress" ? "in_progress" : "todo";
    const labels = formatTaskLabels(todo);
    group.total += 1;
    group.counts[status] += 1;
    group.tasks.push({
      id: todo.id,
      title: todo.title,
      description: todo.description,
      description_display:
        todo.description?.trim() ||
        generateTaskDescription(
          todo.title,
          status,
          taskCategory(todo.title),
        ),
      priority: todo.priority,
      status,
      space_id: todo.space_id,
      space_name: spaceName,
      category: taskCategory(todo.title),
      time_label: labels.time_label,
      report_date_label: labels.report_date_label,
      date_iso: labels.date_iso,
      start_label: labels.start_label,
      end_label: labels.end_label,
      completed_label: labels.completed_label,
      progress_label:
        status === "done"
          ? "已完成"
          : status === "in_progress"
            ? "进行中"
            : "未开始",
      issue_label: "暂无",
      assignees: (todo.todo_assignees ?? [])
        .map((a) => a.profiles?.display_name?.trim() || "")
        .filter(Boolean),
    });
  }

  for (const group of groups.values()) {
    group.tasks.sort((a, b) => {
      const ai = REPORT_STATUS_ORDER.indexOf(a.status);
      const bi = REPORT_STATUS_ORDER.indexOf(b.status);
      if (ai !== bi) return ai - bi;
      return a.time_label.localeCompare(b.time_label, "zh-CN");
    });
  }

  const spaceGroups = [...groups.values()].sort((a, b) =>
    a.space_name.localeCompare(b.space_name, "zh-CN"),
  );
  const totals: ReportTotals = {
    done: 0,
    in_progress: 0,
    todo: 0,
    total: 0,
  };
  for (const g of spaceGroups) {
    totals.total += g.total;
    totals.done += g.counts.done;
    totals.in_progress += g.counts.in_progress;
    totals.todo += g.counts.todo;
  }

  const selectedSpacesLabel =
    selectedSpaces.length === 0
      ? "全部空间"
      : selectedSpaces.length === 1
        ? selectedSpaces[0].name
        : `已选 ${selectedSpaces.length} 个空间`;

  return {
    type,
    rangeLabel: range.rangeLabel,
    input: range.input,
    start: range.start,
    end: range.end,
    spaces: spaceGroups,
    totals,
    selectedSpacesLabel,
  };
}

/** 各周期“进展”章节标题 */
const REPORT_PROGRESS_LABEL: Record<ReportType, string> = {
  day: "今日工作进展",
  week: "本周工作进展",
  month: "本月工作进展",
};

/** 各周期“计划”章节标题 */
export const REPORT_NEXT_LABEL: Record<ReportType, string> = {
  day: "明天计划",
  week: "下周计划",
  month: "下月计划",
};

/** 按《周报规则》（supabase/services/api/zhoubaoguize）四段式生成报告文本 */
export function buildReportText(data: ReportDataLike): string {
  const typeLabel = REPORT_TYPE_LABEL[data.type];
  const allTasks = data.spaces.flatMap((g) => g.tasks);
  const done = allTasks.filter((t) => t.status === "done");
  const doing = allTasks.filter((t) => t.status === "in_progress");
  const plan = nextPlanTasks(data);

  if (allTasks.length === 0) {
    return `**${typeLabel} (${data.rangeLabel})**\n范围：${data.selectedSpacesLabel} · 0 项任务\n\n所选空间暂无任务。`;
  }

  const lines: string[] = [
    `**${typeLabel} (${data.rangeLabel})**`,
    `范围：${data.selectedSpacesLabel} · ${data.totals.total} 项任务（完成 ${data.totals.done} · 进行中 ${data.totals.in_progress} · 未开始 ${data.totals.todo}）`,
    "",
    `**一、${REPORT_PROGRESS_LABEL[data.type]}**（已完成 ${done.length} 项）`,
    ...done.map(
      (t) =>
        `* [${t.report_date_label}] ${t.title}：${t.description_display}`,
    ),
    "",
    `**二、进行中的工作**（${doing.length} 项）`,
    ...doing.map(
      (t) =>
        `* [${t.report_date_label}] ${t.title}：${t.description_display}`,
    ),
    "",
    "**三、遇到的问题与风险**",
    "* 暂无",
    "",
    `**四、${REPORT_NEXT_LABEL[data.type]}**（${plan.length} 项）`,
    ...plan.map(
      (t) =>
        `* [${t.report_date_label}] ${t.title}：${t.description_display}`,
    ),
  ];
  return lines.join("\n");
}

/** 按选中的任务 id 过滤报告数据，重新计算各空间与总计数 */
export function filterReportData(
  data: ReportDataLike,
  selectedIds: ReadonlySet<string>,
): ReportDataLike {
  const spaces = data.spaces
    .map((group) => {
      const tasks = group.tasks.filter((t) => selectedIds.has(t.id));
      const counts: Record<ReportStatus, number> = {
        done: 0,
        in_progress: 0,
        todo: 0,
      };
      for (const t of tasks) counts[t.status] += 1;
      return { ...group, tasks, total: tasks.length, counts };
    })
    .filter((g) => g.total > 0);
  const totals: ReportTotals = {
    total: 0,
    done: 0,
    in_progress: 0,
    todo: 0,
  };
  for (const g of spaces) {
    totals.total += g.total;
    totals.done += g.counts.done;
    totals.in_progress += g.counts.in_progress;
    totals.todo += g.counts.todo;
  }
  return { ...data, spaces, totals };
}

/** 导出文件名，如 周报_2026-08-10-2026-08-16.xls */
export function reportFileName(data: ReportDataLike): string {
  const base = REPORT_TYPE_LABEL[data.type];
  const range = data.rangeLabel
    .replace(/[/~]+/g, "-")
    .replace(/\s+/g, "");
  return `${base}_${range}.xls`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 生成 Excel 2003 XML（SpreadsheetML）。无第三方依赖，
 * Excel / WPS 可直接打开，含「报告汇总」与「任务明细」两个工作表。
 */
export function buildReportXlsxXml(
  data: ReportDataLike,
  opts?: { taskPlainText?: Record<string, string> },
): string {
  const typeLabel = REPORT_TYPE_LABEL[data.type];
  const title = `【${typeLabel}】${data.rangeLabel}`;
  const subtitle = `范围：${data.selectedSpacesLabel} · ${data.totals.total} 项任务（完成 ${data.totals.done} · 进行中 ${data.totals.in_progress} · 未开始 ${data.totals.todo}）`;
  const taskPlainText = opts?.taskPlainText ?? {};

  // 汇总表：部门 + 分类 + 日期（只到天）+ 任务
  const summaryHeader = ["部门", "分类", "日期", "任务"];
  const detailHeader = [
    "部门",
    "分类",
    "日期",
    "任务",
    "时间",
    "完成进展",
    "遇到的问题",
    "状态",
    "描述",
  ];
  const planHeader = ["部门", "分类", "日期", "任务", "描述"];

  const textCell = (text: string, style = "Cell") =>
    `<Cell ss:StyleID="${style}"><Data ss:Type="String">${xmlEscape(text)}</Data></Cell>`;
  const linkCell = (text: string, href: string, style = "Link") =>
    `<Cell ss:StyleID="${style}" ss:HRef="${href}"><Data ss:Type="String">${xmlEscape(text)}</Data></Cell>`;
  const headCell = (text: string) =>
    `<Cell ss:StyleID="Header"><Data ss:Type="String">${xmlEscape(text)}</Data></Cell>`;
  const mergedCell = (text: string, style: string, span: number) =>
    `<Cell ss:StyleID="${style}" ss:MergeAcross="${span}"><Data ss:Type="String">${xmlEscape(text)}</Data></Cell>`;
  const dataRow = (cells: string[]) => `<Row ss:Height="20">${cells.join("")}</Row>`;
  const headerRow = (headers: string[]) =>
    `<Row ss:Height="24">${headers.map(headCell).join("")}</Row>`;
  // 任务栏统一用大白话：优先 AI 改写，缺失时按任务名称规则生成
  const plainLabel = (task: ReportTask) =>
    taskPlainText[task.id] ||
    generateResultDescription(task.title, task.status, task.category);

  // 两个工作表前 4 行固定为标题/范围/空行/表头，数据从第 5 行开始
  const header4 = (titleText: string, subtitleText: string, headers: string[], span: number) => [
    `<Row ss:Height="30">${mergedCell(titleText, "Title", span)}</Row>`,
    `<Row ss:Height="18">${mergedCell(subtitleText, "Subtitle", span)}</Row>`,
    `<Row ss:Height="8">${mergedCell("", "Subtitle", span)}</Row>`,
    headerRow(headers),
  ];

  const summaryRows = header4(
    title,
    subtitle,
    summaryHeader,
    summaryHeader.length - 1,
  );
  let detailRow = 5;
  data.spaces.flatMap((g) => g.tasks).forEach((task, idx) => {
    const z = idx % 2 === 1;
    summaryRows.push(
      dataRow([
        textCell(task.space_name, z ? "ZebraCenter" : "Center"),
        textCell(categoryLabel(task.category), z ? "ZebraCenter" : "Center"),
        textCell(formatDayLabel(task.date_iso), z ? "ZebraCenter" : "Center"),
        linkCell(
          plainLabel(task),
          `#任务明细!A${detailRow}`,
          z ? "ZebraLink" : "Link",
        ),
      ]),
    );
    detailRow += 1;
  });

  const detailRows = header4(
    title,
    subtitle,
    detailHeader,
    detailHeader.length - 1,
  );
  data.spaces.flatMap((g) => g.tasks).forEach((task, idx) => {
    const z = idx % 2 === 1;
    detailRows.push(
      dataRow([
        textCell(task.space_name, z ? "ZebraCenter" : "Center"),
        textCell(categoryLabel(task.category), z ? "ZebraCenter" : "Center"),
        textCell(formatDayLabel(task.date_iso), z ? "ZebraCenter" : "Center"),
        textCell(plainLabel(task), z ? "Zebra" : "Cell"),
        textCell(formatDayLabel(task.date_iso), z ? "Zebra" : "Cell"),
        textCell(task.progress_label, z ? "ZebraCenter" : "Center"),
        textCell(task.issue_label, z ? "Zebra" : "Cell"),
        textCell(
          REPORT_STATUS_LABEL[task.status],
          z ? "ZebraCenter" : "Center",
        ),
        textCell(task.description_display, z ? "Zebra" : "Cell"),
      ]),
    );
  });

  // 下周 / 下月 / 明天计划工作表（按《周报规则》第四节）
  const planSheetName = REPORT_NEXT_LABEL[data.type];
  const planTasks = nextPlanTasks(data);
  const planRows = header4(
    `【${typeLabel}】${data.rangeLabel} · ${planSheetName}`,
    `计划任务 ${planTasks.length} 项（未开始）`,
    planHeader,
    planHeader.length - 1,
  );
  planTasks.forEach((task, idx) => {
    const z = idx % 2 === 1;
    planRows.push(
      dataRow([
        textCell(task.space_name, z ? "ZebraCenter" : "Center"),
        textCell(categoryLabel(task.category), z ? "ZebraCenter" : "Center"),
        textCell(formatDayLabel(task.date_iso), z ? "ZebraCenter" : "Center"),
        textCell(plainLabel(task), z ? "Zebra" : "Cell"),
        textCell(task.description_display, z ? "Zebra" : "Cell"),
      ]),
    );
  });

  const thinBorder =
    `<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="${LOGO_CYAN_BORDER}"/></Borders>`;
  const wsOptions =
    `<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><PageSetup><Orientation>Landscape</Orientation><FitToPage/><FitWidth>1</FitWidth><FitHeight>0</FitHeight></PageSetup><FreezePanes><FreezeRows>4</FreezeRows><FreezeColumns>1</FreezeColumns></FreezePanes></WorksheetOptions>`;

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<?mso-application progid="Excel.Sheet"?>`,
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">`,
    `<Styles>`,
    `<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="微软雅黑" ss:Size="10" ss:Color="#1F2937"/></Style>`,
    `<Style ss:ID="Title"><Alignment ss:Vertical="Center"/><Font ss:FontName="微软雅黑" ss:Size="14" ss:Bold="1" ss:Color="${LOGO_CYAN}"/><Interior ss:Color="${LOGO_CYAN_TITLE_BG}" ss:Pattern="Solid"/></Style>`,
    `<Style ss:ID="Subtitle"><Alignment ss:Vertical="Center"/><Font ss:FontName="微软雅黑" ss:Size="10" ss:Color="#6B7280"/></Style>`,
    `<Style ss:ID="Header"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="微软雅黑" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="${LOGO_CYAN}" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="${LOGO_CYAN_DARK}"/></Borders></Style>`,
    `<Style ss:ID="Cell"><Alignment ss:Vertical="Center"/><Font ss:FontName="微软雅黑" ss:Size="10" ss:Color="#1F2937"/>${thinBorder}</Style>`,
    `<Style ss:ID="Center"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="微软雅黑" ss:Size="10" ss:Color="#1F2937"/>${thinBorder}</Style>`,
    `<Style ss:ID="Zebra"><Alignment ss:Vertical="Center"/><Font ss:FontName="微软雅黑" ss:Size="10" ss:Color="#1F2937"/><Interior ss:Color="${LOGO_CYAN_ZEBRA}" ss:Pattern="Solid"/>${thinBorder}</Style>`,
    `<Style ss:ID="ZebraCenter"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="微软雅黑" ss:Size="10" ss:Color="#1F2937"/><Interior ss:Color="${LOGO_CYAN_ZEBRA}" ss:Pattern="Solid"/>${thinBorder}</Style>`,
    `<Style ss:ID="Link"><Alignment ss:Vertical="Center"/><Font ss:FontName="微软雅黑" ss:Size="10" ss:Color="${LOGO_CYAN}" ss:Underline="Single"/>${thinBorder}</Style>`,
    `<Style ss:ID="ZebraLink"><Alignment ss:Vertical="Center"/><Font ss:FontName="微软雅黑" ss:Size="10" ss:Color="${LOGO_CYAN}" ss:Underline="Single"/><Interior ss:Color="${LOGO_CYAN_ZEBRA}" ss:Pattern="Solid"/>${thinBorder}</Style>`,
    `</Styles>`,
    `<Worksheet ss:Name="报告汇总"><Table>`,
    `<Column ss:Width="120"/><Column ss:Width="90"/><Column ss:Width="80"/><Column ss:Width="320"/>`,
    summaryRows.join(""),
    `</Table>${wsOptions}</Worksheet>`,
    `<Worksheet ss:Name="任务明细"><Table>`,
    `<Column ss:Width="120"/><Column ss:Width="80"/><Column ss:Width="80"/><Column ss:Width="220"/><Column ss:Width="170"/><Column ss:Width="80"/><Column ss:Width="120"/><Column ss:Width="80"/><Column ss:Width="240"/>`,
    detailRows.join(""),
    `</Table>${wsOptions}</Worksheet>`,
    `<Worksheet ss:Name="${planSheetName}"><Table>`,
    `<Column ss:Width="120"/><Column ss:Width="90"/><Column ss:Width="80"/><Column ss:Width="260"/><Column ss:Width="320"/>`,
    planRows.join(""),
    `</Table>${wsOptions}</Worksheet>`,
    `</Workbook>`,
  ].join("\n");
}
