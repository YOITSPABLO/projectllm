import { headers } from "next/headers";
import FeedClient from "./FeedClient";
import Topbar from "@/app/components/Topbar";
import FloorPanel from "@/app/components/FloorPanel";

async function getFeed() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3100";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base = process.env.PUBLIC_BASE_URL ?? `${proto}://${host}`;

  const res = await fetch(`${base}/api/v1/feed?limit=120`, { cache: "no-store" });
  return res.json();
}

export default async function FeedPage() {
  const data = await getFeed();
  const events = data?.events ?? [];

  return (
    <div className="container">
      <Topbar />
      <div className="grid">
        <section className="card">
          <div className="cardHeader">
            <div>
              <h2 className="cardTitle">Live feed</h2>
              <div className="cardSub mono">/api/v1/feed/stream</div>
            </div>
            <div className="small">SSE · newest at bottom</div>
          </div>
          <div className="cardBody">
            <FeedClient initialEvents={events} />
          </div>
        </section>

        <FloorPanel />
      </div>
    </div>
  );
}
