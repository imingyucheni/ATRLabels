/**
 * 官网“营业时间”是后台手填的中文（例如“周一至周五 9:00–18:00（美西时间）”）：
 * 英文页面按常见写法自动转成英文（Mon–Fri 9:00–18:00 (Pacific Time)）。
 */
const DAYS: [RegExp, string][] = [
  [/(周|星期|礼拜)一/g, "Mon"], [/(周|星期|礼拜)二/g, "Tue"], [/(周|星期|礼拜)三/g, "Wed"], [/(周|星期|礼拜)四/g, "Thu"],
  [/(周|星期|礼拜)五/g, "Fri"], [/(周|星期|礼拜)六/g, "Sat"], [/(周|星期|礼拜)[日天]/g, "Sun"],
];
const WORDS: [RegExp, string][] = [
  [/[（(]\s*美西时间\s*[）)]/g, " (Pacific Time)"], [/美西时间|太平洋时间/g, "Pacific Time"],
  [/[（(]\s*美东时间\s*[）)]/g, " (Eastern Time)"], [/美东时间/g, "Eastern Time"],
  [/[（(]\s*北京时间\s*[）)]/g, " (Beijing Time)"], [/北京时间/g, "Beijing Time"],
  [/法定?节假日(休息|除外)/g, "closed on public holidays"], [/节假日(休息|除外)/g, "closed on holidays"],
  [/全年无休/g, "open every day"], [/每天|每日/g, "Daily"], [/工作日/g, "Weekdays"], [/周末/g, "Weekends"],
  [/上午/g, "AM "], [/下午/g, "PM "], [/休息/g, "closed"],
];

export function hoursToEnglish(zh: string): string {
  let s = zh;
  for (const [re, en] of DAYS) s = s.replace(re, en);
  s = s.replace(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*(至|到|~|～|-|—)\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/g, "$1–$3");
  for (const [re, en] of WORDS) s = s.replace(re, en);
  return s.replace(/[，、；]/g, ", ").replace(/：/g, ": ").replace(/\s{2,}/g, " ").replace(/\s+([,)])/g, "$1").trim();
}
