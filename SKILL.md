---
name: archviz
description: Show a class architecture as an interactive, editable UML diagram the user can rearrange, edit (inheritance, interfaces, members, packages) and comment on, then send back or approve. Use whenever you draft or change a class design, or the user asks to see/review/edit the class architecture.
---

# archviz

You write a JSON model. The user reviews and edits it as a diagram in the browser, then either sends feedback or approves it.

## Loop
1. Write the model to `.archviz/<name>.json` (schema below). Keep it in the repo and reuse the file across rounds, so the diagram changes in the same commit as the code.
2. `archviz check .archviz/<name>.json` — fix errors you introduced before showing it.
3. `archviz open .archviz/<name>.json` — prints the URL and opens the browser. Tell the user the URL.
4. `archviz poll .archviz/<name>.json` — blocks until the user presses **Send feedback** or **Approve**, prints the feedback JSON.
   In Claude Code run it with `run_in_background: true` (you are notified when it exits). In agents whose commands time out, use `--timeout 100` and re-run on exit code 3. Feedback is never lost between polls.
5. Act on the feedback (below), rewrite the model file, then explain what you did with `archviz reply`. The browser reloads the model and shows what changed (new / changed / removed) next to your reply. Go back to 4.
6. When the feedback has `"approved": true`, the user accepts the design (including any edits in `model`): implement it, update the model to match the code, and reply.

`archviz reply .archviz/<name>.json "Added RetryPolicy to Outbox because…"` shows a message in the editor (`-` reads it from stdin). Use it every round: answer each comment, and say why if you did not apply an edit.

`archviz export .archviz/<name>.json` prints a Mermaid `classDiagram` for READMEs, docs and PR descriptions (GitHub renders it).

## Model
```json
{
  "language": "typescript",
  "classes": [
    { "id": "Repository", "kind": "interface", "package": "data", "attributes": [], "methods": ["+get(id: string): T", "+save(item: T): void"] },
    { "id": "BaseRepo", "kind": "abstract", "package": "data", "file": "src/data/base-repo.ts", "line": 12,
      "attributes": ["#db: Db"], "methods": ["+save(item: T): void", "+get(id: string): T {abstract}"] },
    { "id": "UserRepo", "kind": "class", "file": "src/users/user-repo.ts", "attributes": [], "methods": ["+get(id: string): User"] }
  ],
  "relations": [
    { "from": "BaseRepo", "to": "Repository", "type": "implements" },
    { "from": "UserRepo", "to": "BaseRepo", "type": "extends" },
    { "from": "UserService", "to": "UserRepo", "type": "association", "label": "loads users via", "fromMult": "1", "toMult": "1" }
  ]
}
```
- `language`: `"python"`, `"typescript"` or `null` (language-agnostic). Changes which rules apply.
- `kind`: `class` | `abstract` | `interface` (Python: ABC/Protocol) | `enum`.
- `type`: `extends` | `implements` | `composition` | `aggregation` | `association` | `dependency`. `from` is the subclass / the whole / the user; `to` is the parent / the part / the used.
- Members are UML-ish strings: `+public`, `-private`, `#protected`. Mark abstract methods with `{abstract}` or `abstract name()`.
- Optional on classes: `package` (drawn as a group the user can collapse), `file` + `line` (relative to the directory archviz runs in, usually the repo root; the editor gets an "Open in editor" link). Fill `file`/`line` whenever the class exists in code, so the user can check the diagram against it.
- Optional on relations: `label`, `fromMult`, `toMult` (e.g. `"1"`, `"0..*"`).
- `layout` is written by the UI when the user moves boxes. Keep it when you rewrite the file and don't invent positions: new classes are placed next to their relatives, and existing ones never move.

## Feedback (poll output)
```json
{
  "approved": false,
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
- Op kinds: `addClass`, `removeClass`, `renameClass`, `setKind`, `setMembers`, `setPackage`, `addRelation`, `removeRelation`, `setRelationType`, `setRelationProps`.
- If the user asked you to change code too, change the code, then write the model that matches it.
- When you disagree with an edit (e.g. it breaks a best practice), still write your best version and explain it with `archviz reply`.
