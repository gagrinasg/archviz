// Shared by the browser (ui.html) and the CLI. Pure functions, no deps.

export const KINDS = ['class', 'abstract', 'interface', 'enum'];
export const RELATIONS = ['extends', 'implements', 'composition', 'aggregation', 'association', 'dependency'];

const LIMITS = { depth: 3, attributes: 10, methods: 15, interfaceMethods: 7 };

// Method signature -> bare name: "+area(): number" -> "area"
const methodName = (m) => m.replace(/^[+\-#~\s]*/, '').replace(/^abstract\s+/, '').split('(')[0].trim();
// "+area(): number {abstract}" or "+abstract area(): number"
const isAbstract = (m) => /\{abstract\}|^[+\-#~\s]*abstract\s/.test(m);

export function check(model) {
  const out = [];
  const add = (severity, rule, target, message) => out.push({ severity, rule, target, message });
  const lang = model.language || null;
  const byId = new Map(model.classes.map((c) => [c.id, c]));
  const rels = model.relations || [];

  for (const r of rels) {
    for (const end of [r.from, r.to]) {
      if (!byId.has(end)) add('error', 'unknown-id', relKey(r), `Relation ${r.from} -> ${r.to} references unknown "${end}"`);
    }
  }
  const valid = rels.filter((r) => byId.has(r.from) && byId.has(r.to));
  const isa = valid.filter((r) => r.type === 'extends' || r.type === 'implements');
  const parents = (id) => isa.filter((r) => r.from === id).map((r) => r.to);

  for (const r of isa) {
    const from = byId.get(r.from), to = byId.get(r.to);
    if (r.type === 'extends') {
      if (from.kind === 'interface' && to.kind !== 'interface')
        add('error', 'interface-extends-class', relKey(r), `Interface ${from.id} cannot extend ${to.kind} ${to.id}`);
      if (from.kind !== 'interface' && to.kind === 'interface' && lang !== 'python')
        add('error', 'extends-interface', relKey(r), `${from.id} should implement ${to.id}, not extend it`);
    } else {
      if (to.kind !== 'interface')
        add('error', 'implements-non-interface', relKey(r), `${from.id} implements ${to.kind} ${to.id}; only interfaces can be implemented`);
      if (from.kind === 'interface')
        add('error', 'interface-implements', relKey(r), `Interface ${from.id} should extend ${to.id}, not implement it`);
    }
  }

  // Cycles: DFS over is-a edges.
  const state = new Map(); // 1 = visiting, 2 = done
  const visit = (id, path) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const cyc = path.slice(path.indexOf(id));
      add('error', 'inheritance-cycle', id, `Inheritance cycle: ${[...cyc, id].join(' -> ')}`);
      return;
    }
    state.set(id, 1);
    for (const p of parents(id)) visit(p, [...path, id]);
    state.set(id, 2);
  };
  for (const c of model.classes) visit(c.id, []);
  const cyclic = out.some((v) => v.rule === 'inheritance-cycle');

  for (const c of model.classes) {
    const classParents = valid.filter((r) => r.from === c.id && r.type === 'extends' && byId.get(r.to).kind !== 'interface');
    if (c.kind !== 'interface' && classParents.length > 1) {
      if (lang === 'typescript') add('error', 'multiple-inheritance', c.id, `${c.id} extends ${classParents.length} classes; TypeScript allows one`);
      else if (lang !== 'python') add('warn', 'multiple-inheritance', c.id, `${c.id} extends several classes; prefer one base + interfaces/composition`);
    }
    if ((c.attributes || []).length > LIMITS.attributes || (c.methods || []).length > LIMITS.methods)
      add('warn', 'god-class', c.id, `${c.id} is large (${(c.attributes || []).length} attributes, ${(c.methods || []).length} methods); consider splitting responsibilities`);
    if (c.kind === 'interface' && (c.methods || []).length > LIMITS.interfaceMethods)
      add('warn', 'fat-interface', c.id, `${c.id} has ${c.methods.length} methods; split it (interface segregation)`);
    if ((c.kind === 'interface' || c.kind === 'abstract') && !isa.some((r) => r.to === c.id))
      add('warn', 'unused-abstraction', c.id, `${c.kind} ${c.id} has no implementations`);
  }
  if (cyclic) return out; // ancestor walks below assume a DAG

  const ancestors = (id) => {
    const seen = new Set();
    const walk = (x) => parents(x).forEach((p) => { if (!seen.has(p)) { seen.add(p); walk(p); } });
    walk(id);
    return seen;
  };
  const depth = (id) => Math.max(0, ...parents(id).map((p) => 1 + depth(p)));

  for (const c of model.classes) {
    const d = depth(c.id);
    if (d > LIMITS.depth) add('warn', 'deep-hierarchy', c.id, `${c.id} is ${d} levels deep; favor composition over inheritance`);

    if (c.kind === 'class') {
      // Required: every interface method, plus abstract-marked methods of abstract parents.
      // Provided: methods of the class and its non-interface ancestors (minus abstract-marked ones).
      const chain = [c.id, ...ancestors(c.id)].map((id) => byId.get(id)).filter((k) => k.kind === 'class' || k.kind === 'abstract');
      const have = new Set(chain.flatMap((k) => (k.methods || []).filter((m) => !isAbstract(m)).map(methodName)));
      for (const id of ancestors(c.id)) {
        const a = byId.get(id);
        const required = a.kind === 'interface' ? a.methods || [] : a.kind === 'abstract' ? (a.methods || []).filter(isAbstract) : [];
        const missing = required.map(methodName).filter((m) => !have.has(m));
        if (missing.length) add('warn', 'missing-implementation', c.id, `${c.id} does not implement ${missing.join(', ')} from ${a.id}`);
      }
    }

    if (lang === 'python') {
      const ps = parents(c.id);
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++) {
          const shared = [...ancestors(ps[i]), ps[i]].filter((x) => ancestors(ps[j]).has(x) || x === ps[j]);
          if (shared.length) add('warn', 'diamond', c.id, `${c.id} inherits ${shared[0]} via both ${ps[i]} and ${ps[j]} (diamond; check MRO)`);
        }
    }
  }
  return out;
}

