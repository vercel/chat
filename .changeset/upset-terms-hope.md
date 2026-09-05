---
"@chat-adapter/whatsapp": minor
---

export `WhatsAppApiError` for non-2xx Graph API responses. It carries Meta's numeric `errorCode`, `providerMessage`, `type`, `details`, `subcode`, `traceId`, the HTTP `status`, and the `raw` envelope, and maps `code` onto the shared `AdapterError` taxonomy (`RATE_LIMITED`, `AUTH_FAILED`, `PERMISSION_DENIED`, `NOT_FOUND`). Transport failures and unparseable response bodies now throw `NetworkError` instead of leaking raw fetch errors, and error messages carry Meta's message or a bounded excerpt instead of the full response body.
