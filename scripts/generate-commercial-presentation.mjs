import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "docs", "Mavo-Talk-Apresentacao-Comercial.pptx");
const W = 13.333;
const H = 7.5;
const EMU = 914400;

const C = {
  navy: "081B33", ink: "12243A", blue: "2563EB", azure: "3B82F6",
  cyan: "22D3EE", green: "10B981", mint: "DDF8EF", sky: "EAF2FF",
  paper: "F8FAFC", white: "FFFFFF", slate: "64748B", light: "E2E8F0",
  pale: "EEF4FF", amber: "F59E0B", rose: "E11D48", darkSlate: "1E293B",
};

const esc = (v = "") => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const emu = (n) => Math.round(n * EMU);
const attr = (a) => Object.entries(a).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`;
const fill = (color, alpha) => alpha === undefined ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : `<a:solidFill><a:srgbClr val="${color}"><a:alpha val="${alpha}"/></a:srgbClr></a:solidFill>`;
const line = (color = C.light, width = 1) => `<a:ln w="${Math.round(width * 12700)}">${fill(color)}</a:ln>`;

function shape(id, x, y, w, h, opts = {}) {
  const { color = C.white, alpha, radius = false, outline, outlineW = 1 } = opts;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x,y,w,h)}<a:prstGeom prst="${radius ? "roundRect" : "rect"}"><a:avLst/></a:prstGeom>${fill(color,alpha)}${outline ? line(outline, outlineW) : "<a:ln><a:noFill/></a:ln>"}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

function paragraph(text, opts = {}) {
  const { size = 14, color = C.ink, bold = false, font = "Aptos", align = "l", bullet = false, before = 0, after = 0, italic = false } = opts;
  const bulletXml = bullet ? `<a:buChar char="•"/><a:buFont typeface="${font}"/>` : "";
  return `<a:p><a:pPr algn="${align}" marL="${bullet ? 220000 : 0}" indent="${bullet ? -160000 : 0}" spcBef="${before}" spcAft="${after}">${bulletXml}</a:pPr><a:r><a:rPr lang="pt-BR" sz="${Math.round(size*100)}" b="${bold ? 1 : 0}" i="${italic ? 1 : 0}" typeface="${font}">${fill(color)}</a:rPr><a:t>${esc(text)}</a:t></a:r><a:endParaRPr lang="pt-BR" sz="${Math.round(size*100)}" typeface="${font}"/></a:p>`;
}

function text(id, x, y, w, h, content, opts = {}) {
  const { margin = 0, valign = "top", color = C.ink, size = 14, bold = false, align = "l", fit = true } = opts;
  const paras = Array.isArray(content) ? content.map(p => paragraph(p.text, { color, size, bold, align, ...p })).join("") : paragraph(content, { color, size, bold, align });
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x,y,w,h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="${emu(margin)}" rIns="${emu(margin)}" tIns="${emu(margin)}" bIns="${emu(margin)}" anchor="${valign}">${fit ? "<a:normAutofit/>" : ""}</a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
}

function pic(id, relId, x, y, w, h) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Screenshot ${id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(x,y,w,h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></p:spPr></p:pic>`;
}

function ellipse(id, x, y, w, h, color, alpha) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Ellipse ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x,y,w,h)}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>${fill(color,alpha)}<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

function connector(id, x1, y1, x2, y2, color = C.blue) {
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Connector ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="${emu(x1)}" y="${emu(y1)}"/><a:ext cx="${emu(x2-x1)}" cy="${emu(y2-y1)}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="25400">${fill(color)}<a:tailEnd type="none"/><a:headEnd type="none"/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:cxnSp>`;
}

function brand(slide, inverse = false) {
  slide.add(shape(slide.id(), 0.52, 0.40, 0.32, 0.32, { color: inverse ? C.cyan : C.blue, radius: true }));
  slide.add(text(slide.id(), 0.95, 0.39, 1.7, 0.36, "Mavo Talk", { size: 12, bold: true, color: inverse ? C.white : C.ink }));
  slide.add(text(slide.id(), 10.64, 0.43, 2.2, 0.25, "CENTRAL DE CONVERSAS", { size: 7.5, bold: true, color: inverse ? "B9C8E3" : C.slate, align: "r" }));
}

