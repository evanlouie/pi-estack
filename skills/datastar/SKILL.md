---
name: datastar
description: >-
  Build, edit, debug, or explain Datastar applications: hypermedia-first reactive HTML using data-* attributes, signals, backend actions, and Server-Sent Event DOM/signal patches. Use when adding Datastar to a web app; wiring data-bind/data-on/data-signals/data-text/data-show/data-class/data-attr; implementing @get/@post/@put/@patch/@delete requests; returning text/html, JSON, JavaScript, or text/event-stream responses; using Datastar backend SDKs; or migrating htmx/Alpine-style UI to Datastar.
---

# Datastar

Datastar is a lightweight, hypermedia-first frontend library. It combines backend-driven DOM/state updates (like htmx) with small frontend reactivity (like Alpine) using ordinary HTML `data-*` attributes. Prefer server-rendered HTML and SSE patches over SPA state unless the user explicitly wants a client-heavy app.

Official docs: <https://data-star.dev/>. If precise API details matter, fetch the current docs before coding because Datastar is still evolving. This skill was checked against the public docs and GitHub latest release on 2026-04-30; still prefer the docs and the installed SDK version over memory for exact helper names.

## Mental model

1. Add Datastar's browser script to server-rendered HTML.
2. Use `data-*` attributes to define and react to **signals** (global reactive variables referenced as `$name`).
3. Use actions such as `@get('/endpoint')` or `@post('/endpoint')` in `data-on:*` expressions to call the backend.
4. The backend responds with one of:
   - `text/html`: patch/morph returned top-level elements into matching DOM elements by `id`.
   - `application/json`: patch returned values into signals.
   - `text/javascript`: execute returned JS.
   - `text/event-stream`: stream one or more Datastar SSE events, usually `datastar-patch-elements` and/or `datastar-patch-signals`.

Default posture: the backend is the source of truth. Keep frontend expressions terse. Push business logic, validation, auth, persistence, and workflow decisions to the server.

## Installation

Pin a version when possible. The official getting-started docs and latest GitHub release currently show v1.0.1:

```html
<script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.1/bundles/datastar.js"></script>
```

For production, prefer self-hosting the bundle or otherwise pinning and integrity-checking it according to the project's deployment practices.

## Core frontend attributes

Signals are global and are referenced in expressions with `$`. Hyphenated keys on signal-defining attributes become camelCase (`data-bind:first-name` creates `$firstName`); non-signal keys such as class names and event names default to kebab-case. Nested signals use dot notation (`user.name`). Setting a signal to `null` or `undefined` removes it. Signals whose path segment starts with `_` are not sent to the backend by default unless request filtering opts them in.

```html
<div data-signals="{count: 0, user: {name: ''}}">
  <input data-bind:user.name placeholder="Name">
  <button data-on:click="$count++">+1</button>
  <p data-text="`Hello ${$user.name || 'friend'} — ${$count}`"></p>
</div>
```

Use these frequently:

| Attribute | Purpose | Example |
| --- | --- | --- |
| `data-signals` / `data-signals:name` | initialize/patch signals | `data-signals="{open: false}"`, `data-signals:user.name="'Ada'"` |
| `data-bind` / `data-bind:name` | two-way bind inputs/selects/textareas | `<input data-bind:query>` |
| `data-text` | set textContent from an expression | `<span data-text="$query.toUpperCase()"></span>` |
| `data-computed:name` | read-only derived signal | `data-computed:valid="$query.length > 2"` |
| `data-show` | toggle visibility | `<button data-show="$valid" style="display:none">Search</button>` |
| `data-class` / `data-class:name` | toggle classes | `data-class:active="$open"` |
| `data-attr` / `data-attr:name` | set attributes | `data-attr:disabled="!$valid"` |
| `data-style` / `data-style:name` | set inline style properties | `data-style:display="$hidden && 'none'"` |
| `data-on:event` | listen for events and run expression/actions | `data-on:click="$open = !$open"` |
| `data-indicator:name` | create loading indicator signal for fetches | `data-indicator:saving data-attr:disabled="$saving"` |
| `data-init` | run expression when initialized/patched | `data-init="@get('/initial')"` |
| `data-effect` | run expression on load and when referenced signals change | `data-effect="$total = $qty * $price"` |
| `data-ref:name` | create a signal containing the element reference | `data-ref:panel` |
| `data-json-signals` | render signals as JSON for debugging | `<pre data-json-signals></pre>` |
| `data-preserve-attr` | preserve named attributes across morphing | `data-preserve-attr="open class"` |
| `data-ignore` | prevent Datastar processing unsafe/third-party DOM | `<div data-ignore>...</div>` |
| `data-ignore-morph` | skip morphing for element/children | useful around widgets |

Attribute evaluation order matters: attributes are applied in DOM order. Put `data-indicator:*` before a `data-init` that depends on it.

## Expressions

Datastar expressions are JavaScript-like strings evaluated with Datastar-provided locals (implemented with `Function()` in current builds). Do not treat this as a security sandbox. Available variables include:

- `$signalName` for reactive signal values.
- `el` for the element that owns the attribute.
- `evt` in event handlers.
- Datastar actions prefixed with `@`.

