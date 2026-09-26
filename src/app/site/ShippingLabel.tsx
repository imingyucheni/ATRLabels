/** 4×6 面单插图（SVG，示意） */
const BARS = "3121412311213141121231411213214112131241".split("").map(Number);

export default function ShippingLabel({ variant = 0 }: { variant?: number }) {
  const to = variant ? ["JANE ROE", "455 MARKET ST STE 200", "SAN FRANCISCO CA 94105"] : ["JOHN SMITH", "350 5TH AVE", "NEW YORK NY 10118"];
  const tracking = variant ? "9400 1118 9922 3344 5566 91" : "9400 1118 9922 3344 5566 77";
  // 条码宽度按标签内宽（16–184）缩放，不会超出边框
  const unit = 168 / BARS.reduce((a, w) => a + w, 0);
  let x = 16;
  const bars = BARS.map((w, i) => {
    const r = i % 2 === 0 ? <rect key={i} x={x} y={218} width={w * unit} height={46} fill="#111" /> : null;
    x += w * unit;
    return r;
  });
  return (
    <svg className="ship-label" viewBox="0 0 200 300" role="img" aria-label="Shipping label">
      <rect x="0.5" y="0.5" width="199" height="299" rx="4" fill="#fff" stroke="#d4d4d8" />
      <rect x="8" y="8" width="44" height="44" fill="#111" />
      <text x="30" y="37" fontSize="22" fontWeight="800" fill="#fff" textAnchor="middle" fontFamily="Arial, sans-serif">G</text>
      <text x="60" y="22" fontSize="9" fontWeight="700" fill="#111" fontFamily="Arial, sans-serif">USPS GROUND ADVANTAGE™</text>
      <text x="60" y="34" fontSize="6.5" fill="#444" fontFamily="Arial, sans-serif">U.S. POSTAGE PAID · e-VS</text>
      <text x="60" y="45" fontSize="6.5" fill="#444" fontFamily="Arial, sans-serif">1.50 LB · ZONE 8</text>
      <line x1="8" y1="60" x2="192" y2="60" stroke="#111" strokeWidth="1.5" />
      <text x="10" y="74" fontSize="6" fill="#666" fontFamily="Arial, sans-serif">FROM</text>
      <text x="10" y="84" fontSize="7" fill="#111" fontFamily="Arial, sans-serif">ATR LOGISTICS</text>
      <text x="10" y="93" fontSize="7" fill="#111" fontFamily="Arial, sans-serif">CHINO CA 91710</text>
      <text x="10" y="116" fontSize="6" fill="#666" fontFamily="Arial, sans-serif">SHIP TO</text>
      {to.map((l, i) => (
        <text key={l} x="22" y={130 + i * 13} fontSize={i === 0 ? 10 : 9} fontWeight={i === 0 ? 700 : 500} fill="#111" fontFamily="Arial, sans-serif">{l}</text>
      ))}
      <line x1="8" y1="180" x2="192" y2="180" stroke="#111" strokeWidth="1.5" />
      <text x="100" y="200" fontSize="7" fontWeight="700" fill="#111" textAnchor="middle" fontFamily="Arial, sans-serif">USPS TRACKING # EP</text>
      <g>{bars}</g>
      <text x="100" y="278" fontSize="7.5" fill="#111" textAnchor="middle" fontFamily="Arial, sans-serif" letterSpacing="0.5">{tracking}</text>
      <rect x="8" y="286" width="184" height="6" fill="#111" opacity="0.08" />
    </svg>
  );
}
