# ADR-011: Excel with ExcelJS in tier 2

## Context

Excel export and import must round trip and be testable without a browser.

## Decision

Use ExcelJS in tier 2 inside a pure parsing/diff package (`excel`); tier 1 only uploads, downloads and renders the delta report. Rejected: Excel logic in the browser.

## Consequences

Round-trip tests run in Node. Heavy jobs run in the worker. Tier 1 stays logic-free.

## Status

Accepted