```html
<button data-on:click="$confirmed && @post('/launch')">Launch</button>
<button data-on:click="$ready = true; @post('/ready')">Ready</button>
```

Rules of thumb:

- Multiple statements require semicolons; line breaks alone are not statement separators.
- Computed expressions should be pure. Use `data-effect` or `data-on:*` for side effects.
- Keep expressions small. If logic grows, move it to the backend, a small external function, or a web component. Datastar's recommended encapsulation is "props down, events up".
- Async functions called from expressions are not awaited by Datastar; dispatch a custom event when async work completes.

## Backend actions and requests

Backend actions go in expressions:

```html
<button data-on:click="@get('/items')">Refresh</button>
<form id="todo-form"
      data-on:submit="@post('/todos', {contentType: 'form'})"
      data-indicator:saving>
  <input name="title" required>
  <button data-attr:disabled="$saving">Save</button>
</form>
```

Backend fetch actions: `@get(uri, options)`, `@post`, `@put`, `@patch`, `@delete`. The standard bundle also includes non-fetch actions such as `@peek`, `@setAll`, and `@toggleAll`.

Important defaults:

- `Datastar-Request: true` header is sent.
- For JSON requests, all non-local signals are sent: `GET` and `DELETE` as `?datastar=<json>`, `POST`/`PUT`/`PATCH` as a JSON body.
- `contentType: 'form'` sends closest/selected form using form encoding and form validation; signals are not sent. Use multipart form `enctype` for file uploads.
- `openWhenHidden` defaults to `false` for `GET` requests and `true` for other methods.
- Requests on the same element are cancelled by default when a new one starts (`requestCancellation: 'auto'`).

Common options:

```html
<button data-on:click="@get('/updates', {
  filterSignals: {include: /^filters\./, exclude: /secret/},
  headers: {'X-CSRF-Token': $csrf},
  openWhenHidden: true,
  requestCancellation: 'disabled',
  retry: 'auto',
  retryInterval: 1000,
})">Load</button>
```

Use `data-indicator:name` to expose request lifecycle as a boolean signal:

```html
<button data-on:click="@post('/save')" data-indicator:saving data-attr:disabled="$saving">
  Save
</button>
<span data-show="$saving" style="display:none">Saving…</span>
```

## Backend responses

### `text/html`

Return top-level elements with stable `id` attributes. Datastar morphs them into matching DOM nodes.

```http
Content-Type: text/html

<div id="todos">
  <article id="todo-1">Buy milk</article>
</div>
```

Optional headers for HTML responses:

- `datastar-selector: #target`
- `datastar-mode: outer|inner|remove|replace|prepend|append|before|after`
- `datastar-use-view-transition: true`

### `application/json`

Return JSON to patch signals.

```http
Content-Type: application/json

{"saved":true,"message":"Done"}
```

Use header `datastar-only-if-missing: true` to avoid overwriting existing signals.

### `text/javascript`

Return JavaScript only as an escape hatch for trusted code. Datastar executes it in the browser.

```http
Content-Type: text/javascript
datastar-script-attributes: {"type":"module"}

console.log('server action complete')
```

The optional `datastar-script-attributes` response header is a JSON-encoded object of attributes to set on the injected script element.

### `text/event-stream`

Use SSE for multiple patches, streaming, or long-lived updates. Prefer SDK helpers when available; otherwise write the exact event format. Every SSE event ends with a blank line. The current v1 event names are `datastar-patch-elements` and `datastar-patch-signals` (not `merge-fragments`/`merge-signals`).

Patch elements:

```text
event: datastar-patch-elements
data: elements <div id="status">Saved</div>

```

Patch with options:

```text
event: datastar-patch-elements
data: selector #messages
data: mode append
data: elements <li id="msg-42">Hello</li>

```

Patch signals:

```text
event: datastar-patch-signals
data: signals {saved: true, count: 3}

```

Remove signals by setting them to `null`:

```text
event: datastar-patch-signals
data: signals {draft: null}

```

`datastar-patch-elements` modes: `outer` (default, recommended), `inner`, `replace`, `prepend`, `append`, `before`, `after`, `remove`. Additional fields include `selector`, `namespace svg|mathml`, and `useViewTransition true`. `datastar-patch-signals` supports `onlyIfMissing true` plus the `signals` line.

## Raw SSE helper pattern

When there is no SDK, implement a tiny helper that sets SSE headers and writes line-prefixed events. Split multi-line HTML so each line is prefixed with `data: elements `.

Pseudo-code:

```text
headers:
  Content-Type: text/event-stream
  Cache-Control: no-cache
  Connection: keep-alive

event datastar-patch-elements:
  write "event: datastar-patch-elements\n"
  for each line in html.splitlines():
    write "data: elements " + line + "\n"
  write "\n"
  flush

event datastar-patch-signals:
  write "event: datastar-patch-signals\n"
  write "data: signals " + json_or_data_signals_object + "\n\n"
  flush
```

For production, prefer an official SDK because it handles headers, escaping/formatting, and framework integration.

## Backend SDKs

