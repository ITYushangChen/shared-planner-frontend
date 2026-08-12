import type { Cell, Workbook, Worksheet } from "exceljs";
import {
  REPORT_NEXT_LABEL,
  REPORT_STATUS_LABEL,
  REPORT_TYPE_LABEL,
  categoryLabel,
  formatDayLabel,
  generateResultDescription,
  nextPlanTasks,
  type ReportDataLike,
  type ReportTask,
} from "./reports";

/** Logo 主色（与页面 / XML 导出一致） */
const LOGO_CYAN = "#007080";
const LOGO_CYAN_DARK = "#005663";
const LOGO_CYAN_TITLE_BG = "#DFEEF0";
const LOGO_CYAN_ZEBRA = "#EFF6F7";
const LOGO_CYAN_BORDER = "#C9DDE0";

const FONT = "微软雅黑";
const LOGO_URL = "/开拓隆海logo.png";
const LOGO_DISPLAY_WIDTH = 240;
const LOGO_DISPLAY_HEIGHT = 69;

type XlsxNamespace = typeof import("exceljs");
type CellStyle =
  | "title"
  | "subtitle"
  | "header"
  | "cell"
  | "center"
  | "zebra"
  | "zebraCenter"
  | "link"
  | "zebraLink";

function argb(hex: string): string {
  return `FF${hex.replace(/^#/, "")}`;
}

/** 浏览器端动态加载 exceljs，避免把库带进服务端渲染包 */
async function createWorkbook(): Promise<Workbook> {
  const mod = (await import("exceljs")) as XlsxNamespace & {
    default?: XlsxNamespace;
  };
  const ns = mod.default ?? mod;
  return new ns.Workbook();
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchLogoBase64(): Promise<string | null> {
  try {
    const res = await fetch(LOGO_URL);
    if (!res.ok) return null;
    return arrayBufferToBase64(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function applyStyle(cell: Cell, kind: CellStyle): void {
  const center =
    kind === "center" ||
    kind === "zebraCenter" ||
    kind === "header";
  const zebra = kind === "zebra" || kind === "zebraCenter" || kind === "zebraLink";
  const link = kind === "link" || kind === "zebraLink";
  const title = kind === "title";

  cell.alignment = {
    vertical: "middle",
    horizontal: center ? "center" : "left",
    wrapText: !center && !title,
  };

  if (kind === "header") {
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: argb(LOGO_CYAN) },
    };
    cell.border = {
      bottom: { style: "medium", color: { argb: argb(LOGO_CYAN_DARK) } },
    };
    return;
  }

  cell.border = {
    bottom: { style: "thin", color: { argb: argb(LOGO_CYAN_BORDER) } },
  };

  if (title) {
    cell.font = { name: FONT, size: 14, bold: true, color: { argb: argb(LOGO_CYAN) } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: argb(LOGO_CYAN_TITLE_BG) },
    };
    return;
  }
  if (kind === "subtitle") {
    cell.font = { name: FONT, size: 10, color: { argb: "FF6B7280" } };
    return;
  }
  if (zebra) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: argb(LOGO_CYAN_ZEBRA) },
    };
  }
  cell.font = {
    name: FONT,
    size: 10,
    color: { argb: argb(link ? LOGO_CYAN : "#1F2937") },
    underline: link,
  };
}

type SheetCell = { text: string; kind: CellStyle; target?: string };

/**
 * 生成带公司 Logo 的 .xlsx（Excel / WPS 可直接打开）。
 * 三个工作表：报告汇总 / 任务明细 / 下一周期计划，前 5 行为
 * Logo、标题、范围、空行、表头，数据从第 6 行开始。
 */
