/** Small DOM helpers, so the CodeMirror widgets stay readable. */

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  node.append(...children)
  return node
}

export function button(
  label: string,
  className: string,
  onClick: () => void,
): HTMLButtonElement {
  const node = element('button', className, label)
  node.type = 'button'
  node.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick()
  })
  return node
}
