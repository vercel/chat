# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately to [responsible.disclosure@vercel.com](mailto:responsible.disclosure@vercel.com), not through a public issue or pull request. Do not include live credentials or other people's private messages.

We will investigate all legitimate reports and do our best to quickly fix the problem.

## Scope

This policy covers code maintained in this repository: the `chat` package, official platform and state adapters, shared utilities, and `create-chat-sdk` templates. Security issues in our documented setup instructions and examples are also in scope.

Messaging platforms, provider SDKs, hosting services, and independently maintained adapters have their own security processes. Report defects isolated to those projects to their maintainers. Problems caused by how Chat SDK integrates with them remain in scope here. If ownership is unclear, send us the report and we can help triage it.

## Valid reports

We welcome reports showing that Chat SDK fails to protect a security boundary in a supported, documented usage. Examples include:

- Forged webhook requests or interactions passing the adapter's configured verification
- Events being accepted for the wrong configured bot, installation, workspace, or mailbox
- Messages, history, credentials, or actions crossing user, tenant, or conversation boundaries because of SDK routing or state handling
- Bot credentials being sent to an attacker-controlled destination, or attachment handling enabling server-side request forgery
- Bypasses of configured tool scope, approver restrictions, or other SDK-enforced access checks
- Attacker-controlled events causing code execution or disproportionate resource exhaustion, including one recipient's failure indefinitely preventing other conversations from progressing

These examples are not exhaustive. An attacker may be a legitimate platform user: a signed webhook can still carry attacker-controlled content, links, and attachments.

## Application responsibilities

Chat SDK connects applications to messaging platforms; it does not provide a complete application authorization system. When assessing a report, distinguish the following boundaries:

- **Event authenticity and user authorization.** Verifying an event establishes its source, not whether the sender may run an application's commands, access private data, or invoke privileged tools. Applications must enforce those permissions.
- **Bot access and user access.** API calls use the bot's credentials. AI tool conversation scope is not a per-user membership check. See [tool scope and its limitations](https://chat-sdk.dev/docs/ai/ai-sdk-tools).
- **Approvals.** Applications must configure who may approve consequential actions. A genuine button click does not establish that the person is an authorized approver. See [approval permissions](https://chat-sdk.dev/docs/approvals#who-can-approve).
- **Custom verification and transports.** Replacing webhook verification or a download transport transfers the responsibilities documented for that extension to application code. It does not remove the SDK's responsibility for the checks it still promises to enforce.
- **AI behavior.** Messages and attachments remain untrusted input. Chat SDK does not guarantee that a model resists prompt injection. A model choosing an action within permissions deliberately granted to it is distinct from bypassing SDK-enforced scope or approval checks.

Insecure defaults, misleading security documentation, and unsafe examples are not excluded merely because an application could add its own mitigation.

## What does not establish an SDK vulnerability

- Application code exposing secrets or granting access without the necessary authorization, without a defect in Chat SDK or its documented guidance
- Accepting unsigned requests after explicitly disabling verification without the documented replacement verifier or trusted verifying proxy
- A dependency advisory or scanner finding without evidence that Chat SDK's use of the dependency is affected
- Requests for additional hardening without a demonstrated security impact; for example, the absence of application-specific rate limits alone
- A demonstration that starts with an already-compromised server or stolen credentials, unless Chat SDK enables a further boundary violation

Reports produced with automated tools are welcome, but should explain the reachable behavior and impact rather than only include scanner output.

## What to include

- Affected package versions, adapter, runtime, and relevant configuration, with secrets removed
- The attacker's access and the entry point they control, including whether events come through a real provider or a direct request
- A minimal reproduction or precise steps, expected behavior, observed behavior, and security impact
- Any custom verifier, transport, state implementation, or subclass involved

Where practical, check the latest release and note whether the issue also affects `main`. If a working reproduction is not safe or feasible, explain why and share the evidence you have. Test only with accounts and infrastructure you are authorized to use.

If you are unsure whether a report qualifies, please send it privately. You do not need to prove every part of an exploit chain before asking us to investigate.
