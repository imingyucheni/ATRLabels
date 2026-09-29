"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18n";

/**
 * 收款码显示：自动裁掉图片四周的空白和说明文字，只把二维码放大显示（像素保持清晰，方便银行 App 扫描）；
 * 点击可以全屏放大。识别不了的图片按原图显示。
 */
export default function QrImage({ src, alt, size = 280 }: { src: string; alt: string; size?: number }) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bigRef = useRef<HTMLCanvasElement>(null);
  const [crop, setCrop] = useState<{ img: HTMLImageElement; x: number; y: number; w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
        // 找深色像素（二维码的黑块）的范围；浅色的说明文字不算
        let x0 = width, y0 = height, x1 = -1, y1 = -1;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            if (data[i + 3] > 128 && lum < 90) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        const w = x1 - x0 + 1;
        const h = y1 - y0 + 1;
        // 大致是正方形才当成二维码；四周留一圈白边（扫码需要）
        if (x1 < 0 || w < 40 || Math.abs(w - h) > Math.max(w, h) * 0.15) return setFailed(true);
        const pad = Math.round(Math.max(w, h) * 0.08);
        setCrop({ img, x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), w: Math.min(width, w + pad * 2), h: Math.min(height, h + pad * 2) });
      } catch {
        setFailed(true);
      }
    };
    img.onerror = () => setFailed(true);
    img.src = src;
  }, [src]);

  useEffect(() => {
    for (const [ref, px] of [[canvasRef, size], [bigRef, Math.min(window.innerWidth, window.innerHeight) * 0.85]] as const) {
      const c = ref.current;
      if (!c || !crop) continue;
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(px * dpr);
      c.height = Math.round(px * dpr * (crop.h / crop.w));
      c.style.width = `${px}px`;
      c.style.height = `${px * (crop.h / crop.w)}px`;
      const ctx = c.getContext("2d")!;
      // 放大时不做平滑（格子边缘保持锐利）；缩小时要平滑，否则细小的格子会丢
      ctx.imageSmoothingEnabled = c.width < crop.w;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(crop.img, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
    }
  }, [crop, size, zoom]);

  const box = { display: "block", maxWidth: "100%", marginTop: 6, border: "1px solid var(--line)", borderRadius: 8, background: "#fff", cursor: "zoom-in" } as const;
  return (
    <>
      {failed || !crop ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} onClick={() => setZoom(true)} style={{ ...box, width: size }} />
      ) : (
        <canvas ref={canvasRef} role="img" aria-label={alt} onClick={() => setZoom(true)} style={box} />
      )}
      <div className="small muted" style={{ marginTop: 4 }}>{t("点击二维码可以放大")}</div>
      {zoom && (
        <div
          onClick={() => setZoom(false)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.75)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}
        >
          {failed || !crop ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={alt} style={{ maxWidth: "90vw", maxHeight: "90vh", background: "#fff", borderRadius: 8 }} />
          ) : (
            <canvas ref={bigRef} role="img" aria-label={alt} style={{ background: "#fff", borderRadius: 8 }} />
          )}
        </div>
      )}
    </>
  );
}
