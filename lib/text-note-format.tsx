import { Fragment, type ReactNode } from "react";

// A tiny, safe markdown-lite renderer for coach text notes: **bold**,
// *italic*, [text](url). Renders straight to React elements — never
// dangerouslySetInnerHTML — so there's no HTML-injection surface no matter
// what a coach types.
const TOKEN_RE = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function renderNoteBody(body: string): ReactNode {
  const lines = body.split("\n");
  return lines.map((line, lineIndex) => (
    <Fragment key={lineIndex}>
      {lineIndex > 0 && <br />}
      {renderLine(line)}
    </Fragment>
  ));
}

function renderLine(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  TOKEN_RE.lastIndex = 0;

  while ((match = TOKEN_RE.exec(line))) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index));
    }
    const [, bold, italic, linkText, linkUrl] = match;
    if (bold !== undefined) {
      nodes.push(<strong key={key++}>{bold}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={key++}>{italic}</em>);
    } else if (linkText !== undefined && linkUrl !== undefined) {
      nodes.push(
        <a
          key={key++}
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-rust"
        >
          {linkText}
        </a>
      );
    }
    lastIndex = TOKEN_RE.lastIndex;
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex));
  }

  return nodes;
}

// Toolbar helper: wraps or inserts markdown-lite syntax at the given
// selection range within a textarea's value, returning the new value and
// where the cursor should land.
export function insertNoteSyntax(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  kind: "bold" | "italic" | "link"
): { value: string; selectionStart: number; selectionEnd: number } {
  const before = value.slice(0, selectionStart);
  const selected = value.slice(selectionStart, selectionEnd);
  const after = value.slice(selectionEnd);

  if (kind === "link") {
    const text = selected || "link text";
    const insert = `[${text}](https://)`;
    const urlStart = before.length + insert.indexOf("https://");
    return {
      value: before + insert + after,
      selectionStart: urlStart,
      selectionEnd: urlStart + "https://".length,
    };
  }

  const marker = kind === "bold" ? "**" : "*";
  const text = selected || (kind === "bold" ? "bold text" : "italic text");
  const insert = `${marker}${text}${marker}`;
  return {
    value: before + insert + after,
    selectionStart: before.length + marker.length,
    selectionEnd: before.length + marker.length + text.length,
  };
}
