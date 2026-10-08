import { currentAdmin, currentCustomerId } from "@/lib/auth";
import { getLang } from "@/lib/prefs";
import { runQuoteStream, type QuoteStreamEvent, type QuoteStreamInput, type QuoteStreamWho } from "@/lib/quoteStream";

export const dynamic = "force-dynamic";

/**
 * 下单页“查询运费”：边查边报（NDJSON，一行一个事件）。
 * 每个渠道查完马上发过去，页面先显示快的渠道；地址核对结果单独发；最后发完整列表。
 * 客户 OMS 用客户登录，其他用后台登录；权限和原来的报价 action 一样（在 runQuoteStream 里检查）。
 */
export async function POST(request: Request) {
  const input = (await request.json().catch(() => null)) as QuoteStreamInput | null;
  if (!input || typeof input !== "object" || !input.req) return Response.json({ error: "请求格式不对" }, { status: 400 });
  let who: QuoteStreamWho;
  if (input.mode === "portal") {
    const id = await currentCustomerId();
    if (!id) return Response.json({ error: "请先登录" }, { status: 401 });
    who = { kind: "customer", customerId: id };
  } else {
    const admin = await currentAdmin();
    if (!admin) return Response.json({ error: "请先登录后台" }, { status: 401 });
    who = { kind: "admin", admin };
  }
  const lang = await getLang();
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: QuoteStreamEvent) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          // 页面已经关了：不用再发
        }
      };
      try {
        await runQuoteStream(who, input, emit, lang);
      } catch (e) {
        emit({ t: "err", errors: [(e as Error).message] });
      } finally {
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // 不要被压缩或缓冲（否则要等全部查完才一起到）
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
