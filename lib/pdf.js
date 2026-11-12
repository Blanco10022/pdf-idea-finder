// Renders a guide manuscript into a commercial-grade PDF with @react-pdf/renderer.
// Pure JS (no headless browser), so it runs on small/free hosts.
import React from 'react';
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const h = React.createElement;

// Refined editorial solids (no AI-gradient look); one picked per guide.
const PALETTES = ['#116b52', '#334155', '#b4532a', '#1e3a5f', '#6b2d5c', '#0f6b6b'];
function accentFor(seed) {
  let n = 0;
  for (const ch of String(seed)) n = (n + ch.charCodeAt(0)) % 997;
  return PALETTES[n % PALETTES.length];
}

const INK = '#1b1d22';
const MUTED = '#6b6f76';
const LINE = '#e6e4df';
const WARN = '#9a5b00';
const WARN_BG = '#fbf3e2';

function styles(accent) {
  return StyleSheet.create({
    cover: { flexGrow: 1, backgroundColor: accent, color: '#fff', padding: 58, justifyContent: 'space-between' },
    coverBadge: { fontSize: 10, letterSpacing: 2.5, textTransform: 'uppercase', opacity: 0.85 },
    coverRule: { height: 4, width: 64, backgroundColor: '#fff', marginBottom: 20, borderRadius: 2 },
    coverTitle: { fontSize: 40, fontFamily: 'Helvetica-Bold', lineHeight: 1.12 },
    coverPromise: { fontSize: 15, marginTop: 18, opacity: 0.92, lineHeight: 1.45, maxWidth: 420 },
    coverFoot: { fontSize: 10, opacity: 0.8 },

    page: { paddingVertical: 56, paddingHorizontal: 58, fontSize: 10.5, color: INK, lineHeight: 1.55, fontFamily: 'Helvetica' },
    kicker: { fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: accent, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
    h2: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginBottom: 12, color: INK },
    lead: { fontSize: 12.5, lineHeight: 1.5, color: INK, marginBottom: 14 },
    para: { marginBottom: 9, textAlign: 'justify' },
    label: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, marginTop: 4 },

    // Framework steps (overview) & chapter steps
    fwItem: { flexDirection: 'row', marginBottom: 10, alignItems: 'flex-start' },
    numDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: accent, color: '#fff', fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'center', paddingTop: 4, marginRight: 10 },
    numText: { flex: 1, paddingTop: 2 },

    toc: { flexDirection: 'row', marginBottom: 9 },
    tocNum: { width: 24, color: accent, fontFamily: 'Helvetica-Bold' },
    tocText: { flex: 1 },

    chNum: { fontSize: 10, color: accent, fontFamily: 'Helvetica-Bold', letterSpacing: 1.5 },
    chHeading: { fontSize: 22, fontFamily: 'Helvetica-Bold', marginTop: 2, marginBottom: 6, color: INK },
    chRule: { height: 3, width: 48, backgroundColor: accent, marginBottom: 16, borderRadius: 2 },

    // Callouts
    example: { backgroundColor: '#f4f6f5', borderLeftWidth: 3, borderLeftColor: accent, padding: 12, borderRadius: 4, marginTop: 8, marginBottom: 6 },
    mistake: { backgroundColor: WARN_BG, borderLeftWidth: 3, borderLeftColor: WARN, padding: 12, borderRadius: 4, marginTop: 8, marginBottom: 6 },
    action: { backgroundColor: accent, color: '#fff', padding: 13, borderRadius: 5, marginTop: 10, marginBottom: 6 },
    calloutLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 5 },

    // Worksheet
    check: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
    checkBox: { width: 12, height: 12, borderWidth: 1.5, borderColor: accent, borderRadius: 2, marginRight: 9, marginTop: 2 },
    blankLine: { borderBottomWidth: 1, borderBottomColor: LINE, height: 16, marginBottom: 8 },

    // FAQ
    faqQ: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', color: INK, marginTop: 12, marginBottom: 3 },
    bullet: { flexDirection: 'row', marginBottom: 6 },
    dot: { color: accent, marginRight: 8, fontFamily: 'Helvetica-Bold' },

    footer: { position: 'absolute', bottom: 26, left: 58, right: 58, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: '#a2a6ad' },
  });
}

const paras = (list, s) => (list || []).map((p, i) => h(Text, { key: i, style: s.para }, p));

function steps(list, s) {
  return (list || []).map((t, i) =>
    h(View, { key: i, style: s.fwItem, wrap: false }, h(Text, { style: s.numDot }, String(i + 1)), h(Text, { style: s.numText }, t)),
  );
}

function callout(kind, label, text, s) {
  if (!text) return null;
  const box = s[kind];
  const labelColor = kind === 'mistake' ? WARN : kind === 'action' ? '#fff' : s.kicker.color;
  const textColor = kind === 'action' ? '#fff' : INK;
  return h(
    View,
    { style: box, wrap: false },
    h(Text, { style: [s.calloutLabel, { color: labelColor }] }, label),
    h(Text, { style: { color: textColor } }, text),
  );
}

