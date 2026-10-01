/** Shopify / eBay 的 logo（白底小牌子，深色模式下也看得清） */
export default function PlatformLogo({ platform, size = "md" }: { platform: "shopify" | "ebay"; size?: "sm" | "md" | "lg" }) {
  const name = platform === "shopify" ? "Shopify" : "eBay";
  return (
    <span className={`plat-logo ${platform} ${size}`} title={name}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/platforms/${platform}.svg`} alt={name} />
    </span>
  );
}
