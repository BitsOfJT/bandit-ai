import React, { useMemo } from 'react';
import { Copy, Check } from 'lucide-react';

interface MarkdownProps {
  content: string;
}

export const Markdown: React.FC<MarkdownProps> = ({ content }) => {
  const parts = useMemo(() => {
    if (!content) return [];

    // Attempt to use Go WebAssembly Markdown block parser for maximum performance
    const win = window as unknown as { parseMarkdownBlocks?: (content: string) => string };
    if (typeof win.parseMarkdownBlocks === 'function') {
      try {
        const jsonStr = win.parseMarkdownBlocks(content);
        return JSON.parse(jsonStr) as { type: 'code' | 'table' | 'text'; raw: string; lang?: string }[];
      } catch (err) {
        console.error('Go WASM Markdown parsing failed, falling back to JS:', err);
      }
    }

    const blocks: { type: 'code' | 'table' | 'text'; raw: string; lang?: string }[] = [];
    const lines = content.split('\n');
    let currentBlock: string[] = [];
    let inCodeBlock = false;
    let codeLanguage = '';
    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Handle code block toggle
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          blocks.push({
            type: 'code',
            raw: currentBlock.join('\n'),
            lang: codeLanguage,
          });
          currentBlock = [];
          inCodeBlock = false;
        } else {
          // Flush existing text or table block
          if (currentBlock.length > 0) {
            blocks.push({
              type: inTable ? 'table' : 'text',
              raw: currentBlock.join('\n'),
            });
            currentBlock = [];
          }
          inCodeBlock = true;
          inTable = false;
          codeLanguage = line.trim().substring(3).trim();
        }
        continue;
      }

      if (inCodeBlock) {
        currentBlock.push(line);
        continue;
      }

      // Handle Table
      const isTableLine = line.trim().startsWith('|') && line.trim().endsWith('|');
      if (isTableLine) {
        if (!inTable) {
          // Flush text block
          if (currentBlock.length > 0) {
            blocks.push({
              type: 'text',
              raw: currentBlock.join('\n'),
            });
            currentBlock = [];
          }
          inTable = true;
        }
        currentBlock.push(line);
        continue;
      } else {
        if (inTable) {
          // Flush table block
          blocks.push({
            type: 'table',
            raw: currentBlock.join('\n'),
          });
          currentBlock = [];
          inTable = false;
        }
      }

      currentBlock.push(line);
    }

    // Flush any remaining blocks
    if (currentBlock.length > 0) {
      blocks.push({
        type: inCodeBlock ? 'code' : inTable ? 'table' : 'text',
        raw: currentBlock.join('\n'),
        lang: inCodeBlock ? codeLanguage : undefined,
      });
    }

    return blocks;
  }, [content]);

  return (
    <div className="markdown-content">
      {parts.map((part, blockIdx) => {
        if (part.type === 'code') {
          return <CodeBlock key={blockIdx} code={part.raw} language={part.lang} />;
        }

        if (part.type === 'table') {
          return <TableBlock key={blockIdx} tableRaw={part.raw} />;
        }

        // Render standard text blocks (paragraphs, lists, blockquotes, headers)
        return <TextBlock key={blockIdx} raw={part.raw} />;
      })}
    </div>
  );
};