function footer(slide, page, inverse = false) {
  slide.add(shape(slide.id(), 0.52, 7.08, 12.28, 0.015, { color: inverse ? "365071" : C.light }));
  slide.add(text(slide.id(), 0.53, 7.18, 4.2, 0.16, "MAVO TALK  •  APRESENTAÇÃO COMERCIAL", { size: 6.5, bold: true, color: inverse ? "9BB1D2" : "94A3B8" }));
  slide.add(text(slide.id(), 12.16, 7.16, 0.5, 0.18, String(page).padStart(2,"0"), { size: 7.5, bold: true, color: inverse ? C.cyan : C.blue, align: "r" }));
}

function titleBlock(slide, eyebrow, title, subtitle) {
  slide.add(text(slide.id(), 0.72, 1.0, 6.9, 0.25, eyebrow.toUpperCase(), { size: 8, bold: true, color: C.blue }));
  slide.add(text(slide.id(), 0.72, 1.38, 7.2, 1.0, title, { size: 28, bold: true, color: C.navy }));
  if (subtitle) slide.add(text(slide.id(), 0.74, 2.46, 6.5, 0.65, subtitle, { size: 13, color: C.slate }));
}

function addCard(slide, x, y, w, h, label, headline, body, accent = C.blue) {
  slide.add(shape(slide.id(), x, y, w, h, { color: C.white, radius: true, outline: C.light, outlineW: 0.7 }));
  slide.add(shape(slide.id(), x, y, 0.07, h, { color: accent, radius: true }));
  slide.add(text(slide.id(), x+0.32, y+0.26, w-0.55, 0.2, label.toUpperCase(), { size: 7, bold: true, color: accent }));
  slide.add(text(slide.id(), x+0.32, y+0.56, w-0.55, 0.44, headline, { size: 14, bold: true, color: C.ink }));
  slide.add(text(slide.id(), x+0.32, y+1.13, w-0.55, h-1.35, body, { size: 9.5, color: C.slate }));
}

class Slide {
  constructor(index, bg = C.paper) { this.index = index; this.bg = bg; this.items = []; this.images = []; this.nextId = 2; }
  id() { return this.nextId++; }
  add(xml) { this.items.push(xml); }
  image(file, x, y, w, h) { const rel = `rId${this.images.length + 2}`; this.images.push({ file, rel }); this.add(pic(this.id(), rel, x,y,w,h)); }
  xml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr>${fill(this.bg)}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${this.items.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  }
}

const slides = [];
const img = (name) => path.join(ROOT, "docs", "assets", "technical-guide", name);

// 01 · Capa
{
  const s = new Slide(1, C.navy); slides.push(s);
  s.add(ellipse(s.id(), 8.6, -1.8, 6.7, 6.7, C.blue, 21000));
  s.add(ellipse(s.id(), 10.9, 4.95, 3.0, 3.0, C.cyan, 16000));
  brand(s, true);
  s.add(text(s.id(), 0.75, 1.42, 5.9, 0.24, "ATENDIMENTO QUE ACOMPANHA O RITMO DO SEU CLIENTE", { size: 8, bold: true, color: "A9C6FF" }));
  s.add(text(s.id(), 0.73, 1.91, 6.0, 1.45, "Converse melhor.\nResolva mais rápido.", { size: 30, bold: true, color: C.white }));
  s.add(text(s.id(), 0.76, 3.67, 5.1, 0.68, "A central inteligente para organizar o atendimento no WhatsApp, dar visibilidade à operação e oferecer uma experiência mais ágil ao cliente.", { size: 13, color: "C8D5EA" }));
  s.add(shape(s.id(), 0.76, 4.75, 2.34, 0.45, { color: C.blue, radius: true }));
  s.add(text(s.id(), 0.95, 4.87, 1.95, 0.16, "APRESENTAÇÃO COMERCIAL", { size: 7.5, bold: true, color: C.white, align: "c" }));
  s.add(shape(s.id(), 7.12, 1.08, 5.37, 4.62, { color: C.white, radius: true, outline: "5272AB", outlineW: 1 }));
  s.image(img("03-inbox-desktop-demo.png"), 7.27, 1.23, 5.07, 4.32);
  s.add(shape(s.id(), 7.27, 1.23, 5.07, 0.24, { color: C.navy, alpha: 18000 }));
  s.add(text(s.id(), 7.45, 5.98, 4.55, 0.34, "Mavo Talk · Central de conversas", { size: 9, bold: true, color: "B9C8E3" }));
  footer(s, 1, true);
}

