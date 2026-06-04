---
"diffx-cli": minor
---

Add `--tab-shutdown`: the server exits once the review tab closes (its SSE
client disconnects and none reconnect within a short grace), with a startup
grace if the UI is never opened. This lets a launched-and-backgrounded diffx
tear itself down instead of orphaning when the caller can't reliably kill it.
