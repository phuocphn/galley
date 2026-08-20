import { useMemo } from 'react'
import type { DraftSummary } from '../../shared/types.js'

interface FolderNode {
  kind: 'folder'
  name: string
  path: string
  children: TreeNode[]
}

interface DraftNode {
  kind: 'draft'
  name: string
  path: string
  openNoteCount: number
}

type TreeNode = FolderNode | DraftNode

/** Rebuild the Review's folder structure from the flat listing the API returns. */
function buildTree(drafts: DraftSummary[]): TreeNode[] {
  const root: FolderNode = { kind: 'folder', name: '', path: '', children: [] }

  for (const draft of drafts) {
    const segments = draft.path.split('/')
    const fileName = segments.pop()!
    let folder = root

    for (const segment of segments) {
      const folderPath = folder.path ? `${folder.path}/${segment}` : segment
      let next = folder.children.find(
        (child): child is FolderNode => child.kind === 'folder' && child.name === segment,
      )
      if (!next) {
        next = { kind: 'folder', name: segment, path: folderPath, children: [] }
        folder.children.push(next)
      }
      folder = next
    }

    folder.children.push({
      kind: 'draft',
      name: fileName,
      path: draft.path,
      openNoteCount: draft.openNoteCount,
    })
  }

  // Folders before Drafts, alphabetical within each.
  function sort(nodes: TreeNode[]): TreeNode[] {
    nodes.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1,
    )
    for (const node of nodes) if (node.kind === 'folder') sort(node.children)
    return nodes
  }

  return sort(root.children)
}

interface FileTreeProps {
  drafts: DraftSummary[]
  selectedPath: string | undefined
  onSelect: (path: string) => void
}

export function FileTree({ drafts, selectedPath, onSelect }: FileTreeProps) {
  const tree = useMemo(() => buildTree(drafts), [drafts])

  if (drafts.length === 0) {
    return (
      <p className="px-4 py-3 text-[13px] leading-relaxed text-[var(--review-dim)]">
        No Drafts here. This Review has no <code>.md</code>, <code>.html</code>, or{' '}
        <code>.txt</code> files.
      </p>
    )
  }

  return (
    <ul className="py-1">
      {tree.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}

interface TreeItemProps {
  node: TreeNode
  depth: number
  selectedPath: string | undefined
  onSelect: (path: string) => void
}

function TreeItem({ node, depth, selectedPath, onSelect }: TreeItemProps) {
  const indent = { paddingLeft: `${12 + depth * 14}px` }

  if (node.kind === 'folder') {
    return (
      <li>
        <div
          style={indent}
          className="flex items-center gap-1.5 py-1 pr-3 text-[13px] font-semibold text-[var(--review-dim)]"
        >
          <FolderIcon />
          {node.name}
        </div>
        <ul>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </ul>
      </li>
    )
  }

  const isSelected = node.path === selectedPath
  return (
    <li>
      <button
        type="button"
        style={indent}
        onClick={() => onSelect(node.path)}
        aria-current={isSelected ? 'true' : undefined}
        className={`flex w-full items-center gap-1.5 py-1 pr-3 text-left text-[13px] ${
          isSelected
            ? 'bg-[#ddf4ff] font-semibold text-[var(--review-text)]'
            : 'text-[var(--review-text)] hover:bg-[var(--review-muted)]'
        }`}
      >
        <DraftIcon />
        <span className="truncate">{node.name}</span>
        {node.openNoteCount > 0 && (
          <span
            className="ml-auto shrink-0 rounded-full bg-[var(--review-accent)] px-1.5 text-[11px] font-semibold text-white"
            title={`${node.openNoteCount} open ${node.openNoteCount === 1 ? 'Note' : 'Notes'}`}
          >
            {node.openNoteCount}
          </span>
        )}
      </button>
    </li>
  )
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.75 1h4.086a1.75 1.75 0 0 1 1.238.513l1.06 1.06c.048.048.111.075.177.075h5.939c.966 0 1.75.784 1.75 1.75v8.852A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75C0 1.784.784 1 1.75 1Z" />
    </svg>
  )
}

function DraftIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0 text-[var(--review-dim)]"
    >
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm8.75.75v2.5c0 .138.112.25.25.25h2.5Z" />
    </svg>
  )
}
