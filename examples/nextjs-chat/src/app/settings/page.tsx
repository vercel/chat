"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [previewBranchUrl, setPreviewBranchUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "error">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);

  // Load current setting on mount
  useEffect(() => {
    fetch("/api/settings/preview-branch")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          setStatus("error");
        } else {
          setPreviewBranchUrl(data.url || "");
          setSavedUrl(data.url);
          setStatus("idle");
        }
      })
      .catch((err) => {
        setError(err.message);
        setStatus("error");
      });
  }, []);

  const handleSave = async () => {
    setStatus("saving");
    setError(null);

    try {
      const res = await fetch("/api/settings/preview-branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: previewBranchUrl || null }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setStatus("error");
      } else {
        setSavedUrl(data.url);
        setStatus("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  };

  const handleClear = async () => {
    setPreviewBranchUrl("");
    setStatus("saving");
    setError(null);

    try {
      const res = await fetch("/api/settings/preview-branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: null }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setStatus("error");
      } else {
        setSavedUrl(null);
        setStatus("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  };

  return (
    <main
      style={{
        padding: "2rem",
        fontFamily: "system-ui, sans-serif",
        maxWidth: "600px",
      }}
    >
      <h1>Settings</h1>

      <section style={{ marginTop: "2rem" }}>
        <h2>Preview Branch</h2>
        <p style={{ color: "#666", marginBottom: "1rem" }}>
          Configure a preview branch URL to proxy webhook requests to a
          different deployment. This allows testing a preview branch with real
          webhook traffic.
        </p>

        {status === "loading" ? (
          <p>Loading...</p>
        ) : (
          <>
            <div style={{ marginBottom: "1rem" }}>
              <label
                htmlFor="preview-url"
                style={{
                  display: "block",
                  marginBottom: "0.5rem",
                  fontWeight: 500,
                }}
              >
                Preview Branch URL
              </label>
              <input
                id="preview-url"
                onChange={(e) => setPreviewBranchUrl(e.target.value)}
                placeholder="https://your-preview-branch.vercel.app"
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  fontSize: "1rem",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  boxSizing: "border-box",
                }}
                type="url"
                value={previewBranchUrl}
              />
            </div>

            {error && (
              <p style={{ color: "red", marginBottom: "1rem" }}>{error}</p>
            )}

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                disabled={status === "saving"}
                onClick={handleSave}
                style={{
                  padding: "0.5rem 1rem",
                  fontSize: "1rem",
                  backgroundColor: "#0070f3",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: status === "saving" ? "not-allowed" : "pointer",
                  opacity: status === "saving" ? 0.7 : 1,
                }}
                type="button"
              >
                {status === "saving" ? "Saving..." : "Save"}
              </button>

              {savedUrl && (
                <button
                  disabled={status === "saving"}
                  onClick={handleClear}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "1rem",
                    backgroundColor: "#dc3545",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: status === "saving" ? "not-allowed" : "pointer",
                    opacity: status === "saving" ? 0.7 : 1,
                  }}
                  type="button"
                >
                  Clear
                </button>
              )}
            </div>

            {savedUrl && (
              <p
                style={{
                  marginTop: "1rem",
                  padding: "0.75rem",
                  backgroundColor: "#d4edda",
                  borderRadius: "4px",
                }}
              >
                Webhook requests are being proxied to:{" "}
                <strong>{savedUrl}</strong>
              </p>
            )}

            {!savedUrl && status === "idle" && (
              <p
                style={{
                  marginTop: "1rem",
                  padding: "0.75rem",
                  backgroundColor: "#f8f9fa",
                  borderRadius: "4px",
                }}
              >
                No preview branch configured. Webhooks are handled by this
                deployment.
              </p>
            )}
          </>
        )}
      </section>

      <section style={{ marginTop: "3rem" }}>
        <a href="/" style={{ color: "#0070f3" }}>
          &larr; Back to Home
        </a>
      </section>
    </main>
  );
}
