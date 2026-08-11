import { secondaryPillClass } from "./ui-btn-class";

/** 未激活白底描边 / 激活品牌色（旁路开关按钮） */
export function toggleBtnClass(active: boolean) {
  return secondaryPillClass(active);
}
