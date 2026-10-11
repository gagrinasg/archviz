---
name: archviz
description: Show a class architecture as an interactive, editable UML diagram the user can rearrange, edit (inheritance, interfaces, members) and comment on, then send back. Use whenever you draft or change a class design, or the user asks to see/review/edit the class architecture.
---

# archviz

You write a JSON model; the user edits it visually in the browser and sends the edits back to you.

## Loop
1. Write the model to `.archviz/<name>.json` (schema below). Reuse the file across rounds.
2. `archviz check .archviz/<name>.json` — fix errors you introduced before showing it.
3. `archviz open .archviz/<name>.json` — prints the URL and opens the browser. Tell the user the URL.
4. `archviz poll .archviz/<name>.json` — blocks until the user presses **Send**, prints the feedback JSON.
   In Claude Code run it with `run_in_background: true` (you are notified when it exits) or with `--timeout 540` and re-run on exit code 3. Feedback is never lost between polls.
5. Apply the feedback (see below), rewrite the model file. The browser reloads it automatically and highlights what changed. Go back to 4 until the user stops sending.

## Model
```json
{
  "language": "typescript",
  "classes": [
    { "id": "Repository", "kind": "interface", "attributes": [], "methods": ["+get(id: string): T", "+save(item: T): void"] },
    { "id": "BaseRepo", "kind": "abstract", "attributes": ["#db: Db"], "methods": ["+save(item: T): void", "+get(id: string): T {abstract}"] },
    { "id": "UserRepo", "kind": "class", "attributes": [], "methods": ["+get(id: string): User"], "note": "optional free text" }
  ],
  "relations": [
    { "from": "BaseRepo", "to": "Repository", "type": "implements" },
    { "from": "UserRepo", "to": "BaseRepo", "type": "extends" }
  ]
}
```
- `language`: `"python"`, `"typescript"` or `null` (language-agnostic). Changes which rules apply.
- `kind`: `class` | `abstract` | `interface` (Python: ABC/Protocol) | `enum`.
- `type`: `extends` | `implements` | `composition` | `aggregation` | `association` | `dependency`. `from` is the subclass / the whole / the user; `to` is the parent / the part / the used.
- Members are UML-ish strings: `+public`, `-private`, `#protected`. Mark abstract methods with `{abstract}` or `abstract name()`.
- `layout` is written by the UI when the user drags boxes. Keep it when you rewrite the file; omit positions for new classes (they are auto-placed).

## Feedback (poll output)
```json
{
  "summary": ["Make Polygon abstract", "Square extends Polygon"],
  "ops": [{ "op": "setKind", "id": "Polygon", "kind": "abstract" }, { "op": "addRelation", "from": "Square", "to": "Polygon", "type": "extends" }],
  "comments": [{ "target": "Shape", "text": "Should Shape expose name()?" }],
  "message": "free text for you",
  "model": { "...": "the full model with the user's edits already applied" },
  "violations": [{ "severity": "warn", "rule": "missing-implementation", "target": "Square", "message": "..." }]
}
```
If the user sent several times before you polled, you get an array of these, oldest first.
- `model` is the user's intended design: start from it, then act on `comments` / `message` (answer questions, make the requested changes) and fix `violations`.
- Comment `target` is a class id, a relation key `from|type|to`, or `null` (general).
- Op kinds: `addClass`, `removeClass`, `renameClass`, `setKind`, `setMembers`, `addRelation`, `removeRelation`, `setRelationType`.
- If the user asked you to change code too, change the code, then write the model that matches it.
- When you disagree with an edit (e.g. it breaks a best practice), still write your best version and explain in chat.
