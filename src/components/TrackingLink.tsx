import { trackingUrl } from "@/lib/carriers";
import { displayChannel } from "@/lib/channelDisplay";

/** 运单号：点开去物流商官网（或 17TRACK）查轨迹 */
export default function TrackingLink({ channelCode, trackingNo, title }: { channelCode: string | null | undefined; trackingNo: string | null | undefined; title?: string }) {
  if (!trackingNo) return <>-</>;
  const url = trackingUrl(displayChannel(channelCode).carrier, trackingNo);
  if (!url) return <>{trackingNo}</>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={title} className="track-link">
      {trackingNo} <span aria-hidden="true">↗</span>
    </a>
  );
}
