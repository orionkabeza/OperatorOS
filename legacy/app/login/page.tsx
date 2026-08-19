"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Login failed");
      }
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "oklch(0.96 0.005 120)" }}>
      <form
        onSubmit={handleSubmit}
        style={{
          width: 320,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          background: "oklch(1 0 0)",
          border: "1px solid oklch(0.91 0.008 120)",
          borderRadius: 20,
          padding: 28,
        }}
      >
        <div>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              background: "oklch(0.52 0.11 155)",
              color: "oklch(0.99 0.01 155)",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              fontSize: 15,
              marginBottom: 12,
            }}
          >
            AE
          </div>
          <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: "-0.015em" }}>Auntie Efua&apos;s Kitchen</div>
          <div style={{ fontSize: 13, color: "oklch(0.55 0.01 150)", marginTop: 2 }}>Sign in to the owner dashboard</div>
        </div>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          style={{
            font: "inherit",
            fontSize: 14.5,
            padding: "11px 14px",
            borderRadius: 12,
            border: "1px solid oklch(0.88 0.008 120)",
            outline: "none",
          }}
        />

        {error ? <div style={{ fontSize: 13, color: "oklch(0.47 0.11 28)" }}>{error}</div> : null}

        <button
          type="submit"
          disabled={busy || !password}
          style={{
            minHeight: 44,
            borderRadius: 12,
            background: "oklch(0.52 0.11 155)",
            color: "oklch(0.99 0.01 155)",
            fontSize: 14.5,
            fontWeight: 620,
            opacity: busy || !password ? 0.7 : 1,
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
