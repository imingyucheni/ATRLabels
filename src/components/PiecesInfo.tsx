import { getT } from "@/lib/prefs";
import { multiBoxRule, summarizePieces, type Piece } from "@/lib/multiBox";

/** 面单详情：多箱寄出的箱规明细 + 整票取消提醒（不是多箱的单不显示） */
export default async function PiecesInfo({ pieces, channelName }: { pieces?: Piece[]; channelName?: string | null }) {
  if (!pieces?.length) return null;
  const t = await getT();
  const rule = multiBoxRule(channelName);
  const sum = summarizePieces(pieces, rule);
  return (
    <>
      <p>
        <b>{t("多箱寄出")}</b>{t("：")}{t("{boxes} 箱，总实重 {lb} lb，预计计费重 {bill} lb", { boxes: sum.boxes, lb: sum.actual, bill: sum.billable })}
      </p>
      <div className="table-wrap">
        <table className="list">
          <thead><tr><th>{t("箱规")}</th><th>{t("尺寸 (in)")}</th><th className="num">{t("单箱重量 (lb)")}</th><th className="num">{t("箱数")}</th><th className="num">{t("小计重量")}</th></tr></thead>
          <tbody>
            {pieces.map((p, i) => (
              <tr key={i}>
                <td>{String.fromCharCode(65 + (i % 26))}</td>
                <td>{p.length} × {p.width} × {p.height}</td>
                <td className="num">{p.weight}</td>
                <td className="num">{p.qty}</td>
                <td className="num">{Math.round(p.weight * p.qty * 100) / 100} lb</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="alert warn small" style={{ marginTop: 8 }}>{t("多箱面单取消要整票取消；申请取消后，这票的所有面单都要作废，不能再贴，否则会丢件并按公布价计费。")}</div>
    </>
  );
}