// 02 · Contexto
{
  const s = new Slide(2); slides.push(s); brand(s); footer(s, 2); titleBlock(s, "O desafio", "Quando o atendimento perde ritmo,\no cliente percebe.", "Mensagens sem contexto, filas invisíveis e respostas dependentes de memória criam fricção para quem compra e para quem atende.");
  const cards = [
    ["Conversas dispersas", "Visão fragmentada", "Atendimentos em múltiplas telas, sem uma fila única e sem contexto contínuo.", C.rose],
    ["Priorização", "O urgente se mistura ao comum", "Sem organização, demandas críticas competem com dúvidas simples e o tempo de resposta se perde.", C.amber],
    ["Gestão", "Pouca clareza sobre a operação", "É difícil acompanhar volume, desempenho e gargalos enquanto a equipe está atendendo.", C.blue],
  ];
  cards.forEach((c,i) => addCard(s, 0.75 + i*4.14, 3.62, 3.72, 1.78, ...c));
  s.add(shape(s.id(), 0.75, 5.93, 11.85, 0.63, { color: C.pale, radius: true }));
  s.add(text(s.id(), 1.03, 6.13, 11.2, 0.22, "O Mavo Talk transforma cada mensagem em uma conversa organizada, acompanhável e pronta para ser resolvida.", { size: 12, bold: true, color: C.navy, align: "c" }));
}

// 03 · Produto
{
  const s = new Slide(3); slides.push(s); brand(s); footer(s, 3); titleBlock(s, "A solução", "Uma central de conversas feita\npara a operação acontecer.", "O Mavo Talk reúne atendimento, automação e gestão em um único ambiente conectado ao WhatsApp.");
  const features = [
    ["01", "Inbox unificado", "Conversas, histórico, responsável e contexto em uma visão operacional única."],
    ["02", "Filas inteligentes", "Triagem, prioridade e SLA para direcionar cada demanda ao fluxo certo."],
    ["03", "Automação com controle", "Bot, IA e respostas rápidas aceleram o atendimento sem tirar a equipe da decisão."],
    ["04", "Visão de gestão", "Indicadores, auditoria e administração para acompanhar a operação com clareza."],
  ];
  features.forEach((f, i) => { const x = i < 2 ? 0.75 : 6.85; const y = i % 2 === 0 ? 3.40 : 5.03;
    s.add(shape(s.id(), x, y, 5.70, 1.22, { color: C.white, radius: true, outline: C.light, outlineW: .7 }));
    s.add(shape(s.id(), x+.24, y+.24, .48, .48, { color: C.pale, radius: true }));
    s.add(text(s.id(), x+.24, y+.37, .48, .14, f[0], { size: 7, bold: true, color: C.blue, align: "c" }));
    s.add(text(s.id(), x+.94, y+.23, 3.95, .26, f[1], { size: 12, bold: true, color: C.ink }));
    s.add(text(s.id(), x+.94, y+.59, 4.36, .38, f[2], { size: 8.8, color: C.slate }));
  });
}

