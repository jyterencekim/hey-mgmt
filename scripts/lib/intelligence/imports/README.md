# imports/

Drop `graph-exchange/v0` JSONL files here (gitignored). Each line is one record:

```json
{"record":"node","id":"auditor:strategy:pt-usdg","kind":"strategy","memory":"semantic","title":"PT-USDG","as_of":"2026-09-14T00:00:00Z"}
{"record":"edge","src":"auditor:strategy:pt-usdg","rel":"auditor:allocates_to","dst":"auditor:market_venue:pendle","asserted_by":"agent:auditor","asserted_at":"2026-09-14","evidence":["src:auditor/fact_row/1234"],"strength":"source_asserted","status":"accepted"}
```

`kg build` merges every file here with the mgmt-derived graph. The auditor's
`protocol_knowledge` export is the first intended producer; see `ARCHITECTURE.md`.