Official/community SDKs exist for Clojure, C#/.NET, Go, Haskell, Java, Kotlin, PHP (including Craft CMS/Laravel integrations), Python, Ruby, Rust, Scala/ZIO HTTP, TypeScript (Node/Deno/Bun), PocketPages, and Unison.

When coding, choose the SDK that matches the project stack and inspect its README/examples if exact names are needed:

- Go: module `github.com/starfederation/datastar-go`, import package `github.com/starfederation/datastar-go/datastar`; commonly `datastar.NewSSE(w, r)`, `sse.PatchElements(...)`, `sse.PatchElementTempl(...)`, `sse.PatchSignals(...)`, `sse.MarshalAndPatchSignals(...)`, `datastar.ReadSignals(r, &signals)`.
- Python: `datastar-py`, framework adapters such as FastAPI/Sanic helpers, `read_signals(request)`, `ServerSentEventGenerator`/response decorators.
- TypeScript: `starfederation/datastar-typescript` for Node/Deno/Bun.
- .NET: `StarFederation.Datastar`, DI service with patch helpers.

Do not invent SDK method names beyond what you verify in the local project or current SDK docs.

## Reading signals server-side

For JSON requests, all non-local signals are available on the backend:

- Official action behavior: `GET` and `DELETE` send the `datastar` query parameter; `POST`/`PUT`/`PATCH` JSON methods send a JSON body.
- SDKs usually provide `ReadSignals`/`read_signals` helpers. Use those helpers when available because installed SDK versions encode these method rules for you.

Validate everything on the backend. Signals are visible to and modifiable by users.

## Design patterns

- Use stable IDs on top-level patch elements and important nested elements so morphing preserves input state, event listeners, focus, and transitions.
- Return the next allowed UI from the backend. For example, after saving, patch the form, errors, list row, and buttons rather than pushing complex client state.
- For progressive UX, stream SSE events: set loading state, append partial output, patch final HTML, patch `loading:false`.
- Use `data-show` with initial `style="display:none"` to avoid flashes of hidden UI.
- Use `data-preserve-attr` or `data-ignore-morph` when morphing would otherwise clobber browser-managed state or third-party widgets.
- Avoid broad morph targets and duplicate IDs; patch the smallest stable container you own.
- Do not use Pro-only attributes/actions such as `data-persist`, `data-query-string`, `data-scroll-into-view`, or `@clipboard()` unless the project explicitly includes Datastar Pro/licensed bundles.
- Prefer `data-class`, `data-attr`, and `data-style` over imperative DOM manipulation.
- Use `data-on:submit` on forms when possible; Datastar prevents default submit behavior for `submit` listeners.

## Security and CSP

- Escape all user-controlled content before inserting it into HTML, attributes, expressions, or scripts.
- Never put secrets in signals; they are visible in page source/devtools and can be edited before being sent.
- Always perform backend authorization and validation. Treat signals as untrusted input.
- Use `data-ignore` around unescaped or third-party DOM that should not be interpreted as Datastar attributes.
- Datastar expressions use `Function()` internally; CSP must allow `script-src 'unsafe-eval'` for Datastar expressions to work.

## Debugging checklist

- Is the Datastar script loaded as `type="module"` and not blocked by CSP?
- Are the `data-*` attributes valid? Check browser console for Datastar errors.
- Did a hyphenated signal become camelCase? (`data-signals:foo-bar` is `$fooBar`, not `$foo-bar`.)
- Does returned HTML contain top-level elements with matching `id`s, or an explicit selector/mode?
- Is the response content type exactly appropriate (`text/html`, `application/json`, `text/javascript`, or `text/event-stream`)?
- For SSE, does every event end with a blank line, and is every data line prefixed correctly?
- Are request signals present where expected (`datastar` query param for GET/DELETE, body for POST/PUT/PATCH JSON methods unless an SDK helper documents otherwise)?
- Are indicators initialized before requests that use them?
- Is a previous request being cancelled because it was started on the same element? Consider `requestCancellation: 'disabled'` only when safe.

## Minimal examples

### Counter without backend

```html
<!doctype html>
<html>
  <head>
    <script type="module" src="/assets/datastar.js"></script>
  </head>
  <body>
    <main data-signals:count="0">
      <button data-on:click="$count--">−</button>
      <output data-text="$count"></output>
      <button data-on:click="$count++">+</button>
    </main>
  </body>
</html>
```

### Backend-driven search shell

```html
<section data-signals="{search: {q: ''}}">
  <input data-bind:search.q data-on:input__debounce.300ms="@get('/search')">
  <div id="results"></div>
</section>
```

Backend receives `search.q` and can return:

```http
Content-Type: text/html

<div id="results">
  <p>3 results for escaped query…</p>
</div>
```

### Streaming status

```html
<button data-on:click="@post('/jobs/42/run')" data-indicator:running data-attr:disabled="$running">
  Run job
</button>
<pre id="log"></pre>
```

SSE response:

```text
event: datastar-patch-elements
data: selector #log
data: mode append
data: elements <span>Started…</span>

event: datastar-patch-elements
data: selector #log
data: mode append
data: elements <span>Finished.</span>

```