// 04 · dores
{
  const s = new Slide(4); slides.push(s); brand(s); footer(s, 4); titleBlock(s, "Impacto prático", "Dores reais. Respostas estruturadas.", "O produto foi desenhado para reduzir atrito na jornada do cliente e devolver controle para a equipe.");
  const rows = [
    ["Cliente repete informações", "Histórico de conversas e contexto disponível para o atendimento.", C.blue],
    ["Equipe não sabe o que atender primeiro", "Filas, classificação de demanda e regras de prioridade.", C.amber],
    ["Solicitações chegam sem padrão", "Triagem por menu e entendimento de linguagem natural.", C.green],
    ["Automação parece impessoal ou arriscada", "Transferência para humano e regras que evitam respostas sem confirmação.", C.rose],
  ];
  s.add(text(s.id(), .88, 3.17, 3.55, .2, "CENÁRIO SEM CONTROLE", { size: 7, bold: true, color: C.slate }));
  s.add(text(s.id(), 6.83, 3.17, 4.15, .2, "COM O MAVO TALK", { size: 7, bold: true, color: C.blue }));
  rows.forEach((r,i) => { const y = 3.53 + i*.69;
    s.add(shape(s.id(), .75, y, 5.35, .52, { color: C.white, radius: true, outline: C.light, outlineW:.55 }));
    s.add(text(s.id(), 1.02, y+.16, 4.76, .17, r[0], { size: 9.2, bold: true, color: C.darkSlate }));
    s.add(shape(s.id(), 6.52, y, 5.95, .52, { color: C.white, radius: true, outline: r[2], outlineW:.8 }));
    s.add(shape(s.id(), 6.73, y+.15, .21, .21, { color: r[2], radius:true }));
    s.add(text(s.id(), 7.12, y+.14, 4.95, .2, r[1], { size: 8.8, color: C.ink }));
  });
  s.add(text(s.id(), 6.14, 4.34, .22, .22, "→", { size: 19, bold:true, color:C.blue, align:"c" }));
}

// 05 · fluxo
{
  const s = new Slide(5); slides.push(s); brand(s); footer(s, 5); titleBlock(s, "Como funciona", "Da primeira mensagem à resolução,\num fluxo claro para todos.", "Cada etapa é pensada para não deixar clientes nem demandas importantes sem acompanhamento.");
  const flow = [
    ["1", "Mensagem", "O cliente chama pelo WhatsApp."],
    ["2", "Triagem", "O Mavo entende a intenção ou apresenta opções."],
    ["3", "Fila", "A demanda é classificada e encaminhada."],
    ["4", "Atendimento", "Bot, IA ou pessoa certa atua com contexto."],
    ["5", "Gestão", "SLA, histórico e indicadores acompanham o ciclo."],
  ];
  flow.forEach((f,i) => { const x = .73 + i*2.48; const accent = i === 4 ? C.green : C.blue;
    if(i) connector(s.id(), x-.34, 4.02, x-.06, 4.02, "9DB9EF");
    s.add(ellipse(s.id(), x+.56, 3.15, .88, .88, accent));
    s.add(text(s.id(), x+.56, 3.46, .88, .18, f[0], { size: 11, bold:true, color:C.white, align:"c" }));
    s.add(text(s.id(), x, 4.35, 2.0, .25, f[1], { size: 12, bold:true, color:C.ink, align:"c" }));
    s.add(text(s.id(), x+.05, 4.74, 1.9, .54, f[2], { size: 8.3, color:C.slate, align:"c" }));
  });
  s.add(shape(s.id(), .76, 5.95, 11.78, .58, { color:C.mint, radius:true }));
  s.add(text(s.id(), 1.0, 6.13, 11.3, .18, "Quando a automação não deve responder, a conversa é transferida para a equipe com todo o contexto já coletado.", {size:10.5,bold:true,color:"047857",align:"c"}));
}

// 06 · tela operacional
{
  const s = new Slide(6); slides.push(s); brand(s); footer(s, 6); titleBlock(s, "Experiência operacional", "Tudo o que a equipe precisa,\nsem trocar de tela.", "A inbox centraliza conversas, responsáveis, status e o histórico necessário para uma resposta contextual.");
  s.add(shape(s.id(), 6.25, 1.05, 6.34, 4.40, { color:C.white, radius:true, outline:C.light, outlineW:.8 }));
  s.image(img("03-inbox-desktop-demo.png"), 6.39, 1.19, 6.06, 4.12);
  [["Conversas em fila", "Visualize o que está aguardando e distribua o trabalho."],["Histórico no contexto", "Atenda sem pedir ao cliente para repetir a história."],["Ação no momento certo", "Atribua, responda, transfira e encerre a partir da mesma conversa."]].forEach((f,i)=>{
    const y=3.47+i*.78; s.add(shape(s.id(),.75,y,.17,.17,{color:[C.blue,C.green,C.amber][i],radius:true}));
    s.add(text(s.id(),1.12,y-.02,3.85,.2,f[0],{size:10,bold:true,color:C.ink}));
    s.add(text(s.id(),1.12,y+.28,4.22,.28,f[1],{size:8.5,color:C.slate}));
  });
}

