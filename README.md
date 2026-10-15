# archviz

Interactive class-architecture diagrams for AI coding agents.

![archviz demo: editing a class diagram and sending the changes to the agent](docs/demo.gif)

The agent writes a small JSON model of your classes. archviz opens it in the browser as an editable UML class diagram, so you can review the design before any code is written:

- **Edit it directly.** Drag classes, make one an interface or abstract, draw inheritance and other relations, rename, edit members, group classes into packages. Undo/redo with Ctrl+Z.
- **Talk to the agent.** Comment on any class or relation, then **Send feedback**, or **Approve** the design so the agent implements it. The agent answers in the editor.
- **See what the agent did.** After each round, added, changed and removed classes and relations are marked (removed ones stay as faded ghosts) and listed in a "What the agent changed" panel.
- **Your layout stays put.** Classes you placed never move; new ones appear next to their relatives. "Tidy up" re-arranges everything on demand, and it can be undone.
- **Readable at scale.** Orthogonal arrows, edge labels and multiplicities, a legend, collapsible packages, search (`/`) and focus mode (double-click a class to show only it and its neighbours).
- **Check it against the code.** Classes can link to their source file and open it in your editor.
- **Best-practice checks** run while you edit: inheritance cycles, interfaces extending classes, `extends` vs `implements`, multiple inheritance (TypeScript / Python rules), missing implementations, unused abstractions, deep hierarchies, god classes and fat interfaces.
- **Export** as Mermaid (renders on GitHub), SVG or PNG.

It runs locally with no dependencies and works with any agent that can run shell commands. Node 20+.

## Install

```sh
git clone https://github.com/gagrinasg/archviz.git
cd archviz && npm link      # puts `archviz` on your PATH
```

To teach Claude Code the workflow, install the skill:

```sh
mkdir -p ~/.claude/skills/archviz && cp SKILL.md ~/.claude/skills/archviz/
```

## Use

```sh
archviz check  examples/shapes.json        # print rule violations
archviz open   examples/shapes.json        # open the editor in your browser
archviz poll   examples/shapes.json        # wait for Send/Approve, print the feedback JSON
archviz reply  examples/shapes.json "…"    # show a message to the user in the editor
archviz export examples/shapes.json        # print a Mermaid classDiagram
```

In the editor, press `?` for all shortcuts. The basics:
- Drag a box to move it. Shift-click or Shift-drag selects several, and they move together.
- Drag the ● handle onto another box and choose the relation type.
- Double-click a class name to rename it, a class body to focus on it, or the canvas to add a class. `N` / `I` add a class / interface at the mouse.
- Click a class or relation to edit it, label it or comment on it. Del removes the selection.

"Open in editor" links use VS Code by default (including WSL). Set `ARCHVIZ_EDITOR_URL` for another editor, e.g. `cursor://file{path}:{line}`.

See [SKILL.md](SKILL.md) for the model schema and the feedback format.

## Contributing

Run `npm test` for the tests. Commits are scanned for secrets with [gitleaks](https://github.com/gitleaks/gitleaks):

```sh
pip install pre-commit && pre-commit install
```

## License

[MIT](LICENSE)
