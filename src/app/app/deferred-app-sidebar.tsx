"use client";

import type { ComponentProps } from "react";
import { AppSidebar } from "./app-sidebar";

/** 同步挂载侧栏，避免 dynamic 拆包导致导航入口晚就绪 */
export function DeferredAppSidebar(
  props: ComponentProps<typeof AppSidebar>,
) {
  return <AppSidebar {...props} />;
}