// 07 · automação
{
  const s = new Slide(7); slides.push(s); brand(s); footer(s, 7); titleBlock(s, "Automação que soma", "A tecnologia cuida do repetitivo.\nA equipe cuida do que importa.", "O Mavo combina menu, linguagem natural, regras e IA opcional para oferecer agilidade com responsabilidade.");
  const steps = [
    ["Menu e intenções", "O cliente pode escolher uma opção ou escrever naturalmente o que precisa."],
    ["Coleta de contexto", "O fluxo pede as informações certas antes de encaminhar a demanda."],
    ["Transferência humana", "Casos sensíveis, preço, estoque ou exceções seguem para a pessoa certa."],
  ];
  steps.forEach((f,i)=>{ const x=.78+i*4.15; const ac=[C.blue,C.cyan,C.green][i];
    s.add(shape(s.id(),x,3.65,3.72,1.72,{color:C.white,radius:true,outline:C.light,outlineW:.7}));
    s.add(shape(s.id(),x+.25,3.90,.52,.52,{color:ac,radius:true}));
    s.add(text(s.id(),x+.25,4.06,.52,.18,String(i+1),{size:9,bold:true,color:C.white,align:"c"}));
    s.add(text(s.id(),x+.96,3.96,2.35,.27,f[0],{size:11,bold:true,color:C.ink}));
    s.add(text(s.id(),x+.31,4.68,3.08,.43,f[1],{size:8.8,color:C.slate}));
  });
  s.add(shape(s.id(), .78, 5.88, 11.98, .55, {color:C.pale,radius:true}));
  s.add(text(s.id(),1.0,6.05,11.5,.18,"Regras de segurança evitam a confirmação indevida de informações e mantêm a operação humana no controle.",{size:10,bold:true,color:C.navy,align:"c"}));
}

// 08 · dados
{
  const s = new Slide(8); slides.push(s); brand(s); footer(s, 8); titleBlock(s, "Gestão visível", "Atendimento também é fonte\nde decisão.", "O painel transforma a rotina de conversas em uma leitura clara da operação, dos seus indicadores e da evolução do time.");
  s.add(shape(s.id(), .75, 3.45, 5.84, 2.35, {color:C.white,radius:true,outline:C.light,outlineW:.7}));
  s.image(img("04-atendimento-metricas-demo.png"), .88, 3.58, 5.58, 1.98);
  s.add(shape(s.id(), 6.75, 3.45, 5.84, 2.35, {color:C.white,radius:true,outline:C.light,outlineW:.7}));
  s.image(img("05-indicadores-negocio-demo.png"), 6.88, 3.58, 5.58, 1.98);
  s.add(text(s.id(),.9,6.08,5.54,.2,"Acompanhe atendimento, filas e eficiência.",{size:9.5,bold:true,color:C.ink,align:"c"}));
  s.add(text(s.id(),6.9,6.08,5.54,.2,"Leve dados do negócio para a conversa certa.",{size:9.5,bold:true,color:C.ink,align:"c"}));
}

