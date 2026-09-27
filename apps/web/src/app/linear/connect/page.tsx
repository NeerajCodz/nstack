"use client";

import { useAction } from "convex/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "../../../../../../convex/_generated/api";

type View = "ready" | "loading" | "error";

function StatusCard({ heading, detail, status }: { heading: string; detail: string; status?: string }) {
  return (
    <main className="card" aria-labelledby="connect-title">
      <p className="eyebrow">nstack · Linear authorization</p>
      <h1 id="connect-title">{heading}</h1>
      <p>{detail}</p>
      {status && <p role="status">{status}</p>}
    </main>
  );
}

function ConnectContent() {
  const params = useSearchParams();
  const requestId = params.get("requestId");
  const result = params.get("result");
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL && process.env.NEXT_PUBLIC_SITE_URL);

  if (!configured) return <StatusCard heading="Service configuration required" detail="This connection service is not configured yet. Ask its administrator to configure the Convex deployment and site URL before connecting." />;
  if (result === "approved") return <StatusCard heading="Linear connected" detail="Authorization is complete. You can close this page and return to nstack." status="Authorization completed." />;
  if (result === "denied") return <StatusCard heading="Connection not approved" detail="Linear authorization was declined or could not be completed. No nstack session was issued. Return to nstack to start a new request." status="No connection was created." />;
  if (!requestId) return <StatusCard heading="Connection request missing" detail="Open this page from `nstack linear auth login` so it can create a one-time connection request." />;
  return <Consent requestId={requestId} />;
}

function Consent({ requestId }: { requestId: string }) {
  const startOAuth = useAction(api.linear.startLinearOAuth);
  const [view, setView] = useState<View>("ready");

  async function connect() {
    setView("loading");
    try {
      const { authorizationUrl } = await startOAuth({ requestId });
      window.location.assign(authorizationUrl);
    } catch {
      setView("error");
    }
  }

  const heading = view === "error" ? "Unable to start connection" : view === "loading" ? "Opening Linear authorization" : "Connect Linear";
  const detail = view === "error"
    ? "The authorization request could not be started. Check the service configuration and retry from nstack."
    : view === "loading"
      ? "You will review and approve access on Linear's website."
      : "nstack will use Linear through its configured service. This connection requests read, write, and issues:create access; review the permissions on Linear before approving. Linear access and refresh tokens stay on the server and are never shown to nstack.";
  return (
    <main className="card" aria-labelledby="connect-title">
      <p className="eyebrow">nstack · Linear authorization</p>
      <h1 id="connect-title">{heading}</h1>
      <p>{detail}</p>
      {view !== "loading" && <button onClick={connect}>Continue to Linear</button>}
      {view === "loading" && <p role="status">Preparing secure authorization…</p>}
    </main>
  );
}

export default function LinearConnectPage() {
  return <Suspense fallback={<StatusCard heading="Loading connection request" detail="Preparing the authorization page…" />}><ConnectContent /></Suspense>;
}