export async function buildReportXlsx(
  data: ReportDataLike,
  opts?: { taskPlainText?: Record<string, string> },
): Promise<ArrayBuffer> {
  const wb = await createWorkbook();
  const typeLabel = REPORT_TYPE_LABEL[data.type];
  const title = `《${typeLabel}》${data.rangeLabel}`;
  const subtitle = `范围：${data.selectedSpacesLabel} · ${data.totals.total} 项任务（完成 ${data.totals.done} · 进行中 ${data.totals.in_progress} · 未开始 ${data.totals.todo}）`;
  const plainMap = opts?.taskPlainText ?? {};
  const plainLabel = (task: ReportTask) =>
    plainMap[task.id] ||
    generateResultDescription(task.title, task.status, task.category);

  const logoBase64 = await fetchLogoBase64();
  const logoId = logoBase64
    ? wb.addImage({ base64: logoBase64, extension: "png" })
    : undefined;

  const tasks = data.spaces.flatMap((g) => g.tasks);
  const planSheetName = REPORT_NEXT_LABEL[data.type];
  const planTasks = nextPlanTasks(data);

  const addSheet = (
    name: string,
    sheetTitle: string,
    sheetSubtitle: string,
    headers: string[],
    widths: number[],
    rows: SheetCell[][],
  ): void => {
    const ws: Worksheet = wb.addWorksheet(name);
    ws.columns = widths.map((w) => ({ width: w }));
    ws.views = [{ state: "frozen", ySplit: 5, xSplit: 1 }];
    ws.pageSetup = {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };

    if (logoId !== undefined) {
      ws.addImage(logoId, {
        tl: { col: 0, row: 0 },
        ext: { width: LOGO_DISPLAY_WIDTH, height: LOGO_DISPLAY_HEIGHT },
      });
    }

    ws.getRow(1).height = 52;
    ws.getRow(2).height = 30;
    ws.getRow(3).height = 18;
    ws.getRow(4).height = 8;
    ws.getRow(5).height = 24;

    ws.mergeCells(2, 1, 2, headers.length);
    const titleCell = ws.getCell(2, 1);
    titleCell.value = sheetTitle;
    applyStyle(titleCell, "title");

    ws.mergeCells(3, 1, 3, headers.length);
    const subtitleCell = ws.getCell(3, 1);
    subtitleCell.value = sheetSubtitle;
    applyStyle(subtitleCell, "subtitle");

    headers.forEach((h, i) => {
      const cell = ws.getCell(5, i + 1);
      cell.value = h;
      applyStyle(cell, "header");
    });

    rows.forEach((cells, idx) => {
      const r = 6 + idx;
      ws.getRow(r).height = 20;
      cells.forEach((item, ci) => {
        const cell = ws.getCell(r, ci + 1);
        cell.value = item.target
          ? { text: item.text, hyperlink: item.target }
          : item.text;
        applyStyle(cell, item.kind);
      });
    });
  };

  const summaryHeader = ["部门", "分类", "日期", "任务"];
  const detailHeader = [
    "部门",
    "分类",
    "日期",
    "任务",
    "时间",
    "完成进度",
    "遇到的问题",
    "状态",
    "描述",
  ];
  const planHeader = ["部门", "分类", "日期", "任务", "描述"];

  addSheet(
    "报告汇总",
    title,
    subtitle,
    summaryHeader,
    [20, 15, 13, 53],
    tasks.map((task, idx) => [
      { text: task.department || "通用", kind: idx % 2 ? "zebraCenter" : "center" },
      {
        text: categoryLabel(task.category),
        kind: idx % 2 ? "zebraCenter" : "center",
      },
      {
        text: formatDayLabel(task.date_iso),
        kind: idx % 2 ? "zebraCenter" : "center",
      },
      {
        text: plainLabel(task),
        kind: idx % 2 ? "zebraLink" : "link",
        target: `任务明细!A${6 + idx}`,
      },
    ]),
  );

  addSheet(
    "任务明细",
    title,
    subtitle,
    detailHeader,
    [20, 13, 13, 37, 28, 13, 20, 13, 40],
    tasks.map((task, idx) => {
      const z = idx % 2 === 1;
      return [
        { text: task.department || "通用", kind: z ? "zebraCenter" : "center" },
        { text: categoryLabel(task.category), kind: z ? "zebraCenter" : "center" },
        { text: formatDayLabel(task.date_iso), kind: z ? "zebraCenter" : "center" },
        { text: plainLabel(task), kind: z ? "zebra" : "cell" },
        { text: formatDayLabel(task.date_iso), kind: z ? "zebra" : "cell" },
        { text: task.progress_label, kind: z ? "zebraCenter" : "center" },
        { text: task.issue_label, kind: z ? "zebra" : "cell" },
        {
          text: REPORT_STATUS_LABEL[task.status],
          kind: z ? "zebraCenter" : "center",
        },
        { text: task.description_display, kind: z ? "zebra" : "cell" },
      ];
    }),
  );

  addSheet(
    planSheetName,
    `《${typeLabel}》${data.rangeLabel} · ${planSheetName}`,
    `计划任务 ${planTasks.length} 项（未开始）`,
    planHeader,
    [20, 15, 13, 43, 53],
    planTasks.map((task, idx) => {
      const z = idx % 2 === 1;
      return [
        { text: task.department || "通用", kind: z ? "zebraCenter" : "center" },
        { text: categoryLabel(task.category), kind: z ? "zebraCenter" : "center" },
        { text: formatDayLabel(task.date_iso), kind: z ? "zebraCenter" : "center" },
        { text: plainLabel(task), kind: z ? "zebra" : "cell" },
        { text: task.description_display, kind: z ? "zebra" : "cell" },
      ];
    }),
  );

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