// 09 · confiança
{
  const s = new Slide(9); slides.push(s); brand(s); footer(s, 9); titleBlock(s, "Feito para operar com confiança", "Segurança, controle e escala\npara a sua operação.", "Por trás de uma experiência simples, há uma arquitetura preparada para empresas, equipes e integrações.");
  const trust = [
    ["Multiempresa", "Dados e operações separados por organização."],
    ["Acesso por perfil", "Permissões para gestores, administradores e atendentes."],
    ["Auditoria e rastreabilidade", "Ações e consultas relevantes ficam acompanháveis."],
    ["Integrações", "Conecte WhatsApp, n8n, IA e sistemas já usados pela empresa."],
  ];
  trust.forEach((f,i)=>{ const x = i%2 ? 6.78 : .78; const y = i>1 ? 4.94 : 3.45;
    s.add(shape(s.id(),x,y,5.62,1.12,{color:C.white,radius:true,outline:C.light,outlineW:.7}));
    s.add(shape(s.id(),x+.24,y+.24,.42,.42,{color:i===3?C.green:C.pale,radius:true}));
    s.add(text(s.id(),x+.24,y+.36,.42,.14,"✓",{size:8,bold:true,color:i===3?C.white:C.blue,align:"c"}));
    s.add(text(s.id(),x+.87,y+.23,4.1,.22,f[0],{size:10.5,bold:true,color:C.ink}));
    s.add(text(s.id(),x+.87,y+.58,4.3,.25,f[1],{size:8.5,color:C.slate}));
  });
}

// 10 · implantação
{
  const s = new Slide(10); slides.push(s); brand(s); footer(s, 10); titleBlock(s, "Caminho de implantação", "Comece com o essencial.\nEvolua com sua operação.", "A implantação pode seguir uma jornada simples, orientada pelas prioridades do seu negócio.");
  const pathSteps = [
    ["Mapear", "Canais, tipos de atendimento, filas e responsáveis."],
    ["Configurar", "WhatsApp, equipe, horários, regras e respostas."],
    ["Validar", "Teste os fluxos com segurança antes da ativação."],
    ["Evoluir", "Acompanhe indicadores e amplie automações com maturidade."],
  ];
  s.add(connector(s.id(), 1.52,4.09,11.76,4.09,"B8C9EB"));
  pathSteps.forEach((f,i)=>{ const x=.75+i*3.05; const ac=[C.blue,C.cyan,C.green,C.amber][i];
    s.add(ellipse(s.id(),x+.91,3.54,1.10,1.10,ac));
    s.add(text(s.id(),x+.91,3.92,1.10,.18,String(i+1),{size:11,bold:true,color:C.white,align:"c"}));
    s.add(text(s.id(),x+.15,4.93,2.62,.23,f[0],{size:11,bold:true,color:C.ink,align:"c"}));
    s.add(text(s.id(),x+.08,5.31,2.76,.50,f[1],{size:8.5,color:C.slate,align:"c"}));
  });
  s.add(shape(s.id(),.78,6.16,11.95,.35,{color:C.mint,radius:true}));
  s.add(text(s.id(),1.0,6.26,11.5,.14,"A configuração é adaptada ao fluxo real da empresa — não o contrário.",{size:8.8,bold:true,color:"047857",align:"c"}));
}

// 11 · encerramento
{
  const s = new Slide(11, C.navy); slides.push(s); brand(s, true); footer(s, 11, true);
  s.add(ellipse(s.id(), -1.5, 4.6, 5.8, 5.8, C.blue, 24000)); s.add(ellipse(s.id(), 9.5, -2.2, 5.1, 5.1, C.cyan, 15000));
  s.add(text(s.id(), .78, 1.37, 4.4, .21, "PRONTO PARA O PRÓXIMO ATENDIMENTO", {size:8,bold:true,color:"A9C6FF"}));
  s.add(text(s.id(), .75, 1.84, 7.1, 1.32, "Uma conversa melhor\ncomeça com uma operação melhor.",{size:29,bold:true,color:C.white}));
  s.add(text(s.id(),.78,3.62,5.85,.55,"Mavo Talk centraliza a rotina do WhatsApp para que sua equipe tenha contexto, velocidade e controle em cada interação.",{size:13,color:"C8D5EA"}));
  s.add(shape(s.id(),.78,4.78,2.72,.48,{color:C.blue,radius:true}));
  s.add(text(s.id(),1.02,4.93,2.25,.14,"MAVO TALK · DEMONSTRAÇÃO",{size:7.5,bold:true,color:C.white,align:"c"}));
  s.add(shape(s.id(),7.66,1.48,4.42,3.80,{color:C.white,radius:true,outline:"5272AB",outlineW:1}));
  s.image(img("06-whatsapp-administracao-demo.png"),7.80,1.62,4.14,3.52);
  s.add(text(s.id(),7.83,5.63,4.0,.18,"Atendimento, gestão e automação em uma única plataforma.",{size:8.7,bold:true,color:"B9C8E3",align:"c"}));
}

