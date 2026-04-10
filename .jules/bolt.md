## 2024-06-25 - Unified/Remark Processor Bottleneck
**Learning:** Instantiating `unified()` processors with plugins (`remarkParse`, `remarkGfm`, `remarkStringify`) on every call is a significant performance bottleneck in high-throughput parsing/stringifying scenarios.
**Action:** Always cache the processor instance at the module level (using static instance for parsing and a Map based on options for stringifying) rather than recreating them per call.