// Code Block with Copy functionality
const CodeBlock: React.FC<{ code: string; language?: string }> = ({ code, language }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-2 overflow-hidden rounded-lg border border-white/10 bg-black/40">
      <div className="flex items-center justify-between bg-black/60 px-4 py-1.5 text-xs text-slate-400 font-mono">
        <span>{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 hover:text-white transition-colors duration-150"
          title="Copy to clipboard"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 m-0 overflow-x-auto text-sm leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
};

// Table Block renderer
const TableBlock: React.FC<{ tableRaw: string }> = ({ tableRaw }) => {
  const lines = tableRaw.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length === 0) return null;

  // Helper to parse cells
  const parseRow = (line: string) => {
    // Strip leading/trailing pipes and split by pipes
    const rawCells = line.replace(/^\||\|$/g, '').split('|');
    return rawCells.map((c) => c.trim());
  };

  const headerCells = parseRow(lines[0]);
  const rows: string[][] = [];

  // Start checking other lines. Skip line 1 if it is a separator (like |---|---|)
  const isSeparator = (line: string) => {
    const cells = parseRow(line);
    return cells.every((cell) => /^[:\s-]*$/.test(cell));
  };

  const startIdx = isSeparator(lines[1] || '') ? 2 : 1;

  for (let i = startIdx; i < lines.length; i++) {
    rows.push(parseRow(lines[i]));
  }

  return (
    <div className="overflow-x-auto my-2 rounded-lg border border-white/10">
      <table>
        <thead>
          <tr>
            {headerCells.map((cell, idx) => (
              <th key={idx}><InlineText text={cell} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {row.map((cell, cellIdx) => (
                <td key={cellIdx}><InlineText text={cell} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Text Block supporting formatting, blockquotes, lists, headers
const TextBlock: React.FC<{ raw: string }> = ({ raw }) => {
  const lines = raw.split('\n');
  const renderedElements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushList = (key: string | number) => {
    if (listItems.length > 0) {
      if (listType === 'ul') {
        renderedElements.push(<ul key={`ul-${key}`} className="list-disc pl-5 my-2 space-y-1">{...listItems}</ul>);
      } else {
        renderedElements.push(<ol key={`ol-${key}`} className="list-decimal pl-5 my-2 space-y-1">{...listItems}</ol>);
      }
      listItems = [];
      listType = null;
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();

    // Headers
    if (trimmed.startsWith('# ')) {
      flushList(idx);
      renderedElements.push(<h1 key={idx}><InlineText text={trimmed.substring(2)} /></h1>);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushList(idx);
      renderedElements.push(<h2 key={idx}><InlineText text={trimmed.substring(3)} /></h2>);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushList(idx);
      renderedElements.push(<h3 key={idx}><InlineText text={trimmed.substring(4)} /></h3>);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      flushList(idx);
      const quoteText = line.startsWith('> ') ? line.substring(2) : line.substring(1);
      renderedElements.push(
        <blockquote key={idx}>
          <InlineText text={quoteText} />
        </blockquote>
      );
      continue;
    }

    // Unordered List Items
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (ulMatch) {
      if (listType !== 'ul') {
        flushList(idx);
        listType = 'ul';
      }
      listItems.push(
        <li key={`li-${idx}`}>
          <InlineText text={ulMatch[3]} />
        </li>
      );
      continue;
    }

    // Ordered List Items
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (olMatch) {
      if (listType !== 'ol') {
        flushList(idx);
        listType = 'ol';
      }
      listItems.push(
        <li key={`li-${idx}`}>
          <InlineText text={olMatch[3]} />
        </li>
      );
      continue;
    }

    // Standard paragraph or empty line
    if (trimmed === '') {
      flushList(idx);
      continue;
    }

    // Standard text line - accumulate or render paragraph
    flushList(idx);
    renderedElements.push(
      <p key={idx}>
        <InlineText text={line} />
      </p>
    );
  }

  // Final flush
  flushList('final');

  return <>{renderedElements}</>;
};

// Inline parsing helper (bold, inline code, links)
const InlineText: React.FC<{ text: string }> = ({ text }) => {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  // Loop through markdown formatting tokens
  while (remaining.length > 0) {
    const boldIndex = remaining.indexOf('**');
    const codeIndex = remaining.indexOf('`');

    // Find the nearest token
    let firstTokenIdx = -1;
    let tokenType: 'bold' | 'code' | null = null;

    if (boldIndex !== -1 && (codeIndex === -1 || boldIndex < codeIndex)) {
      firstTokenIdx = boldIndex;
      tokenType = 'bold';
    } else if (codeIndex !== -1) {
      firstTokenIdx = codeIndex;
      tokenType = 'code';
    }

    if (firstTokenIdx === -1) {
      // No more tokens
      parts.push(<span key={keyIdx}>{remaining}</span>);
      break;
    }

    // Push preceding text
    if (firstTokenIdx > 0) {
      parts.push(<span key={keyIdx++}>{remaining.substring(0, firstTokenIdx)}</span>);
    }

    remaining = remaining.substring(firstTokenIdx);

    if (tokenType === 'bold') {
      const endBoldIndex = remaining.indexOf('**', 2);
      if (endBoldIndex !== -1) {
        const boldText = remaining.substring(2, endBoldIndex);
        parts.push(<strong key={keyIdx++} className="font-bold text-white"><InlineText text={boldText} /></strong>);
        remaining = remaining.substring(endBoldIndex + 2);
      } else {
        parts.push(<span key={keyIdx++}>**</span>);
        remaining = remaining.substring(2);
      }
    } else if (tokenType === 'code') {
      const endCodeIndex = remaining.indexOf('`', 1);
      if (endCodeIndex !== -1) {
        const codeText = remaining.substring(1, endCodeIndex);
        parts.push(<code key={keyIdx++}>{codeText}</code>);
        remaining = remaining.substring(endCodeIndex + 1);
      } else {
        parts.push(<span key={keyIdx++}>`</span>);
        remaining = remaining.substring(1);
      }
    }
  }

  return <>{parts}</>;
};
