// Settings → Claude: access tokens for the MCP server, and how to connect Claude with one.
// Claude can then search the cookbook, read recipes and add new ones while you chat.

import { useState } from "react";
import { api } from "../../lib/api";
import { invalidate, useApi } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import { ConfirmDialog, CopyButton, useToast } from "../common";
import { Plus } from "../icons";
import { PageHeader } from "./common";

interface Token {
  id: string;
  name: string;
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function Snippet({ label, text }: { label: string; text: string }) {
  return (
    <div className="mcp-snippet">
      <span className="small muted">{label}</span>
      <div className="mcp-snippet-row">
        <code>{text}</code>
        <CopyButton text={text} />
      </div>
    </div>
  );
}

export function ClaudePage() {
  const { t, f } = useSettings();
  const toast = useToast();
  const tokens = useApi<Token[]>("/app/tokens");
  const [name, setName] = useState("Claude");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Token | null>(null);
  const endpoint = `${location.origin}/mcp`;
  const reload = () => {
    invalidate("/app/tokens");
    tokens.reload();
  };

  return (
    <>
      <PageHeader title={t("claude")} hint={t("claudeHint")} />

      <section>
        <h3>{t("claudeTokens")}</h3>
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const res = await api<{ token: string }>("/app/tokens", { body: { name } });
              setCreated(res.token);
              reload();
            } catch (err) {
              toast((err as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <input className="text-field" value={name} maxLength={60} placeholder={t("claudeTokenName")} onChange={(e) => setName(e.target.value)} />
          <button className="primary-button" disabled={busy}>
            <Plus size={14} />
            {t("claudeNewToken")}
          </button>
        </form>

        {created && (
          <div className="mcp-created">
            <p className="notice small">{t("claudeTokenOnce")}</p>
            <Snippet label={t("claudeForClaudeAi")} text={`${endpoint}/${created}`} />
            <Snippet label={t("claudeForClaudeCode")} text={`claude mcp add --transport http cooking ${endpoint} --header "Authorization: Bearer ${created}"`} />
            <Snippet
              label={t("claudeForDesktop")}
              text={JSON.stringify({ mcpServers: { cooking: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${created}` } } } }, null, 2)}
            />
          </div>
        )}

        {(tokens.data?.length ?? 0) > 0 && (
          <div className="settings-list" style={{ marginTop: 14 }}>
            {tokens.data!.map((tok) => (
              <div key={tok.id} className="settings-list-row">
                <div className="settings-list-main">
                  <span>
                    {tok.name} <span className="muted small">…{tok.hint}</span>
                  </span>
                  <span className="small muted">{tok.lastUsedAt ? t("lastActiveAt", { when: f.relative(tok.lastUsedAt, t) }) : t("claudeNeverUsed")}</span>
                </div>
                <button className="text-button danger" onClick={() => setRevoking(tok)}>
                  {t("claudeRevoke")}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3>{t("claudeHow")}</h3>
        <ol className="mcp-steps small">
          <li>{t("claudeStepAi")}</li>
          <li>{t("claudeStepCode")}</li>
          <li>{t("claudeStepUse")}</li>
        </ol>
        <p className="small muted">{t("claudePublicNote")}</p>
      </section>

      {revoking && (
        <ConfirmDialog
          title={t("claudeRevoke")}
          text={t("claudeRevokeText", { name: revoking.name })}
          action={t("claudeRevoke")}
          onConfirm={async () => {
            await api(`/app/tokens/${revoking.id}`, { method: "DELETE" });
            if (created) setCreated(null);
            reload();
          }}
          onClose={() => setRevoking(null)}
        />
      )}
    </>
  );
}
