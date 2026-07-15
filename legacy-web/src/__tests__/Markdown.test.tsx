import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Markdown } from '../Markdown'

describe('Markdown', () => {
  beforeEach(() => {
    // Ensure WASM parseMarkdownBlocks is not available by default
    const win = window as unknown as { parseMarkdownBlocks?: () => string }
    delete win.parseMarkdownBlocks
  })

  it('renders empty content as empty', () => {
    const { container } = render(<Markdown content="" />)
    expect(container.querySelector('.markdown-content')).toBeInTheDocument()
    expect(container.querySelector('.markdown-content')?.children.length).toBe(0)
  })

  it('renders h1 headers', () => {
    render(<Markdown content="# Hello World" />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Hello World')
  })

  it('renders h2 headers', () => {
    render(<Markdown content="## Sub Header" />)
    const h2 = screen.getByRole('heading', { level: 2 })
    expect(h2).toHaveTextContent('Sub Header')
  })

  it('renders h3 headers', () => {
    render(<Markdown content="### Sub Sub Header" />)
    const h3 = screen.getByRole('heading', { level: 3 })
    expect(h3).toHaveTextContent('Sub Sub Header')
  })

  it('renders blockquotes', () => {
    render(<Markdown content="> This is a quote" />)
    const blockquote = document.querySelector('blockquote')
    expect(blockquote).toBeInTheDocument()
    expect(blockquote).toHaveTextContent('This is a quote')
  })

  it('renders unordered lists with -', () => {
    render(<Markdown content={'- Item 1\n- Item 2\n- Item 3'} />)
    const list = document.querySelector('ul')
    expect(list).toBeInTheDocument()
    const items = list?.querySelectorAll('li')
    expect(items).toHaveLength(3)
    expect(items?.[0]).toHaveTextContent('Item 1')
    expect(items?.[1]).toHaveTextContent('Item 2')
    expect(items?.[2]).toHaveTextContent('Item 3')
  })

  it('renders unordered lists with *', () => {
    render(<Markdown content={'* Star item 1\n* Star item 2'} />)
    const list = document.querySelector('ul')
    expect(list).toBeInTheDocument()
    const items = list?.querySelectorAll('li')
    expect(items).toHaveLength(2)
  })

  it('renders unordered lists with +', () => {
    render(<Markdown content={'+ Plus item 1\n+ Plus item 2'} />)
    const list = document.querySelector('ul')
    expect(list).toBeInTheDocument()
    const items = list?.querySelectorAll('li')
    expect(items).toHaveLength(2)
  })

  it('renders ordered lists', () => {
    render(<Markdown content={'1. First\n2. Second\n3. Third'} />)
    const list = document.querySelector('ol')
    expect(list).toBeInTheDocument()
    const items = list?.querySelectorAll('li')
    expect(items).toHaveLength(3)
    expect(items?.[0]).toHaveTextContent('First')
    expect(items?.[1]).toHaveTextContent('Second')
    expect(items?.[2]).toHaveTextContent('Third')
  })

  it('renders bold text', () => {
    render(<Markdown content="This is **bold** text" />)
    const strong = document.querySelector('strong')
    expect(strong).toBeInTheDocument()
    expect(strong).toHaveTextContent('bold')
  })

  it('renders inline code', () => {
    render(<Markdown content="Use the `code` function" />)
    const code = document.querySelector('code')
    expect(code).toBeInTheDocument()
    expect(code).toHaveTextContent('code')
  })

  it('renders code blocks with language label', () => {
    render(<Markdown content={'```javascript\nconst x = 1;\n```'} />)
    // Code blocks render with a language label
    const langLabel = screen.getByText('javascript')
    expect(langLabel).toBeInTheDocument()
    // The code content should be rendered
    const code = document.querySelector('pre code')
    expect(code).toHaveTextContent('const x = 1;')
  })

  it('renders code blocks without language', () => {
    render(<Markdown content={'```\nplain code\n```'} />)
    const langLabel = screen.getByText('code')
    expect(langLabel).toBeInTheDocument()
  })

  it('renders tables with headers and rows', () => {
    render(
      <Markdown
        content={'| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |'}
      />
    )
    const table = document.querySelector('table')
    expect(table).toBeInTheDocument()

    // Should have 2 header cells
    const headers = table?.querySelectorAll('th')
    expect(headers).toHaveLength(2)
    expect(headers?.[0]).toHaveTextContent('Name')
    expect(headers?.[1]).toHaveTextContent('Age')

    // Should have 2 rows
    const rows = table?.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows?.[0].querySelectorAll('td')[0]).toHaveTextContent('Alice')
    expect(rows?.[0].querySelectorAll('td')[1]).toHaveTextContent('30')
  })

  it('renders mixed content (headers + paragraphs + lists)', () => {
    render(
      <Markdown
        content={'# Title\n\nSome paragraph text.\n\n- List item 1\n- List item 2'}
      />
    )
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Title')

    const paragraphs = document.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0]).toHaveTextContent('Some paragraph text.')

    const list = document.querySelector('ul')
    expect(list).toBeInTheDocument()
    expect(list?.children).toHaveLength(2)
  })

  it('falls back to JS parser when WASM parseMarkdownBlocks is not available', () => {
    // Ensure WASM is not available (already done in beforeEach)
    render(<Markdown content="# WASM Fallback" />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('WASM Fallback')
  })

  it('uses WASM parseMarkdownBlocks when available', () => {
    const mockBlocks = JSON.stringify([
      { type: 'text', raw: '**WASM rendered**' },
    ])
    const win = window as unknown as { parseMarkdownBlocks: (c: string) => string }
    win.parseMarkdownBlocks = vi.fn(() => mockBlocks)

    render(<Markdown content="# Should be WASM" />)
    expect(win.parseMarkdownBlocks).toHaveBeenCalledWith('# Should be WASM')

    // The WASM path returns a text block with bold content
    const strong = document.querySelector('strong')
    expect(strong).toBeInTheDocument()
    expect(strong).toHaveTextContent('WASM rendered')
  })

  it('falls back to JS parser when WASM throws', () => {
    const win = window as unknown as { parseMarkdownBlocks: (c: string) => string }
    win.parseMarkdownBlocks = vi.fn(() => {
      throw new Error('WASM error')
    })

    // Should not throw, should fall back gracefully
    render(<Markdown content="# Fallback after error" />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Fallback after error')
  })
})
