import { trackingUrl } from "@/lib/carriers";
import { displayChannel } from "@/lib/channelDisplay";
import CopyButton from "@/components/CopyButton";

/** 运单号：点开去物流商官网（或 17TRACK）查轨迹；旁边有复制按钮（不用拖鼠标选） */
export default function TrackingLink({ channelCode, trackingNo, title }: { channelCode: string | null | undefined; trackingNo: string | null | undefined; title?: string }) {
  if (!trackingNo) return <>-</>;
  const url = trackingUrl(displayChannel(channelCode).carrier, trackingNo);
  return (
    <span className="track-wrap">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" title={title} className="track-link">
          {trackingNo} <span aria-hidden="true">↗</span>
        </a>
      ) : (
        <span className="track-no">{trackingNo}</span>
      )}
      <CopyButton text={trackingNo} label="复制运单号" />
    </span>
  );
}