function contentTypes(slideCount, images) {
  const slideOverrides = Array.from({length:slideCount},(_,i)=>`<Override PartName="/ppt/slides/slide${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  const imageDefaults = images.has("png") ? `<Default Extension="png" ContentType="image/png"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${slideOverrides}</Types>`;
}

const rels = (items) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(x=>`<Relationship${attr(x)}/>`).join("")}</Relationships>`;
const rootRels = rels([{Id:"rId1",Type:"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",Target:"ppt/presentation.xml"},{Id:"rId2",Type:"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",Target:"docProps/core.xml"},{Id:"rId3",Type:"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",Target:"docProps/app.xml"}]);
const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Mavo Talk"><a:themeElements><a:clrScheme name="Mavo"><a:dk1><a:srgbClr val="081B33"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="12243A"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="22D3EE"/></a:accent2><a:accent3><a:srgbClr val="10B981"/></a:accent3><a:accent4><a:srgbClr val="F59E0B"/></a:accent4><a:accent5><a:srgbClr val="E11D48"/></a:accent5><a:accent6><a:srgbClr val="64748B"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="Mavo Fonts"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="Mavo"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
const layout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const master = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Mavo Master"><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;

async function build() {
  const zip = new JSZip();
  const media = new Map();
  for (const s of slides) for (const im of s.images) if (!media.has(im.file)) media.set(im.file, media.size + 1);
  zip.file("[Content_Types].xml", contentTypes(slides.length, new Set(["png"])));
  zip.file("_rels/.rels", rootRels);
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Mavo Talk — Apresentação Comercial</dc:title><dc:creator>Mavo Talk</dc:creator><cp:lastModifiedBy>Mavo Talk</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-07-29T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-07-29T00:00:00Z</dcterms:modified></cp:coreProperties>`);
  zip.file("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Mavo Talk</Application><Slides>${slides.length}</Slides><PresentationFormat>Widescreen</PresentationFormat><Company>Mavo Talk</Company></Properties>`);
  zip.file("ppt/theme/theme1.xml", theme);
  zip.file("ppt/slideLayouts/slideLayout1.xml", layout);
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([{Id:"rId1",Type:"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",Target:"../slideMasters/slideMaster1.xml"}]));
  zip.file("ppt/slideMasters/slideMaster1.xml", master);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([{Id:"rId1",Type:"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",Target:"../slideLayouts/slideLayout1.xml"},{Id:"rId2",Type:"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",Target:"../theme/theme1.xml"}]));
  const sldIds = slides.map((_,i)=>`<p:sldId id="${256+i}" r:id="rId${i+2}"/>`).join("");
  zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="wide"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", rels([{Id:"rId1",Type:"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",Target:"slideMasters/slideMaster1.xml"}, ...slides.map((_,i)=>({Id:`rId${i+2}`,Type:"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",Target:`slides/slide${i+1}.xml`}))]));
  for (const [file, n] of media) zip.file(`ppt/media/image${n}.png`, fs.readFileSync(file));
  for (const s of slides) {
    zip.file(`ppt/slides/slide${s.index}.xml`, s.xml());
    const relationships = [{Id:"rId1",Type:"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",Target:"../slideLayouts/slideLayout1.xml"}, ...s.images.map(im=>({Id:im.rel,Type:"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",Target:`../media/image${media.get(im.file)}.png`}))];
    zip.file(`ppt/slides/_rels/slide${s.index}.xml.rels`, rels(relationships));
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, await zip.generateAsync({ type:"nodebuffer", compression:"DEFLATE", compressionOptions:{level:9} }));
  console.log(`Apresentação criada: ${OUT}`);
}
build().catch((error) => { console.error(error); process.exitCode = 1; });
