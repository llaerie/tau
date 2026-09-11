import type { ReactNode } from "react";

/**
 * Markdown-lite renderer for brief / CPA package text: headings, paragraphs,
 * bullet lists, pipe tables, horizontal rules, inline bold/code. No HTML passthrough.
 */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else out.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const content = inline(h[2]);
      nodes.push(level === 1 ? <h1 key={key++}>{content}</h1> : level === 2 ? <h2 key={key++}>{content}</h2> : <h3 key={key++}>{content}</h3>);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      nodes.push(<hr key={key++} />);
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = splitRow(lines[i]);
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      nodes.push(
        <div key={key++} className="scroll-x">
          <table>
            {head ? (
              <thead>
                <tr>
                  {head.map((c, j) => (
                    <th key={j}>{inline(c)}</th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {body.map((r, j) => (
                <tr key={j}>
                  {r.map((c, k2) => (
                    <td key={k2} className={/^[-+$€£¥(]?[\d,.]+%?\)?$/.test(c) ? "num text-right" : ""}>
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>);
        i++;
      }
      nodes.push(<ul key={key++}>{items}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3})\s/.test(lines[i]) && !lines[i].trim().startsWith("|") && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !/^(-{3,}|\*{3,})$/.test(lines[i].trim())) {
      para.push(lines[i]);
      i++;
    }
    nodes.push(<p key={key++}>{inline(para.join(" "))}</p>);
  }
  return <div className={`md ${className}`}>{nodes}</div>;
}