function footer(title, s) {
  return h(
    View,
    { style: s.footer, fixed: true },
    h(Text, null, title),
    h(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` }),
  );
}

export async function renderGuidePdf(guide) {
  const accent = accentFor(guide.title || 'guide');
  const s = styles(accent);
  const pages = [];

  // 1. Cover
  pages.push(
    h(
      Page,
      { key: 'cover', size: 'A4' },
      h(
        View,
        { style: s.cover },
        h(Text, { style: s.coverBadge }, 'The Practical Guide'),
        h(View, null, h(View, { style: s.coverRule }), h(Text, { style: s.coverTitle }, guide.title), h(Text, { style: s.coverPromise }, guide.promise)),
        h(Text, { style: s.coverFoot }, 'Created with PDF Idea Finder'),
      ),
    ),
  );

  // 2. Who this is for + the framework
  pages.push(
    h(
      Page,
      { key: 'intro', size: 'A4', style: s.page },
      h(Text, { style: s.kicker }, 'Start here'),
      h(Text, { style: s.h2 }, 'What this guide gives you'),
      h(Text, { style: s.lead }, guide.promise),
      h(Text, { style: s.label }, 'Who this is for'),
      h(Text, { style: s.para }, guide.reader),
      guide.framework?.name
        ? h(
            View,
            { style: { marginTop: 14 } },
            h(Text, { style: s.label }, `The method: ${guide.framework.name}`),
            ...steps(guide.framework.steps, s),
          )
        : null,
      footer(guide.title, s),
    ),
  );

  // 3. Contents
  pages.push(
    h(
      Page,
      { key: 'toc', size: 'A4', style: s.page },
      h(Text, { style: s.h2 }, 'Contents'),
      ...guide.chapters.map((c, i) => h(View, { key: i, style: s.toc }, h(Text, { style: s.tocNum }, String(i + 1)), h(Text, { style: s.tocText }, c.heading))),
      footer(guide.title, s),
    ),
  );

  // 4. Chapters
  guide.chapters.forEach((c, i) => {
    pages.push(
      h(
        Page,
        { key: `ch${i}`, size: 'A4', style: s.page },
        h(Text, { style: s.chNum }, `CHAPTER ${i + 1}`),
        h(Text, { style: s.chHeading }, c.heading),
        h(View, { style: s.chRule }),
        ...paras(c.intro, s),
        c.steps?.length ? h(View, { style: { marginTop: 4, marginBottom: 4 } }, ...steps(c.steps, s)) : null,
        callout('example', 'Example', c.example, s),
        callout('mistake', 'Avoid this mistake', c.mistake, s),
        callout('action', 'Do this now', c.action, s),
        footer(guide.title, s),
      ),
    );
  });

  // 5. Worksheet
  if (guide.checklist?.length) {
    pages.push(
      h(
        Page,
        { key: 'worksheet', size: 'A4', style: s.page },
        h(Text, { style: s.kicker }, 'Worksheet'),
        h(Text, { style: s.h2 }, 'Your action plan'),
        h(Text, { style: s.lead }, 'Work through these. Tick each one as you go.'),
        ...guide.checklist.map((t, i) => h(View, { key: i, style: s.check, wrap: false }, h(View, { style: s.checkBox }), h(Text, { style: { flex: 1 } }, t))),
        h(Text, { style: [s.label, { marginTop: 16 }] }, 'Notes'),
        ...[0, 1, 2, 3].map((i) => h(View, { key: i, style: s.blankLine })),
        footer(guide.title, s),
      ),
    );
  }

  // 6. FAQ
  if (guide.faq?.length) {
    pages.push(
      h(
        Page,
        { key: 'faq', size: 'A4', style: s.page },
        h(Text, { style: s.h2 }, 'Frequently asked questions'),
        ...guide.faq.flatMap((f, i) => [h(Text, { key: `q${i}`, style: s.faqQ }, f.q), h(Text, { key: `a${i}`, style: s.para }, f.a)]),
        footer(guide.title, s),
      ),
    );
  }

  // 7. Resources + CTA
  pages.push(
    h(
      Page,
      { key: 'end', size: 'A4', style: s.page },
      guide.resources?.length
        ? h(
            View,
            null,
            h(Text, { style: s.h2 }, 'Next steps & resources'),
            ...guide.resources.map((r, i) => h(View, { key: i, style: s.bullet }, h(Text, { style: s.dot }, '•'), h(Text, { style: { flex: 1 } }, r))),
          )
        : null,
      guide.cta ? h(View, { style: [s.action, { marginTop: 18 }] }, h(Text, { style: { color: '#fff', fontFamily: 'Helvetica-Bold' } }, guide.cta)) : null,
      footer(guide.title, s),
    ),
  );

  const doc = h(Document, { title: guide.title, author: 'PDF Idea Finder' }, ...pages);
  return renderToBuffer(doc);
}