export const relKey = (r) => `${r.from}|${r.type}|${r.to}`;

// Apply one queued UI op to a model, returning a new model.
export function applyOp(model, op) {
  const m = structuredClone(model);
  m.relations ||= [];
  m.layout ||= {};
  const cls = (id) => {
    const c = m.classes.find((x) => x.id === id);
    if (!c) throw new Error(`No class "${id}"`);
    return c;
  };
  switch (op.op) {
    case 'addClass':
      if (m.classes.some((c) => c.id === op.id)) throw new Error(`"${op.id}" already exists`);
      m.classes.push({ id: op.id, kind: op.kind || 'class', attributes: [], methods: [] });
      if (op.x != null) m.layout[op.id] = { x: op.x, y: op.y };
      break;
    case 'removeClass':
      m.classes = m.classes.filter((c) => c.id !== op.id);
      m.relations = m.relations.filter((r) => r.from !== op.id && r.to !== op.id);
      delete m.layout[op.id];
      break;
    case 'renameClass':
      if (m.classes.some((c) => c.id === op.to)) throw new Error(`"${op.to}" already exists`);
      cls(op.id).id = op.to;
      m.relations.forEach((r) => { if (r.from === op.id) r.from = op.to; if (r.to === op.id) r.to = op.to; });
      if (m.layout[op.id]) { m.layout[op.to] = m.layout[op.id]; delete m.layout[op.id]; }
      break;
    case 'setKind':
      cls(op.id).kind = op.kind;
      break;
    case 'setMembers':
      Object.assign(cls(op.id), { attributes: op.attributes, methods: op.methods });
      break;
    case 'addRelation':
      cls(op.from); cls(op.to);
      if (!m.relations.some((r) => relKey(r) === relKey(op))) m.relations.push({ from: op.from, to: op.to, type: op.type });
      break;
    case 'removeRelation':
      m.relations = m.relations.filter((r) => relKey(r) !== relKey(op));
      break;
    case 'setRelationType': {
      const r = m.relations.find((x) => relKey(x) === relKey(op));
      if (!r) throw new Error('No such relation');
      r.type = op.newType;
      break;
    }
    case 'setRelationProps': {
      const r = m.relations.find((x) => relKey(x) === relKey(op));
      if (!r) throw new Error('No such relation');
      for (const f of ['label', 'fromMult', 'toMult']) { if (op[f]) r[f] = op[f]; else delete r[f]; }
      break;
    }
    case 'setPackage':
      if (op.package) cls(op.id).package = op.package;
      else delete cls(op.id).package;
      break;
    default:
      throw new Error(`Unknown op ${op.op}`);
  }
  return m;
}

const MERMAID_ARROW = { extends: '<|--', implements: '<|..', composition: '*--', aggregation: 'o--', association: '-->', dependency: '..>' };

// Mermaid classDiagram text (renders natively in GitHub/GitLab Markdown).
// ponytail: ids are squashed to Mermaid-safe names (generics <T> -> ~T~, other symbols -> _)
export function toMermaid(model) {
  const name = (id) => id.replace(/<([^<>]*)>/g, '~$1~').replace(/[^\w~]/g, '_');
  const member = (s) => {
    const abs = isAbstract(s);
    const t = s.replace(/\s*\{abstract\}/, '').replace(/^([+\-#~]?\s*)abstract\s+/, '$1')
      .replace(/\)\s*:\s*/, ') ').replace(/<([^<>]*)>/g, '~$1~');
    return abs ? `${t}*` : t;
  };
  const lines = ['classDiagram'];
  const emit = (c, ind) => {
    const body = [...(c.kind !== 'class' ? [`<<${c.kind === 'enum' ? 'enumeration' : c.kind}>>`] : []), ...(c.attributes || []).map(member), ...(c.methods || []).map(member)];
    if (!body.length) return lines.push(`${ind}class ${name(c.id)}`);
    lines.push(`${ind}class ${name(c.id)} {`, ...body.map((b) => `${ind}  ${b}`), `${ind}}`);
  };
  const pkgs = new Map();
  for (const c of model.classes) {
    if (c.package) { if (!pkgs.has(c.package)) pkgs.set(c.package, []); pkgs.get(c.package).push(c); }
    else emit(c, '  ');
  }
  for (const [p, cs] of pkgs) {
    lines.push(`  namespace ${p.replace(/\W/g, '_')} {`);
    cs.forEach((c) => emit(c, '    '));
    lines.push('  }');
  }
  for (const r of model.relations || []) {
    const isa = r.type === 'extends' || r.type === 'implements';
    const [a, b, ma, mb] = isa ? [r.to, r.from, r.toMult, r.fromMult] : [r.from, r.to, r.fromMult, r.toMult];
    lines.push(`  ${name(a)}${ma ? ` "${ma}"` : ''} ${MERMAID_ARROW[r.type]}${mb ? ` "${mb}"` : ''} ${name(b)}${r.label ? ` : ${r.label}` : ''}`);
  }
  return lines.join('\n') + '\n';
}
