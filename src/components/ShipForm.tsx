"use client";

import ChannelLabel, { useChannelDisplay } from "@/components/ChannelLabel";
import AddressCheckPanel from "@/components/AddressCheckPanel";
import type { AddressCheck } from "@/lib/addressCheck";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { houseCreateAction, resubmitCreateAction } from "@/app/actions";
import type { SavedSender } from "@/lib/senders";
import { portalCreateAction, portalReorderAction, saveSenderBookAction } from "@/app/portal/actions";
import type { PublicQuote } from "@/lib/portal";
import AddressFields, { SENDER_EXAMPLE } from "@/components/AddressFields";
import { useT, useTMsg } from "@/components/I18n";
import { money, signedPercent } from "@/lib/pricing";
import type { ChannelQuote } from "@/lib/service";
import type { Address, ShipmentRequest, UnitSystem } from "@/lib/shipbest/types";
import type { RecentPackage, SkuPreset } from "@/lib/portal";
import type { OrderDraft } from "@/lib/drafts";
import { DIM_UNITS, isDimUnit, isWeightUnit, toSystem, unitsOf, WEIGHT_UNITS, type DimUnit, type WeightUnit } from "@/lib/units";

const UNIT_PREF = "atr_pkg_units";
import { deleteDraftAction, saveDraftAction, type DraftScope } from "@/app/draftActions";
import { customerLabeler } from "@/lib/customerLabel";

type Sku = Record<"sku" | "productNameCn" | "productNameEn" | "quantity" | "declaredUnitPrice" | "hsCode" | "productNature" | "originCountry" | "material", string>;

const emptySku = (): Sku => ({
  sku: "",
  productNameCn: "",
  productNameEn: "",
  quantity: "1",
  declaredUnitPrice: "",
  hsCode: "",
  productNature: "2,4",
  originCountry: "",
  material: "",
});

const NATURE = [
  ["1", "带磁"],
  ["2", "不带磁"],
  ["3", "带电"],
  ["4", "不带电"],
  ["5", "液体"],
] as const;

/** 常用商品性质：大部分是普货（不带磁、不带电），特殊的再选 */
const NATURE_PRESETS = [
  { value: "2,4", label: "普货（无特殊）" },
  { value: "2,3", label: "带电" },
  { value: "1,4", label: "带磁" },
  { value: "1,3", label: "带磁 + 带电" },
  { value: "2,4,5", label: "液体" },
];


/** 报价行：后台看到完整信息（成本、利润），客户端只有价格 */
type Quote = PublicQuote & Partial<Pick<ChannelQuote, "cost" | "listCost" | "rule" | "profit" | "zoneEstimated" | "ms">>;

/** 异常单修改后重新下单：原订单的信息（预填到表单里） */
export interface ResubmitSource {
  id: number;
  customerName: string;
  /** 公司自用账户（成本价） */
  house: boolean;
  channelCode: string;
  request: ShipmentRequest;
  remark: string | null;
  customerRef: string | null;
  /** 原单是已取消的（取消后重新下单），不是出单异常 */
  cancelled?: boolean;
  /** 出单成功后回到哪里（例如批量下单的批次页）；不填就打开新单 */
  returnTo?: string;
}

/** 进行中的秒数（查询运费 / 出单时显示“已等 X 秒”） */
function useElapsed(active: boolean) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!active) return setSec(0);
    const t0 = Date.now();
    const id = setInterval(() => setSec(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [active]);
  return sec;
}

/** 数字转成输入框里的文字（0 / 空显示为空） */
const numText = (v: number | null | undefined) => (v ? String(v) : "");

