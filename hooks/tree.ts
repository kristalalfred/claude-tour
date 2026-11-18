export type TreeFile = { path: string; steps: number[] }

export type TreeRow = { guide: string; name: string; file?: TreeFile }

type Node = { name: string; children: Node[]; file?: TreeFile; first: number }

function insert(root: Node, file: TreeFile): void {
  const parts = file.path.split('/').filter(part => part !== '')

  if (file.path.startsWith('/') && parts.length > 0) {
    parts[0] = `/${parts[0]}`
  }
  const first = Math.min(...file.steps)
  let node = root

  for (const [index, part] of parts.entries()) {
    const isLeaf = index === parts.length - 1
    let child = node.children.find(
      candidate => candidate.name === part && (candidate.file !== undefined) === isLeaf,
    )

    if (child === undefined) {
      child = { name: part, children: [], first, ...(isLeaf ? { file } : {}) }
      node.children.push(child)
    }
    child.first = Math.min(child.first, first)
    node = child
  }
}

function collapse(node: Node): Node {
  let current = node

  while (current.file === undefined && current.children.length === 1) {
    const only = current.children[0] as Node

    current = { ...only, name: `${current.name}/${only.name}` }
  }

  return {
    ...current,
    children: current.children.map(collapse).sort((a, b) => a.first - b.first),
  }
}

function walk(nodes: readonly Node[], indent: string, isTop: boolean, rows: TreeRow[]): void {
  for (const [index, node] of nodes.entries()) {
    const isLast = index === nodes.length - 1
    const branch = isTop ? '' : isLast ? '└─ ' : '├─ '
    const name = node.file === undefined ? `${node.name}/` : node.name

    rows.push({ guide: indent + branch, name, ...(node.file ? { file: node.file } : {}) })
    walk(node.children, isTop ? '' : indent + (isLast ? '   ' : '│  '), false, rows)
  }
}

export function treeRows(files: readonly TreeFile[]): TreeRow[] {
  const root: Node = { name: '', children: [], first: 0 }

  for (const file of files) {
    insert(root, file)
  }
  const tops = root.children.map(collapse).sort((a, b) => a.first - b.first)
  const rows: TreeRow[] = []

  walk(tops, '', true, rows)

  return rows
}
