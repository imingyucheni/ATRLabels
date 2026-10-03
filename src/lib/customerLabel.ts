/** 下拉框里的客户名：有重名时在后面加上编号（#id），否则分不清 */
export function customerLabeler(list: { id: number; name: string }[]): (c: { id: number; name: string }) => string {
  const count = new Map<string, number>();
  for (const c of list) count.set(c.name, (count.get(c.name) ?? 0) + 1);
  return (c) => ((count.get(c.name) ?? 0) > 1 ? `${c.name} #${c.id}` : c.name);
}
