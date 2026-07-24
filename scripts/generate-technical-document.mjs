import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";

const sourcePath = path.resolve(
  process.argv[2] || "docs/WillTalk-Documentacao-Tecnica-Producao.md",
);
const outputPath = path.resolve(
  process.argv[3] || "docs/WillTalk-Documentacao-Tecnica-Producao.html",
);

marked.use({
  gfm: true,
  breaks: false,
});

const markdown = await readFile(sourcePath, "utf8");
const body = await marked.parse(markdown);

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WillTalk — Documentação técnica de produção</title>
  <style>
    @page { size: A4; margin: 15mm 13mm 17mm; }
    :root {
      color-scheme: light;
      --ink: #172033;
      --muted: #526076;
      --line: #d9e0ea;
      --brand: #2563eb;
      --soft: #f3f6fb;
      --code: #101827;
    }
    * { box-sizing: border-box; }
    html { font-size: 10.5pt; }
    body {
      margin: 0 auto;
      max-width: 1120px;
      color: var(--ink);
      background: white;
      font-family: "Segoe UI", Arial, sans-serif;
      line-height: 1.48;
    }
    h1, h2, h3, h4 { color: #0f172a; line-height: 1.18; page-break-after: avoid; }
    h1 {
      margin: 0 0 12px;
      padding: 24mm 0 10mm;
      color: var(--brand);
      font-size: 28pt;
      border-bottom: 3px solid var(--brand);
    }
    h2 {
      margin: 26px 0 12px;
      padding-bottom: 5px;
      font-size: 18pt;
      border-bottom: 1px solid var(--line);
    }
    h3 { margin: 20px 0 9px; font-size: 13.5pt; }
    p { margin: 7px 0 11px; }
    a { color: #1d4ed8; text-decoration: none; }
    blockquote {
      margin: 14px 0;
      padding: 10px 14px;
      color: #334155;
      background: #eff6ff;
      border-left: 4px solid #3b82f6;
    }
    table {
      width: 100%;
      margin: 10px 0 18px;
      border-collapse: collapse;
      font-size: 8.6pt;
      page-break-inside: auto;
    }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    th, td {
      padding: 6px 7px;
      border: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th { color: #0f172a; background: #eaf0f9; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    code {
      padding: 1px 4px;
      color: #be123c;
      background: #f1f5f9;
      border-radius: 3px;
      font-family: Consolas, "Courier New", monospace;
      font-size: 0.9em;
    }
    pre {
      margin: 11px 0 17px;
      padding: 13px;
      color: #e2e8f0;
      background: var(--code);
      border-radius: 7px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      page-break-inside: avoid;
    }
    pre code { padding: 0; color: inherit; background: transparent; }
    img {
      display: block;
      width: auto;
      max-width: 100%;
      max-height: 172mm;
      margin: 14px auto 6px;
      object-fit: contain;
      border: 1px solid var(--line);
      border-radius: 7px;
      page-break-inside: avoid;
    }
    ul, ol { margin: 7px 0 13px; padding-left: 23px; }
    li { margin: 3px 0; }
    input[type="checkbox"] { margin-right: 6px; }
    hr { border: 0; border-top: 1px solid var(--line); }
    @media print {
      body { max-width: none; }
      h2 { break-before: auto; }
      a { color: #1d4ed8; }
    }
  </style>
</head>
<body>
${body}
</body>
</html>
`;

await writeFile(outputPath, html, "utf8");
console.log(JSON.stringify({ status: "ok", sourcePath, outputPath }));
