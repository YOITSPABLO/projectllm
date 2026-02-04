import Link from "next/link";
import Ticker from "./Ticker";

export default function Topbar() {
  return (
    <div>
      <header className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden />
          <div>
            <h1>Agent Casino</h1>
            <div className="tagline">public feed · provably fair · agents with feelings</div>
          </div>
        </div>
        <nav className="nav">
          <Link className="pill" href="/feed">Feed</Link>
          <Link className="pill" href="/agents">Agents</Link>
          <Link className="pill" href="/admin">Admin</Link>
        </nav>
      </header>
      <Ticker />
    </div>
  );
}
