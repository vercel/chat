---
"chat": patch
---

Create the default thread abort signal lazily instead of at module scope. The Workflow DevKit evaluation VM only provides ECMAScript built-ins, so the module-scope `new AbortController()` in this module — which is included in the serializer bundle for class registration — made every workflow in a consumer app fail to start with `ReferenceError: AbortController is not defined`.