export default function ShipForm(props: {
  /** portal = 客户自助下单：不选客户、只显示客户价；house = 管理员按成本价下单（所有渠道）；resubmit = 异常单修改后重新下单 */
  mode?: "admin" | "portal" | "house" | "resubmit";
  resubmit?: ResubmitSource;
  /** 常用包裹尺寸（最近 90 天发过的，按次数排），点一下填好 */
  recentPackages?: RecentPackage[];
  /** 发过的商品：输入 SKU 自动带出品名、申报价、海关编码 */
  skuPresets?: SkuPreset[];
  /** 再来一单：复制一张以前的订单（地址、包裹、商品），订单号留空，正常下单 */
  copy?: { request: ShipmentRequest; remark: string | null };
  /** 国际下单（DHL）：收件国家默认空、商品明细多原产国、海关编码必填 */
  intl?: boolean;
  /** 原产国默认值（DHL 设置里的） */
  defaultOrigin?: string;
  /** 客户端：已取消的订单重新下单（预填原单信息，出单后批次里的这一行换成新单） */
  reorder?: { id: number; request: ShipmentRequest; customerRef: string | null; remark: string | null; returnTo?: string };
  customers?: { id: number; name: string; balance?: number; available?: number; sender?: Address | null; channelCount?: number }[];
  defaultCustomerId?: number;
  defaultSender: Address | null;
  /** 客户端：寄件地址簿 */
  senders?: SavedSender[];
  defaultUnit: UnitSystem;
  defaultCurrency: string;
  /** 客户端：账户余额、信用额度、余额规则（出单前提示扣款后余额，余额不够时不能点出单） */
  wallet?: { balance: number; creditLimit: number; rule: "positive" | "cover" };
  /** 可以“保存草稿”（客户自助 / 管理员自用下单）；draft = 打开的草稿，出单成功后自动删掉 */
  draftScope?: DraftScope;
  draft?: OrderDraft;
  /** 员工（二级管理员）试算：不显示成本、利润 */
  hideCost?: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const chName = useChannelDisplay();
  const tm = useTMsg();
  const portal = props.mode === "portal";
  const house = props.mode === "house";
  const re = props.mode === "resubmit" ? props.resubmit : undefined;
  // 按成本价出单的表格样式：管理员自用，或者重新下单的原单就是公司自用
  const costTable = house || !!re?.house;
  // 可以直接出单的模式（客户自助 / 管理员自用 / 异常单重新下单）
  const orderable = portal || house || !!re;
  const reorder = portal ? props.reorder : undefined;
  const init = re?.request ?? reorder?.request ?? props.draft?.request ?? props.copy?.request;
  const canDraft = !!props.draftScope && !re && !reorder;
  const customers = props.customers ?? [];
  // 后台默认不选客户，避免替错客户下单
  const [customerId, setCustomerId] = useState<number>(props.defaultCustomerId ?? 0);
  const [customerRef, setCustomerRef] = useState(re?.customerRef ?? reorder?.customerRef ?? props.draft?.customerRef ?? "");
  // 后台试算新客户时临时填写的加价（留空 = 全局 / 渠道设置）
  const [markup, setMarkup] = useState({ percent: "", fixed: "", minProfit: "" });
  const initialCustomer = customers.find((c) => c.id === props.defaultCustomerId);
  const [sender, setSender] = useState<Partial<Address>>(
    init?.sender ??
    props.senders?.find((x) => x.isDefault)?.address ??
      initialCustomer?.sender ??
      (props.defaultSender?.address1 ? props.defaultSender : { country: "US" }),
  );
  // 系统默认寄件地址（设置里的发货仓）要完整才能直接用
  const sysSender = props.defaultSender?.address1 && props.defaultSender?.zipCode ? props.defaultSender : null;
  const bookDefault = props.senders?.find((x) => x.isDefault);
  // 预填的寄件人（草稿 / 再来一单）：地址簿里有同一个地址就选中它，没有就当新地址
  const sameAddr = (a?: Partial<Address> | null, b?: Partial<Address> | null) =>
    !!a && !!b && (["nameFirst", "nameLast", "address1", "address2", "zipCode"] as const).every((k) => (a[k] ?? "").trim().toLowerCase() === (b[k] ?? "").trim().toLowerCase());
  const initSenderId: number | "new" | "system" | null = portal && init?.sender
    ? props.senders?.find((x) => sameAddr(x.address, init.sender))?.id ?? (sameAddr(sysSender, init.sender) ? "system" : "new")
    : null;
  const [editSender, setEditSender] = useState(initSenderId === "new" ? true : portal ? !bookDefault && !sysSender : re ? false : !props.defaultSender);
  const [senders, setSenders] = useState<SavedSender[]>(props.senders ?? []);
  const [senderId, setSenderId] = useState<number | "new" | "system">(initSenderId ?? bookDefault?.id ?? (sysSender ? "system" : "new"));
  const [senderMsg, setSenderMsg] = useState<string | null>(null);
  const [savingSender, startSaveSender] = useTransition();
  // 国际下单：收件国家先空着，让客户选
  const [recipient, setRecipient] = useState<Partial<Address>>(init?.recipient ?? { country: props.intl ? "" : "US" });
  const intlDest = !!recipient.country && recipient.country.toUpperCase() !== "US";
  // 尺寸、重量单位分开选（草稿里存了原来选的单位就用它）
  const initUnits = init?.pkg.dimUnit && init.pkg.weightUnit ? { dim: init.pkg.dimUnit, weight: init.pkg.weightUnit } : unitsOf(init?.pkg.displayUnitSystem ?? props.defaultUnit);
  const [dimU, setDimU] = useState<DimUnit>(initUnits.dim);
  const [wtU, setWtU] = useState<WeightUnit>(initUnits.weight);
  // 新订单：用这台电脑上次选的单位
  useEffect(() => {
    if (init) return;
    try {
      const v = JSON.parse(localStorage.getItem(UNIT_PREF) ?? "null");
      if (isDimUnit(v?.dim)) setDimU(v.dim);
      if (isWeightUnit(v?.weight)) setWtU(v.weight);
    } catch {
      /* 浏览器不让存就用默认 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pickUnits = (dim: DimUnit, weight: WeightUnit) => {
    dirty(setDimU)(dim);
    setWtU(weight);
    try {
      localStorage.setItem(UNIT_PREF, JSON.stringify({ dim, weight }));
    } catch {
      /* 忽略 */
    }
  };
  const [pkg, setPkg] = useState(
    init
      ? { length: numText(init.pkg.length), width: numText(init.pkg.width), height: numText(init.pkg.height), weight: numText(init.pkg.weight) }
      : { length: "", width: "", height: "", weight: "" },
  );
  const [signType, setSignType] = useState<number>(init?.pkg.signServiceType ?? 0);
  const [insurance, setInsurance] = useState({ on: !!init?.pkg.insuranceService, fee: numText(init?.pkg.insuranceFee) });
  const [currency, setCurrency] = useState(init?.pkg.currency || props.defaultCurrency);
  const [skus, setSkus] = useState<Sku[]>(
    init?.skuList.length
      ? init.skuList.map((k) => ({
          sku: k.sku ?? "",
          productNameCn: k.productNameCn ?? "",
          productNameEn: k.productNameEn ?? "",
          quantity: String(k.quantity || 1),
          declaredUnitPrice: numText(k.declaredUnitPrice),
          hsCode: k.hsCode ?? "",
          productNature: k.productNature || "2,4",
          originCountry: k.originCountry ?? "",
          material: k.material ?? "",
        }))
      : [emptySku()],
  );
  const [remark, setRemark] = useState(re?.remark ?? reorder?.remark ?? props.draft?.remark ?? props.copy?.remark ?? "");
  const [draftId, setDraftId] = useState<number | undefined>(props.draft?.id);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);
  const [savingDraft, startSaveDraft] = useTransition();

  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  // 默认显示全部渠道：送不到的也列出来（灰色、不能选、显示原因）
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // 边查边报：每个渠道查完就显示；pending = 还在查的渠道
  const [quoting, setQuoting] = useState(false);
  const [pending, setPending] = useState<{ code: string; name: string }[]>([]);
  const quoteRun = useRef(0);
  const quoteSec = useElapsed(quoting);
  const [creating, setCreating] = useState<string | null>(null);
  const creatingSec = useElapsed(!!creating);
  // 收件地址核对（USPS）
  const [addr, setAddr] = useState<AddressCheck | null>(null);
  const [addrAck, setAddrAck] = useState(false);
  const [requote, setRequote] = useState(false);

  const lu = dimU;
  const wu = wtU;

  // 表单内容变了，之前的报价作废
  const dirty = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setQuotes(null);
    setNotice(null);
    setAddr(null);
    setAddrAck(false);
  };

  /** forDraft：草稿存原始输入和选的单位（下次打开原样显示）；报价、出单换算成服务商认的单位组合 */
  function buildRequest(forDraft = false): ShipmentRequest {
    const num = (s: string) => Number(s) || 0;
    const totalQty = skus.reduce((a, s) => a + (num(s.quantity) || 1), 0) || 1;
    const conv = toSystem(dimU, wtU, num(pkg.weight));
    const unit = conv.system;
    return {
      sender: sender as Address,
      recipient: recipient as Address,
      pkg: {
        length: num(pkg.length),
        width: num(pkg.width),
        height: num(pkg.height),
        weight: forDraft ? num(pkg.weight) : conv.weight,
        displayUnitSystem: unit,
        ...(forDraft ? { dimUnit: dimU, weightUnit: wtU } : {}),
        signServiceType: signType as 0 | 1 | 2 | 3,
        insuranceService: insurance.on ? 1 : 0,
        insuranceFee: insurance.on ? num(insurance.fee) : undefined,
        currency,
      },
      // SKU 尺寸/重量用包裹数据按数量均摊（文档要求必填）
      skuList: skus.map((s) => ({
        sku: s.sku,
        productNameCn: s.productNameCn,
        productNameEn: s.productNameEn,
        quantity: num(s.quantity),
        declaredUnitPrice: num(s.declaredUnitPrice),
        declaredCurrency: currency,
        hsCode: s.hsCode,
        productNature: s.productNature,
        ...(s.originCountry.trim() ? { originCountry: s.originCountry.trim().toUpperCase() } : {}),
        ...(s.material.trim() ? { material: s.material.trim() } : {}),
        length: num(pkg.length),
        width: num(pkg.width),
        height: num(pkg.height),
        weight: Math.round((conv.weight / totalQty) * 1000) / 1000,
        unit,
      })),
    };
  }

  /**
   * 查询运费：边查边报（/api/quote/stream）。快的渠道先显示，可以直接下单；慢的渠道查完再补上；
   * 地址核对结果单独到，不拖住报价。最后用整理好的完整列表（补分区、排序）替换。
   */
  function onQuote() {
    setErrors([]);
    setNotice(null);
    setQuotes(null);
    setPending([]);
    setAddr(null);
    setAddrAck(false);
    setQuoting(true);
    const run = ++quoteRun.current;
    const optNum = (v: string) => (v.trim() === "" ? null : Number(v));
    const req = buildRequest();
    const body = portal
      ? { mode: "portal", req }
      : re
        ? { mode: "resubmit", oldId: re.id, req }
        : house
          ? { mode: "house", req }
          : { mode: "admin", customerId, req, markup: { percent: optNum(markup.percent), fixed: optNum(markup.fixed), minProfit: optNum(markup.minProfit) } };
    const scrollTo = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    const live = () => run === quoteRun.current; // 又点了一次查询：旧的结果不要了
    const sortQ = (list: Quote[]) => [...list].sort((a, b) => Number(b.ok) - Number(a.ok) || (a.price ?? 0) - (b.price ?? 0));
    let shown = false;
    let finished = false;
    void (async () => {
      try {
        const res = await fetch("/api/quote/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        const handle = (e: { t: string; channels?: { code: string; name: string }[]; q?: Quote; a?: AddressCheck; quotes?: Quote[]; errors?: string[] }) => {
          if (!live()) return;
          if (e.t === "start") {
            setPending(e.channels ?? []);
            setQuotes([]);
          } else if (e.t === "q" && e.q) {
            const q = e.q;
            setQuotes((list) => sortQ([...(list ?? []).filter((x) => x.channelCode !== q.channelCode), q]));
            setPending((list) => list.filter((c) => c.code !== q.channelCode));
            if (!shown) {
              shown = true;
              scrollTo("ship-quotes");
            }
          } else if (e.t === "addr" && e.a) {
            setAddr(e.a);
          } else if (e.t === "done") {
            finished = true;
            setQuotes(e.quotes ?? []);
            setPending([]);
            setQuoting(false);
          } else if (e.t === "err") {
            finished = true;
            setErrors(e.errors ?? []);
            setQuotes(null);
            setPending([]);
            setQuoting(false);
            scrollTo("ship-errors");
          }
        };
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (line) handle(JSON.parse(line));
          }
        }
        if (buf.trim()) handle(JSON.parse(buf));
      } catch {
        if (live() && !finished) {
          setErrors([t("查询运费失败（网络中断或服务器繁忙），请再点一次“查询运费”")]);
          scrollTo("ship-errors");
        }
      } finally {
        if (live()) {
          setQuoting(false);
          setPending([]);
        }
      }
    })();
  }

  // 客户端：这一单的运费扣完后余额是多少、够不够出单
  const wallet = portal ? props.wallet : undefined;
  const afford = (price: number) => {
    if (!wallet) return { ok: true, after: null as number | null };
    const available = wallet.balance + wallet.creditLimit;
    return { ok: wallet.rule === "positive" ? available > 0 : available >= price, after: Math.round((wallet.balance - price) * 100) / 100 };
  };

  // 采用 USPS 建议地址后自动重新查询
  useEffect(() => {
    if (requote) {
      setRequote(false);
      onQuote();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requote]);

  const addrNeedsAck = !!addr && ["missing_unit", "bad_unit", "not_found"].includes(addr.status);

  async function onCreate(q: Quote) {
    if (addrNeedsAck && !addrAck) {
      setErrors([t("收件地址可能有问题，请检查地址，或勾选“我确认地址无误”后再下单")]);
      document.getElementById("addr-check")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const msg = re?.cancelled
      ? t("确认用 {channel} 重新出单？\n{who}：{price}", { channel: q.channelName, who: re.house ? t("成本价") : t("客户价"), price: money(q.price, q.currency) })
      : re
      ? t("确认用 {channel} 重新出单？\n{who}：{price}\n出单成功后，原异常单会自动取消，费用退回。", { channel: q.channelName, who: re.house ? t("成本价") : t("客户价"), price: money(q.price, q.currency) })
      : house
      ? t("确认用 {channel} 出单？\n成本价：{price}（公司自用，不扣客户余额）", { channel: q.channelName, price: money(q.price, q.currency) })
      : (() => {
          const a = afford(q.price!);
          const base = t("确认用 {channel} 出单？\n运费：{price}", { channel: chName(q.channelCode, q.channelName).name, price: money(q.price, q.currency) });
          if (a.after === null) return `${base}${t("（从账户余额扣除）")}`;
          return `${base}\n${t("扣款后余额：{v}", { v: money(a.after, q.currency) })}${a.after < 0 ? `\n\n⚠ ${t("扣款后余额为负数，请尽快充值补足。")}` : ""}`;
        })();
    if (!window.confirm(msg)) return;
    setCreating(q.channelCode);
    setErrors([]);
    try {
      const args = { channelCode: q.channelCode, req: buildRequest(), expectedPrice: q.price!, remark, customerRef, addressAck: addrAck };
      const r = re ? await resubmitCreateAction({ ...args, oldId: re.id }) : house ? await houseCreateAction(args) : reorder ? await portalReorderAction({ ...args, oldId: reorder.id }) : await portalCreateAction(args);
      if (r.id) {
        // 从草稿出单成功：草稿不再需要
        if (draftId && props.draftScope) await deleteDraftAction({ scope: props.draftScope, id: draftId }).catch(() => undefined);
        router.push(re?.returnTo ?? reorder?.returnTo ?? (house || re ? `/shipments/${r.id}` : `/portal/shipments/${r.id}`));
        return;
      }
      if (r.quote) {
        // 价格变了：更新这一行，让员工重新确认
        setQuotes((qs) => qs?.map((x) => (x.channelCode === r.quote!.channelCode ? r.quote! : x)) ?? null);
        setNotice(r.error ?? null);
      } else {
        setErrors([r.error ?? t("出单失败")]);
      }
    } finally {
      setCreating(null);
    }
  }

  /** save = 保存 / 更新当前草稿；copy = 另存为一份新草稿；next = 保存后清空表单，接着填下一单 */
  function onSaveDraft(how: "save" | "copy" | "next" = "save") {
    if (!props.draftScope) return;
    const scope = props.draftScope;
    startSaveDraft(async () => {
      const r = await saveDraftAction({ scope, id: how === "copy" ? undefined : draftId, intl: !!props.intl, request: buildRequest(true), customerRef, remark });
      if (r.error) return setDraftMsg(r.error);
      if (how === "next") {
        // 换一个空白表单（?n= 让页面重新生成表单）
        router.push(`${window.location.pathname}?n=${Date.now()}`);
        return;
      }
      // 页面上方的草稿列表由服务端刷新（saveDraftAction 里 revalidatePath）；表单不重新加载，填的内容和报价都保留
      setDraftId(r.id);
      setDraftMsg(t("草稿已保存（{time}）。下次在页面上方的“草稿”里点“继续填写”。", { time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Los_Angeles" }) }));
    });
  }

  const setSku = (i: number, patch: Partial<Sku>) => dirty(setSkus)(skus.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const bestPrice = quotes?.filter((q) => q.ok).map((q) => q.price!)[0];

  const skuTable = (req: string) => (
    <>
            {!!props.skuPresets?.length && (
              <datalist id="sku-presets">
                {props.skuPresets.map((p) => <option key={p.sku} value={p.sku}>{p.productNameEn}{p.declaredUnitPrice ? ` · $${p.declaredUnitPrice}` : ""}</option>)}
              </datalist>
            )}
            <div className="table-wrap">
              <table className="sku-table">
                <thead>
                  {intlDest ? (
                    <tr><th>SKU{req}</th><th>{t("中文品名")}</th><th>{t("英文品名")}{req}</th><th>{t("数量")}{req}</th><th>{t("申报单价")}{req} (USD)</th><th>{t("海关编码")} *</th><th>{t("材质（英文）")} *</th><th>{t("原产国")}</th><th>{t("商品性质")}{req}</th><th></th></tr>
                  ) : (
                    // 美国国内件只要 SKU、品名、数量；申报价、商品性质出单时按默认值补
                    <tr><th>SKU <span className="th-note">{t("可打印在面单上")}</span></th><th>{t("品名")}</th><th>{t("数量")}</th><th></th></tr>
                  )}
                </thead>
                <tbody>
                  {skus.map((s, i) => (
                    <tr key={i}>
                      <td data-label={`SKU${req}`}>
                        <input
                          value={s.sku}
                          list={props.skuPresets?.length ? "sku-presets" : undefined}
                          onChange={(e) => {
                            const v = e.target.value;
                            // 输入 / 选中以前发过的 SKU：带出品名、申报价、海关编码等（数量不变）
                            const p = props.skuPresets?.find((x) => x.sku === v.trim());
                            setSku(i, p ? {
                              sku: v,
                              productNameCn: p.productNameCn === p.productNameEn ? "" : p.productNameCn,
                              productNameEn: p.productNameEn,
                              declaredUnitPrice: p.declaredUnitPrice ? String(p.declaredUnitPrice) : s.declaredUnitPrice,
                              hsCode: p.hsCode || s.hsCode,
                              productNature: p.productNature || s.productNature,
                              material: p.material || s.material,
                              originCountry: p.originCountry || s.originCountry,
                            } : { sku: v });
                          }}
                        />
                      </td>
                      {intlDest && <td data-label={t("中文品名")}><input value={s.productNameCn} placeholder={t("可不填，默认用英文品名")} onChange={(e) => setSku(i, { productNameCn: e.target.value })} /></td>}
                      <td data-label={intlDest ? t("英文品名") + req : t("品名")}><input value={s.productNameEn} placeholder={intlDest ? undefined : t("例如 T-shirt")} onChange={(e) => setSku(i, { productNameEn: e.target.value })} /></td>
                      <td data-label={t("数量") + req} style={{ width: 80 }}><input type="number" min="1" value={s.quantity} onChange={(e) => setSku(i, { quantity: e.target.value })} /></td>
                      {intlDest && <td data-label={t("申报单价") + req} style={{ width: 110 }}><input type="number" min="0" step="0.01" value={s.declaredUnitPrice} onChange={(e) => setSku(i, { declaredUnitPrice: e.target.value })} /></td>}
                      {intlDest && <td data-label={t("海关编码") + " *"} style={{ width: 130 }}><input value={s.hsCode} placeholder={t("例如 6109100010")} inputMode="numeric" onChange={(e) => setSku(i, { hsCode: e.target.value })} /></td>}
                      {intlDest && (
                        <td data-label={t("材质（英文）") + " *"} style={{ width: 150 }}><input value={s.material} maxLength={100} placeholder={t("例如 100% cotton")} onChange={(e) => setSku(i, { material: e.target.value })} /></td>
                      )}
                      {intlDest && (
                        <td data-label={t("原产国")} style={{ width: 90 }}><input value={s.originCountry} maxLength={2} placeholder={props.defaultOrigin || "CN"} onChange={(e) => setSku(i, { originCountry: e.target.value.toUpperCase() })} /></td>
                      )}
                      {intlDest && <td data-label={t("商品性质") + req} style={{ minWidth: 170 }} className="small full">
                        {(() => {
                          const preset = NATURE_PRESETS.find((p) => p.value === s.productNature)?.value ?? "custom";
                          return (
                            <>
                              <select value={preset} onChange={(e) => setSku(i, { productNature: e.target.value === "custom" ? s.productNature || "2,4" : e.target.value })}>
                                {NATURE_PRESETS.map((p) => <option key={p.value} value={p.value}>{t(p.label)}</option>)}
                                <option value="custom">{t("自定义…")}</option>
                              </select>
                              {preset === "custom" && (
                                <div style={{ marginTop: 4 }}>
                                  {NATURE.map(([code, label]) => {
                                    const set = new Set(s.productNature.split(",").filter(Boolean));
                                    return (
                                      <label key={code} style={{ marginRight: 8, whiteSpace: "nowrap" }}>
                                        <input
                                          type="checkbox"
                                          checked={set.has(code)}
                                          onChange={(e) => {
                                            // 带磁/不带磁、带电/不带电 互斥
                                            const opposite: Record<string, string> = { "1": "2", "2": "1", "3": "4", "4": "3" };
                                            if (e.target.checked) {
                                              set.add(code);
                                              if (opposite[code]) set.delete(opposite[code]);
                                            } else set.delete(code);
                                            setSku(i, { productNature: [...set].sort().join(",") });
                                          }}
                                        /> {t(label)}
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </td>}
                      <td className="full">{skus.length > 1 && <button className="small danger" onClick={() => dirty(setSkus)(skus.filter((_, j) => j !== i))}>{t("删除")}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="small" style={{ marginTop: 8 }} onClick={() => dirty(setSkus)([...skus, emptySku()])}>{t("＋ 添加商品")}</button>
    </>
  );

  return (
    <>
      <div className="card">
        <div className="row">
          {!orderable && (
            <label className="f" style={{ minWidth: 240 }}>
              <span>{t("按哪个客户的价格试算")}</span>
              <select
                value={customerId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  dirty(setCustomerId)(id);
                  // 换客户时带出该客户的默认寄件地址
                  const c = customers.find((x) => x.id === id);
                  setSender(c?.sender ?? props.defaultSender ?? {});
                }}
              >
                <option value={0}>{t("新客户 / 自定义加价")}</option>
                {customers.map((c, _i, all) => <option key={c.id} value={c.id}>{customerLabeler(all)(c)}</option>)}
              </select>
              {(() => {
                const c = customers.find((x) => x.id === customerId);
                return (
                  <>
                    {!c && <span className="small muted">{t("用所有已启用的渠道，按右边填写的加价试算")}</span>}
                    {c && <span className="small muted">{t("按这个客户已开通的渠道和他的加价试算")}</span>}
                    {c?.channelCount === 0 && (
                      <span className="small" style={{ color: "var(--warn)" }}>{t("未开通任何渠道，请先到")} <a href={`/customers/${c.id}?tab=pricing#channels`}>{t("客户详情")}</a> {t("开通")}</span>
                    )}
                  </>
                );
              })()}
            </label>
          )}
          {orderable ? (
            <>
              {re && (
                <label className="f" style={{ minWidth: 180 }}>
                  {t("客户")}
                  <input value={re.customerName} disabled />
                </label>
              )}
              <label className="f ref-f" style={{ minWidth: 200 }}>
                {house || re ? t("订单号（可选）") : t("我的订单号（可选）")}
                <input value={customerRef} maxLength={50} onChange={(e) => setCustomerRef(e.target.value)} />
              </label>
              <label className="f ref-f" style={{ flex: 1 }}>
                {t("备注（可选）")}
                <input value={remark} maxLength={200} onChange={(e) => setRemark(e.target.value)} />
              </label>
            </>
          ) : customerId === 0 ? (
            <>
              <label className="f" style={{ width: 120 }}>{t("加价 %")}<input type="number" min="0" step="0.01" value={markup.percent} placeholder={t("全局设置")} onChange={(e) => setMarkup({ ...markup, percent: e.target.value })} /></label>
              <label className="f" style={{ width: 120 }}>{t("每单固定加价")}<input type="number" min="0" step="0.01" value={markup.fixed} placeholder={t("全局设置")} onChange={(e) => setMarkup({ ...markup, fixed: e.target.value })} /></label>
              <label className="f" style={{ width: 120 }}>{t("每单最低利润")}<input type="number" min="0" step="0.01" value={markup.minProfit} placeholder={t("全局设置")} onChange={(e) => setMarkup({ ...markup, minProfit: e.target.value })} /></label>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>{t("寄件人")}</h2>
            {!editSender && <button className="small" onClick={() => setEditSender(true)}>{t("修改")}</button>}
          </div>
          {portal && (
            <div className="sender-pick">
              <select
                value={senderId}
                onChange={(e) => {
                  const v = e.target.value;
                  setSenderMsg(null);
                  if (v === "new") {
                    setSenderId("new");
                    dirty(setSender)({ country: "US" });
                    setEditSender(true);
                  } else if (v === "system") {
                    setSenderId("system");
                    dirty(setSender)(sysSender ?? {});
                    setEditSender(false);
                  } else {
                    const hit = senders.find((x) => x.id === Number(v));
                    setSenderId(Number(v));
                    if (hit) dirty(setSender)(hit.address);
                    setEditSender(false);
                  }
                }}
              >
                {senders.map((x) => <option key={x.id} value={x.id}>{x.label}{x.isDefault ? t("（默认）") : ""}</option>)}
                {sysSender && <option value="system">{t("发货仓地址（{city}）", { city: sysSender.city })}</option>}
                <option value="new">{t("＋ 新增寄件地址…")}</option>
              </select>
              <a className="small" href="/portal/account">{t("管理地址簿")}</a>
            </div>
          )}
          {portal && !senders.length && senderId === "new" && (
            <p className="small muted" style={{ margin: "0 0 10px" }}>{t("还没有保存寄件地址。填好后点“保存到寄件地址簿”，下次就可以直接选择。")}</p>
          )}
          {editSender ? (
            <>
              <AddressFields value={sender} placeholders={portal ? SENDER_EXAMPLE : undefined} onChange={(a) => { dirty(setSender)(a); setSenderMsg(null); }} />
              {portal && (
                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="small"
                    disabled={savingSender}
                    onClick={() =>
                      startSaveSender(async () => {
                        const editingId = typeof senderId === "number" ? senderId : undefined; // 发货仓 / 新地址 → 新增一条
                        const r = await saveSenderBookAction({ id: editingId, address: sender, label: senders.find((x) => x.id === editingId)?.label });
                        if (r.error) return setSenderMsg(tm(r.error));
                        setSenders(r.senders!);
                        setSenderId(r.id!);
                        setEditSender(false);
                        setSenderMsg(editingId ? t("已更新地址簿里的这个地址") : t("已保存到寄件地址簿，下次可以直接选择"));
                      })
                    }
                  >
                    {savingSender ? t("保存中…") : typeof senderId === "number" ? t("更新到地址簿") : t("保存到寄件地址簿")}
                  </button>
                  <span className="small muted">{t("不保存也可以直接下单")}</span>
                </div>
              )}
            </>
          ) : (
            <div className="sender-summary">
              <div><b>{[sender.nameFirst, sender.nameLast].filter(Boolean).join(" ")}</b>{sender.corporateName ? ` · ${sender.corporateName}` : ""}{sender.phone ? ` · ${sender.phone}` : ""}</div>
              <div className="muted">{[sender.address1, sender.address2, [sender.city, sender.province, sender.zipCode].filter(Boolean).join(" "), sender.country].filter(Boolean).join(", ")}</div>
            </div>
          )}
          {senderMsg && <div className="small" style={{ marginTop: 8, color: "var(--accent)" }}>{senderMsg}</div>}
        </div>
        <div className="card">
          <h2>{t("收件人")}</h2>
          <AddressFields value={recipient} onChange={dirty(setRecipient)} noDefaultCountry={props.intl} />
        </div>
      </div>

      <div className="card">
        <div className="pkg-head">
          <h2>{t("包裹")}</h2>
          <div className="unit-toggles">
            <div className="seg" role="group" aria-label={t("尺寸单位")}>
              {DIM_UNITS.map((u) => <button key={u} type="button" className={dimU === u ? "on" : ""} aria-pressed={dimU === u} onClick={() => pickUnits(u, wtU)}>{u}</button>)}
            </div>
            <div className="seg" role="group" aria-label={t("重量单位")}>
              {WEIGHT_UNITS.map((u) => <button key={u} type="button" className={wtU === u ? "on" : ""} aria-pressed={wtU === u} onClick={() => pickUnits(dimU, u)}>{u}</button>)}
            </div>
          </div>
        </div>
        {!!props.recentPackages?.length && (
          <div className="pkg-presets">
            <span className="small muted">{t("常用尺寸")}</span>
            {props.recentPackages.map((p, i) => {
              const { dim: lu, weight: wu } = unitsOf(p.unit);
              const on = dimU === lu && wtU === wu && pkg.length === String(p.length) && pkg.width === String(p.width) && pkg.height === String(p.height) && pkg.weight === String(p.weight);
              return (
                <button key={i} type="button" className={`chip${on ? " on" : ""}`} title={t("最近 90 天用过 {n} 次", { n: p.count })}
                  onClick={() => { pickUnits(lu, wu); dirty(setPkg)({ length: String(p.length), width: String(p.width), height: String(p.height), weight: String(p.weight) }); }}>
                  {p.length}×{p.width}×{p.height} {lu} · {p.weight} {wu}
                </button>
              );
            })}
          </div>
        )}
        <div className="grid pkg-grid">
          {(["length", "width", "height"] as const).map((k) => (
            <label key={k} className="f dim"><span className="req">{t({ length: "长", width: "宽", height: "高" }[k])}</span>
              <span className="unit-input"><input type="number" min="0" step="0.01" inputMode="decimal" value={pkg[k]} onChange={(e) => dirty(setPkg)({ ...pkg, [k]: e.target.value })} /><i>{lu}</i></span>
            </label>
          ))}
          <label className="f dim"><span className="req">{t("重量")}</span>
            <span className="unit-input"><input type="number" min="0" step="0.001" inputMode="decimal" value={pkg.weight} onChange={(e) => dirty(setPkg)({ ...pkg, weight: e.target.value })} /><i>{wu}</i></span>
          </label>
          <label className="f">{t("签名服务")}
            <select value={signType} onChange={(e) => dirty(setSignType)(Number(e.target.value))}>
              <option value={0}>{t("不需要签名")}</option>
              <option value={1}>{t("直接签名")}</option>
              <option value={2}>{t("间接签名")}</option>
              <option value={3}>{t("成人签名")}</option>
            </select>
          </label>
          <label className="f">{t("币种")}<input value={currency} maxLength={3} onChange={(e) => dirty(setCurrency)(e.target.value.toUpperCase())} /></label>
          <label className="f">{t("保险")}
            <select value={insurance.on ? 1 : 0} onChange={(e) => dirty(setInsurance)({ ...insurance, on: e.target.value === "1" })}>
              <option value={0}>{t("不需要")}</option>
              <option value={1}>{t("需要")}</option>
            </select>
          </label>
          {insurance.on && (
            <label className="f"><span className="req">{t("保险金额")}</span>
              <input type="number" min="0" step="0.01" value={insurance.fee} onChange={(e) => dirty(setInsurance)({ ...insurance, fee: e.target.value })} />
            </label>
          )}
        </div>

        {orderable ? (
          <>
            <h3>{intlDest ? t("商品明细（报关用）") : t("商品明细（选填）")}</h3>
            {!intlDest && <p className="small muted" style={{ marginTop: -4 }}>{t("美国国内件可以不填，不填按一件普通货物出单。填了 SKU 可以打印在面单上，方便仓库拣货。")}</p>}
            {intlDest && (
              <div className="alert warn small">
                {t("国际件报关：请如实填写英文品名、材质、商品性质、申报单价（美元）、海关编码（HS Code）和原产国。出单时 DHL 会据此生成正式的商业发票（Commercial Invoice）。贸易条款 DAP：关税、进口税由收件人在目的地支付。违禁品（电池单独寄、液体、刀具等）不能寄。")}
              </div>
            )}
            {skuTable(intlDest ? " *" : "")}
          </>
        ) : (
          // 后台试算只看地址和包裹：商品明细默认收起，不填也能试算
          <details style={{ marginTop: 12 }}>
            <summary className="small muted" style={{ cursor: "pointer" }}>{t("商品明细（可选：试算运费不需要填写）")}</summary>
            {skuTable("")}
          </details>
        )}
      </div>

      {errors.length > 0 && (
        <div className="alert err" id="ship-errors"><ul>{errors.map((e, i) => <li key={i}>{tm(e)}</li>)}</ul></div>
      )}

      <div className="card" id="ship-quotes" style={{ scrollMarginTop: 72 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: quotes ? 12 : 0 }}>
          <h2 style={{ margin: 0 }}>{t("报价")}</h2>
          <div className="row" style={{ gap: 8 }}>
            {canDraft && (
              <>
                <button type="button" onClick={() => onSaveDraft("save")} disabled={savingDraft} title={t("还没确认出单的话先存起来，下次在“草稿”里接着填")}>
                  {savingDraft ? t("保存中…") : draftId ? t("更新草稿") : t("保存草稿")}
                </button>
                <button type="button" onClick={() => onSaveDraft("next")} disabled={savingDraft} title={t("存好这一单，清空表单接着填下一单")}>
                  {t("保存并填下一单")}
                </button>
              </>
            )}
            <button className="primary" onClick={onQuote} disabled={quoting}>
              {quoting ? t("查询中…") : quotes ? t("重新查询运费") : t("查询运费")}
            </button>
          </div>
        </div>
        {draftMsg && (
          <div className="small draft-msg" role="status">
            {draftMsg}
            {draftId && <> <button type="button" className="link-btn small" disabled={savingDraft} onClick={() => onSaveDraft("copy")}>{t("另存为一份新草稿")}</button></>}
          </div>
        )}
        {quoting && !quotes?.length && (
          <div className="busy-line" role="status" aria-live="polite">
            <span className="spinner" />
            <span>
              {t("正在向各渠道查询运费，同时核对收件地址…")}
              {quoteSec > 0 && <b> {t("已等 {n} 秒", { n: quoteSec })}</b>}
              <span className="muted small"> · {t("查到一个显示一个，不用等全部查完")}</span>
            </span>
          </div>
        )}
        {creatingSec > 0 && (
          <div className="busy-line" role="status" aria-live="polite">
            <span className="spinner" />
            <span>{t("正在出单，等服务商返回面单…")} <b>{t("已等 {n} 秒", { n: creatingSec })}</b><span className="muted small"> · {t("请不要关闭或刷新页面")}</span></span>
          </div>
        )}
        {notice && <div className="alert warn">{tm(notice)}</div>}
        {orderable && addr && addr.status !== "unavailable" && addr.status !== "skipped" && (
          <AddressCheckPanel
            check={addr}
            ack={addrAck}
            onAck={setAddrAck}
            onUse={(sug) => {
              setRecipient({ ...recipient, ...sug });
              setAddr(null);
              setRequote(true);
            }}
          />
        )}
        {quotes && (
          <div className="row small" style={{ justifyContent: "space-between", marginBottom: 8, alignItems: "center" }}>
            <span className="muted">
              {t("{n} 个渠道可以送达", { n: quotes.filter((q) => q.ok).length })}
              {quotes.some((q) => !q.ok) && t("，{n} 个渠道地址未覆盖或不可用（{list}）", { n: quotes.filter((q) => !q.ok).length, list: quotes.filter((q) => !q.ok).map((q) => chName(q.channelCode, q.channelName).name).join(t("、")) })}
            </span>
            <label><input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} /> {t("只显示可下单渠道")}</label>
          </div>
        )}
        {quoting && !!quotes?.length && pending.length > 0 && (
          <div className="busy-line small" role="status" aria-live="polite">
            <span className="spinner" />
            <span>
              {t("还有 {n} 个渠道在查询：{list}", { n: pending.length, list: pending.map((c) => chName(c.code, c.name).name).join(t("、")) })}
              {quoteSec > 0 && <b> {t("已等 {n} 秒", { n: quoteSec })}</b>}
              <span className="muted"> · {t("上面查到的渠道可以直接下单")}</span>
            </span>
          </div>
        )}
        {quotes && !quoting && !quotes.some((q) => q.ok) && <div className="alert err">{t("所有渠道都不支持这个地址或包裹，请检查邮编、地址或重量尺寸。")}</div>}
        {quotes && (
          <div className="table-wrap">
            <table className={portal || costTable || re ? "quote-table" : undefined}>
              <thead>
                {portal ? (
                  <tr><th>{t("渠道")}</th><th>{props.intl ? t("时效") : t("分区")}</th><th className="num">{t("运费")}</th><th></th></tr>
                ) : costTable ? (
                  <tr><th>{t("渠道")}</th><th>{t("分区")}</th><th className="num">{t("原价")}</th><th className="num">{t("成本价（出单价）")}</th><th></th></tr>
                ) : re ? (
                  <tr><th>{t("渠道")}</th><th>{t("分区")}</th><th className="num">{t("我们的成本")}</th><th className="num">{t("客户价（出单价）")}</th><th></th></tr>
                ) : (
                  <tr><th>{t("渠道")}</th><th>{t("分区")}</th>{!props.hideCost && <><th className="num">{t("原价")}</th><th className="num">{t("我们的成本")}</th><th>{t("加价规则")}</th></>}<th className="num">{t("客户价")}</th>{!props.hideCost && <th className="num">{t("利润")}</th>}</tr>
                )}
              </thead>
              <tbody>
                {/* 一个能下的都没有时，不管勾没勾“只显示可下单渠道”，都列出每个渠道的原因 */}
                {quotes.filter((q) => q.ok || !onlyAvailable || !quotes.some((x) => x.ok)).map((q) =>
                  q.ok ? (
                    costTable || re ? (
                      <tr key={q.channelCode} className={q.price === bestPrice ? "best" : ""}>
                        <td className="q-ch">
                          <ChannelLabel code={q.channelCode} name={q.channelName} size="md" />
                          <div className="small muted">{q.channelCode}{q.ms !== undefined && <span title={t("这个渠道报价用的时间")}> · {(q.ms / 1000).toFixed(1)}s</span>}{re?.channelCode === q.channelCode && <span className="badge pending" style={{ marginLeft: 6 }}>{t("原渠道")}</span>}</div>
                        </td>
                        <td className="q-zone" data-label={t("分区")}>{q.zone ?? "-"}{q.zoneEstimated && <span className="small muted" title={t("嘉谷未返回分区，按同一目的地其他渠道的分区估算")}>{t("（参考）")}</span>}</td>
                        <td className="num muted q-cost" data-label={costTable ? t("原价") : t("我们的成本")}>{money(costTable ? q.listCost : q.cost)}</td>
                        <td className="num q-price"><b>{money(q.price, q.currency)}</b>{q.price === bestPrice && <div className="small profit-pos">{t("最低")}</div>}{q.promo && <div className="small" style={{ textAlign: "right" }}><span className="badge promo">{tm(q.promo.label)}</span> <s className="muted">{money(q.promo.originalPrice, q.currency)}</s><div className="muted">{t("活动至 {d}", { d: q.promo.endsOn.slice(5) })}</div></div>}{q.warning && <div className="small warn-text" style={{ maxWidth: 260, marginLeft: "auto", textAlign: "left" }}>⚠ {tm(q.warning)}</div>}</td>
                        <td className="q-act">
                          <button className="primary small" disabled={!!creating} onClick={() => onCreate(q)}>
                            {creating === q.channelCode ? t("出单中…") : re ? t("用此渠道重新出单") : t("用此渠道出单")}
                          </button>
                        </td>
                      </tr>
                    ) :
                    <tr key={q.channelCode} className={q.price === bestPrice ? "best" : ""}>
                      <td className="q-ch"><ChannelLabel code={q.channelCode} name={q.channelName} size="md" />{!portal && <div className="small muted">{q.channelCode}{q.ms !== undefined && <span title={t("这个渠道报价用的时间")}> · {(q.ms / 1000).toFixed(1)}s</span>}</div>}</td>
                      <td className="q-zone" data-label={t("分区")}>{q.zone ?? "-"}{!portal && q.zoneEstimated && <span className="small muted" title={t("嘉谷未返回分区，按同一目的地其他渠道的分区估算")}>{t("（参考）")}</span>}</td>
                      {!portal && (
                        <>
                          {!props.hideCost && <td className="num muted">{money(q.listCost)}</td>}
                          {!props.hideCost && <td className="num">{money(q.cost, q.currency)}</td>}
                          {/* 员工拿到的报价不带加价规则（规则 + 客户价能倒推成本），这一列不显示 */}
                          {!props.hideCost && <td className="small">{q.rule ? <>{signedPercent(q.rule.percent)} + {q.rule.fixed}{t("，最低利润")} {q.rule.minProfit}</> : "-"}</td>}
                        </>
                      )}
                      <td className="num q-price"><b>{money(q.price, q.currency)}</b>{portal && q.price === bestPrice && <div className="small profit-pos">{t("最低价")}</div>}{q.promo && <div className="small" style={{ textAlign: "right" }}><span className="badge promo">{tm(q.promo.label)}</span> <s className="muted">{money(q.promo.originalPrice, q.currency)}</s><div className="muted">{t("活动至 {d}", { d: q.promo.endsOn.slice(5) })}</div></div>}{q.warning && <div className="small warn-text" style={{ maxWidth: 260, marginLeft: "auto", textAlign: "left" }}>⚠ {tm(q.warning)}</div>}</td>
                      {!portal && !props.hideCost && <td className="num profit-pos">{money(q.profit)}</td>}
                      {portal && (
                        <td className="q-act">
                          {afford(q.price!).ok ? (
                            <button className="primary small" disabled={!!creating} onClick={() => onCreate(q)}>
                              {creating === q.channelCode ? t("出单中…") : t("用此渠道出单")}
                            </button>
                          ) : (
                            <div className="small" style={{ textAlign: "right" }}>
                              <button className="primary small" disabled>{t("余额不足")}</button>
                              <div><a href="/portal/topup">{t("去充值")} →</a></div>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ) : (
                    <tr key={q.channelCode} className="row-disabled">
                      <td className="q-ch"><ChannelLabel code={q.channelCode} name={q.channelName} size="md" /></td>
                      <td className="small q-err" colSpan={portal ? 3 : costTable || re ? 4 : props.hideCost ? 2 : 6} style={{ color: "var(--err)" }}>
                        <b>{/不通邮|派送范围|未覆盖/.test(q.error ?? "") ? t("地址未覆盖") : t("不可用")}</b>
                        {q.error && !/^地址未覆盖/.test(q.error) ? `${t("：")}${tm(q.error)}` : q.error ? `${t("：")}${tm(q.error.replace(/^地址未覆盖：/, ""))}` : ""}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
