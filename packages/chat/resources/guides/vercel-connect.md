# Give your agents secure access to third-party APIs

**Author:** Ben Sabic

---

Agents and background services often need to call provider APIs such as Slack, GitHub, or Snowflake on behalf of your users. Doing so usually means storing long-lived provider secrets in your database or environment variables. [Vercel Connect](https://vercel.com/docs/connect) keeps those secrets out of your runtime by issuing user-authorized tokens on demand, scoped to the projects and environments that need them. You register a connector once, link it to a project, then request a token at runtime when your code calls the provider.

This guide walks you through Vercel Connect from start to finish. You'll create a Slack connector, link it to a project, and choose which environments can use it. From there, you'll request scoped runtime tokens from your code with the Vercel Connect SDK or the Vercel CLI, forward Slack webhooks to your projects, and apply best practices for scopes, environments, and token handling.

> **Vercel Connect is in beta and available on all plans.** Features and behavior, including available connectors and trigger forwarding, may change before general availability. Usage is subject to the [Beta Agreement](https://vercel.com/docs/release-phases/public-beta-agreement) and [Vercel Connect terms](https://vercel.com/docs/connect/legal).

## Prerequisites

Before you begin, make sure you have:

*   Access to a Vercel team and project with Vercel Connect enabled
    
*   Permission to create connectors and link them to projects
    
*   A Slack workspace where you can install apps
    
*   Vercel CLI installed (`npm i -g vercel`)
    

## How Vercel Connect works

Vercel Connect is built around a connector, a registered connection to a third-party provider that your whole team can reuse. You link a connector to the projects that need it, and your code requests a token from that connector at runtime instead of reading a stored secret. Vercel records each authorization and token request, so you keep an audit trail of how external access is used.

Connect uses four main concepts:

| Concept                | Description                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Connector              | Registered connection to a third-party provider that your team can reuse.                                                     |
| Installation           | Provider-side installation for a specific tenant, such as a Slack workspace or GitHub organization.                           |
| Token request          | Runtime token request, which can include options such as `installationId`, `scopes`, `resources`, and `authorizationDetails`. |
| Connector-project link | The binding between a connector and a project, including the environments where it's enabled.                                 |

### Token subject types

Each token request specifies the subject it represents. One connector can issue tokens for any of three subjects:

| Subject      | Acts as                                                    | When to use                                                                                             |
| ------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `app`        | The application itself, using the connector's installation | Bot accounts or tenant-wide admin actions. App tokens skip the user-consent flow.                       |
| `user`       | A specific signed-in user                                  | Acting on behalf of a user. The user authorizes the connector once before you can mint tokens for them. |
| `jwt-bearer` | A federated identity you assert                            | Exchanging an external identity for a provider token.                                                   |

In the SDK, `subject` is required. The CLI requests a `user` token by default; pass `--subject app` for an app token.

### Connector types

Vercel Connect has built-in support for Slack, GitHub, Snowflake, Salesforce, API key, and Custom OAuth connectors. Connectors fall into two operating models, based on who registers the credentials with the provider:

| Connector    | Model            | Setup                                                                                       |
| ------------ | ---------------- | ------------------------------------------------------------------------------------------- |
| Slack        | Vercel Managed   | Authorize Vercel's Slack app, installed per workspace.                                      |
| GitHub       | Vercel Managed   | Install Vercel's GitHub app, per organization or user.                                      |
| Snowflake    | Vercel Managed   | Connect through the Snowflake Partner Connect integration.                                  |
| Salesforce   | Vercel Managed   | Authorize Vercel's managed OAuth client against your Salesforce org.                        |
| Custom OAuth | Customer Managed | Bring your own client ID and secret for any service URL, using OAuth 2.0 or OIDC with PKCE. |
| API key      | Customer Managed | Supply a long-lived API key at create time.                                                 |

With a Vercel Managed Connector, Vercel registers the OAuth client and you authorize it against your account or workspace, so you don't manage client secrets. With a Customer Managed Connector, you register the OAuth client, generate the API key yourself, and supply the credentials when you create the connector. For providers that support it, Vercel Assisted Setup can perform some or all of the OAuth-client registration on your behalf.

From the Vercel CLI, you can create a connector using a service name, such as `slack` or `github`, or a service URL, such as `mcp.linear.app`.

### How authentication works

When your code requests a token, the SDK authenticates with Vercel Connect using the OIDC token that Vercel automatically injects into your deployment. Connect verifies that token against the connector's project links to confirm the project and environment are allowed to request tokens. For local development, run `vercel link` and then `vercel env pull` to download a short-lived development token into `.env.local`. For external CI/CD or non-Vercel environments, pass a [Vercel access token](https://vercel.com/docs/rest-api#creating-an-access-token) to the SDK through the `vercelToken` option.

## Create a connector

You can create a connector from the dashboard or the Vercel CLI.

In the dashboard, open the [Connect page](https://vercel.com/d?to=%2F%5Bteam%5D%2F~%2Fconnect) in your team, click **Create Connector**, and select **Slack** as the type. Name the connector (for example, `acme-slack`) and enable trigger forwarding if you plan to receive Slack webhooks.

To do the same in the terminal, run:

`vercel connect create slack --name acme-slack`

Add `--triggers` if you want this connector to forward incoming Slack webhooks:

`vercel connect create slack --name acme-slack --triggers`

You can also create GitHub, OAuth, or service-URL connectors:

`vercel connect create github --name acme-github vercel connect create oauth --name acme-oauth vercel connect create mcp.linear.app --name linear-connector`

## Link the connector to a project

Attach the connector to the Vercel project where your app or agent runs. Choose at least one environment, such as production, and add preview or development if your workflow runs there too.

If you created the connector from the CLI inside a directory that's already linked to a Vercel project, that project is attached for you, so you can skip this step. To attach a different project, or to add environments later, pass `--project`:

`vercel connect attach slack/acme-slack --project my-project --environment production`

Connectors are identified by their UID (for example, `slack/acme-slack`) or by their ID (for example, `scl_abc123`). To also register the project as a destination for forwarded webhooks, add `--triggers`:

`vercel connect attach slack/acme-slack --triggers`

For stronger isolation, consider a separate connector for each environment.

## Request a runtime token

Scope each token request to the workload before you request it:

*   Set provider scopes only for the action you need.
    
*   Add `installationId` when you need to target a specific installation.
    
*   With the SDK, you can also pass provider-specific `resources` or `authorizationDetails`.
    

You usually don't need to set `installationId`. In most cases, the connector resolves a default installation from its tenant, which covers a private app installed in a single workspace. Set it explicitly only when the connector spans more than one installation and you need to target a specific Slack workspace or GitHub organization.

Request the token from your server-side code with the SDK:

`import { getToken } from '@vercel/connect'; const token = await getToken('slack/acme-slack', { subject: { type: 'app' }, scopes: ['channels:read'], });`

`getToken` returns the token string, ready to use in an `Authorization` header. If you need the token's expiry, the connected workspace name, or other provider metadata, call `getTokenResponse` instead. The SDK keeps an in-process cache and refreshes tokens automatically as they approach expiry, so you can call `getToken` on each request without minting a new token every time.

For a `user`\-subject token, the first request for a user who hasn't authorized the connector throws `UserAuthorizationRequiredError`. Catch it, send the user to the connector's consent URL with `startAuthorization`, then retry once they authorize.

To request the same app token from the Vercel CLI:

`vercel connect token slack/acme-slack --subject app --installation-id inst_... --scopes channels:read`

In the CLI, `--installation-id` applies with `--subject app`. For machine-readable output that includes fields such as `expiresAt` and `installationId`, add `--format=json`.

Your code now receives a runtime token scoped to the requested action, which it can use to call the provider API. Request tokens at runtime, and don't persist them in long-lived environment variables or a database.

## Forward Slack webhooks to your projects

Vercel Connect can forward incoming webhooks to your projects through trigger forwarding. A connector can forward verified webhooks to up to three destination projects.

Enable trigger forwarding when you create a connector with `--triggers`, then register each destination project when you attach it:

`vercel connect attach slack/acme-slack --triggers --trigger-branch staging --trigger-path /slack`

`--trigger-branch` sets the Git branch for the destination and defaults to production. `--trigger-path` sets the path that receives forwarded webhooks and defaults to `/{service}`. Detaching a project removes its token access but doesn't remove it from the connector's trigger destinations, so manage trigger destinations separately.

## Best practices

*   Use a separate connector per environment. Giving production, preview, and development their own connectors ensures each has its own authorization grant, scopes, and audit trail, so a token compromised in one environment can't be replayed against another.
    
*   Request the minimum required scopes. Set provider scopes only for the actions the workload performs, rather than requesting broad access.
    
*   Keep tokens out of storage. Request tokens at runtime and avoid persisting them in long-lived environment variables or a database.
    
*   Target a specific installation when needed. Pass `installationId` in the SDK, or `--installation-id` with `--subject app` on the CLI, to act against a particular Slack workspace or GitHub organization.
    

## Pricing

Vercel Connect is billed per token request.

| Plan       | Token request pricing                                 |
| ---------- | ----------------------------------------------------- |
| Hobby      | 5,000 token requests per month, included at no charge |
| Pro        | $3 per 10,000 token requests                          |
| Enterprise | $3 per 10,000 token requests                          |

See [Pricing and Limits](https://vercel.com/docs/connect/pricing) for the full table and the platform limits that apply during beta.

## Vercel CLI commands

The `vercel connect` command manages connectors from the terminal. Connectors are identified by their UID (`slack/my-bot`) or ID (`scl_abc123`).

| Command                 | Description                                           |
| ----------------------- | ----------------------------------------------------- |
| `vercel connect create` | Create a connector for a service.                     |
| `vercel connect list`   | List connectors for your team or project (also `ls`). |
| `vercel connect token`  | Request a runtime token from a connector.             |
| `vercel connect attach` | Attach a project to a connector.                      |
| `vercel connect detach` | Detach a project from a connector.                    |
| `vercel connect update` | Update connector branding such as icon and colors.    |
| `vercel connect remove` | Delete a connector (also `rm`).                       |
| `vercel connect open`   | Open a connector in the Vercel dashboard.             |

By default, `vercel connect list` shows only connectors linked to the current project. Add `--all-projects` to list all connectors in the team. Removing a connector with attached projects fails unless you pass `--disconnect-all` to detach them first. Run `vercel connect --help` to review the current CLI surface.

## Known limitations

*   Trigger forwarding supports Slack only.
    
*   Connector branding fields can't be fully cleared after you set them.
    
*   Token revocation and token lifetime depend on provider support.
    

## When to use Vercel Connect or Integrations

Use Vercel Connect when you need delegated runtime credentials and user authorization for agent workflows, such as running an agent that needs project-scoped access to a Slack workspace, linking a single connector to multiple projects and environments, or requesting user-authorized provider tokens at runtime instead of storing long-lived secrets.

Use Vercel Integrations when you want marketplace-managed installs and provider-managed products in the Vercel Marketplace.

## Related resources and next steps

*   Follow [Vercel Connect quickstart](https://vercel.com/docs/connect/quickstart) for the first-setup walkthrough.
    
*   Read the [Vercel Connect overview](https://vercel.com/docs/connect) for concepts, limitations, and product boundaries.
    
*   See the [Vercel Connect CLI reference](https://vercel.com/docs/cli/connect) for every subcommand and option.
    
*   Explore [Vercel Integrations](https://vercel.com/docs/integrations) if you need marketplace integration installs.

---

[View full KB sitemap](/kb/sitemap.md)
