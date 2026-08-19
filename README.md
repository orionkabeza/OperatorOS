# OperatorOS

Business operations platform for mid-sized African retail businesses. See `OperatorOS-Spec.md` for the full product/design/data-model spec. The engineering rebuild is planned in `docs/plans/` (currently `phase-0.md`, awaiting approval) and decisions are logged in `docs/DECISIONS.md`.

## Design references

`prototype.html` at the repo root is the primary design reference (open it directly in a browser — no server needed): the Shutter sign-in, the Tally Rail, a working Counter, and Back Office → Analytics. Match it pixel-for-pixel wherever `OperatorOS-Spec.md` Part B underspecifies something. Other rooms are stubbed there.

`design-reference/` holds additional high-fidelity, interactive screens imported from the Claude Design MCP for the rooms `prototype.html` doesn't cover yet — reference material only, not production code (see `docs/DECISIONS.md`). To view one, serve the folder over HTTP (the runtime does a same-origin `fetch`, so opening the file directly via `file://` won't work) and open it in a browser:

```
cd design-reference
python3 -m http.server 8791
# then open http://127.0.0.1:8791/debt-book-stock-room.dc.html
```

Currently covers: Debt Book, Stock Room (incl. the full stock-take flow: scope → blind count → variance review).