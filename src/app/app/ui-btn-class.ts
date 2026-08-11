/** 主按钮：近黑实心 */
export function primaryBtnClass(extra = "") {
  return [
    "rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white",
    "transition-all duration-200 hover:bg-zinc-800 disabled:opacity-50",
    "active:scale-[0.98]",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

/** 主按钮胶囊 */
export function primaryPillClass(extra = "") {
  return [
    "shrink-0 rounded-full px-4 py-2 text-sm font-medium text-white",
    "bg-zinc-900 transition-all duration-200",
    "hover:bg-zinc-800 active:scale-[0.98]",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

/** 次按钮：暗蓝描边 */
export function secondaryBtnClass(extra = "") {
  return [
    "rounded-xl border border-[#2f5f8f]/55 bg-white px-3 py-2 text-sm font-medium text-[#2f5f8f]",
    "transition-all duration-200 hover:bg-[#e8f0f7] disabled:opacity-50",
    "active:scale-[0.98]",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

/** 次按钮胶囊 */
export function secondaryPillClass(active = false, extra = "") {
  return [
    "shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200",
    "active:scale-[0.98]",
    active
      ? "bg-zinc-900 text-white hover:bg-zinc-800"
      : "border border-[#2f5f8f]/55 bg-white text-[#2f5f8f] hover:bg-[#e8f0f7]",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

/** 筛选芯片：选中近黑 / 未选暗蓝描边 */
export function chipClass(active: boolean) {
  return [
    "inline-flex h-8 shrink-0 items-center rounded-full px-3 text-sm font-medium",
    "transition-colors duration-200",
    active
      ? "bg-zinc-900 text-white"
      : "border border-[#2f5f8f]/50 bg-white text-[#2f5f8f] hover:bg-[#e8f0f7]",
  ].join(" ");
}
