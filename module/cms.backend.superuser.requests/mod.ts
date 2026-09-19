import { getCtx, html } from "@qino/qino";
import { suspicion } from "@qino/qino/security";

import type { App } from "@qino/qino";

/** Badge when the ip is the viewer's own. */
const myIpBadge = (ip: unknown, label: string) => ip && ip === getCtx().req.clientIp ? html` <small class=u2-badge>${label}</small>` : "";

export async function ipBadges(app: App) {
  const myIp = await app.t`my IP`;
  const withSecurity = !!app.modules.linked("security");
  const suspicious = withSecurity ? await app.t`suspicious` : "";
  return (ip: unknown) => {
    const strength = withSecurity && ip ? suspicion(app, String(ip)) : 0;
    return html`${myIpBadge(ip, myIp)}${strength >= 1 ? html` <small class=u2-badge style="background:var(--red)" title="${suspicious}" aria-label="${suspicious}: ${Math.round(strength)}">☠ ${Math.round(strength)}</small>` : ""}`;
  };
}
