// Renders a guide manuscript into a designed PDF with @react-pdf/renderer.
// Pure JS (no headless browser), so it runs fine on small/free hosts.
import React from 'react';
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const h = React.createElement;

// A small deterministic palette picked from the title so each guide looks distinct.
// Refined, editorial solids (no AI-gradient look).
const PALETTES = [
  ['#116b52', '#0b4a39'], // forest
  ['#334155', '#1e293b'], // slate
  ['#b4532a', '#8a3d1e'], // terracotta
  ['#1e3a5f', '#132840'], // navy
  ['#6b2d5c', '#4a1f40'], // plum
  ['#0f6b6b', '#094a4a'], // teal
];
function palette(seed) {
  let n = 0;
  for (const ch of seed) n = (n + ch.charCodeAt(0)) % 997;
  return PALETTES[n % PALETTES.length];
}

function styles(accent) {
  return StyleSheet.create({
    cover: { flexGrow: 1, backgroundColor: accent[0], color: '#ffffff', padding: 56, justifyContent: 'space-between' },
    coverBadge: { fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.85 },
    coverTitle: { fontSize: 38, fontFamily: 'Helvetica-Bold', lineHeight: 1.15 },
    coverSub: { fontSize: 15, marginTop: 16, opacity: 0.92, lineHeight: 1.4 },
    coverRule: { height: 4, width: 70, backgroundColor: '#ffffff', marginBottom: 18, borderRadius: 2 },
    coverFoot: { fontSize: 10, opacity: 0.8 },

    page: { paddingVertical: 54, paddingHorizontal: 56, fontSize: 11, color: '#1c1f2a', lineHeight: 1.5, fontFamily: 'Helvetica' },
    tocTitle: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: accent[0], marginBottom: 16 },
    tocRow: { flexDirection: 'row', marginBottom: 8 },
    tocNum: { width: 22, color: accent[0], fontFamily: 'Helvetica-Bold' },
    tocText: { flex: 1 },

    chapterNum: { fontSize: 11, color: accent[0], fontFamily: 'Helvetica-Bold', letterSpacing: 1, marginBottom: 4 },
    chapterHeading: { fontSize: 19, fontFamily: 'Helvetica-Bold', color: '#1c1f2a', marginBottom: 12 },
    para: { marginBottom: 9, textAlign: 'justify' },
    tipsBox: { backgroundColor: '#f4f2ff', borderLeftWidth: 3, borderLeftColor: accent[0], padding: 12, marginTop: 6, borderRadius: 4 },
    tipsTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: accent[0], textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
    tip: { flexDirection: 'row', marginBottom: 4 },
    tipDot: { color: accent[0], marginRight: 6, fontFamily: 'Helvetica-Bold' },

    sectionTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: accent[0], marginBottom: 10 },
    footer: { position: 'absolute', bottom: 24, left: 56, right: 56, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: '#9a9fb5' },
  });
}

function paras(list, s) {
  return (list || []).map((p, i) => h(Text, { key: i, style: s.para }, p));
}

function Footer(title, s) {
  return h(
    View,
    { style: s.footer, fixed: true },
    h(Text, null, title),
    h(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` }),
  );
}

export async function renderGuidePdf(guide) {
  const accent = palette(guide.title || 'guide');
  const s = styles(accent);

  // Cover
  const cover = h(
    Page,
    { size: 'A4' },
    h(
      View,
      { style: s.cover },
      h(Text, { style: s.coverBadge }, 'PDF Guide'),
      h(
        View,
        null,
        h(View, { style: s.coverRule }),
        h(Text, { style: s.coverTitle }, guide.title),
        h(Text, { style: s.coverSub }, guide.subtitle),
      ),
      h(Text, { style: s.coverFoot }, 'Created with PDF Idea Finder'),
    ),
  );

  // Contents + intro
  const toc = h(
    Page,
    { size: 'A4', style: s.page },
    h(Text, { style: s.tocTitle }, 'Contents'),
    ...guide.chapters.map((c, i) =>
      h(View, { key: i, style: s.tocRow }, h(Text, { style: s.tocNum }, `${i + 1}`), h(Text, { style: s.tocText }, c.heading)),
    ),
    guide.intro?.length ? h(View, { style: { marginTop: 24 } }, h(Text, { style: s.sectionTitle }, 'Introduction'), ...paras(guide.intro, s)) : null,
    Footer(guide.title, s),
  );

  // Chapters
  const chapterPages = guide.chapters.map((c, i) =>
    h(
      Page,
      { key: i, size: 'A4', style: s.page },
      h(Text, { style: s.chapterNum }, `CHAPTER ${i + 1}`),
      h(Text, { style: s.chapterHeading }, c.heading),
      ...paras(c.paragraphs, s),
      c.tips?.length
        ? h(
            View,
            { style: s.tipsBox },
            h(Text, { style: s.tipsTitle }, 'Key tips'),
            ...c.tips.map((t, j) => h(View, { key: j, style: s.tip }, h(Text, { style: s.tipDot }, '•'), h(Text, { style: { flex: 1 } }, t))),
          )
        : null,
      Footer(guide.title, s),
    ),
  );

  // Conclusion
  const end = h(
    Page,
    { size: 'A4', style: s.page },
    h(Text, { style: s.sectionTitle }, 'Conclusion'),
    ...paras(guide.conclusion, s),
    guide.cta ? h(View, { style: s.tipsBox }, h(Text, { style: { fontFamily: 'Helvetica-Bold', color: accent[0] } }, guide.cta)) : null,
    Footer(guide.title, s),
  );

  const doc = h(Document, { title: guide.title, author: 'PDF Idea Finder' }, cover, toc, ...chapterPages, end);
  return renderToBuffer(doc);
}
