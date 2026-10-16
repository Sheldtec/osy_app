import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";

import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Renders the admin editor's rich text.
 *
 * Product descriptions come back as HTML (`<h1><span>…</span></h1><div><br></div>`)
 * because the admin console writes them with a rich-text editor. React Native
 * has no HTML renderer, so putting that string straight into a `<Text>` prints
 * the tags verbatim — which is exactly what the product page was doing.
 *
 * This is a small purpose-built renderer rather than a dependency: the tag set
 * an editor emits is bounded and known, and handling it here means the output
 * uses the app's own type tokens instead of a library's defaults. Anything
 * unrecognised degrades to its text — a tag never reaches the screen.
 *
 * It is NOT a general HTML engine and must not be pointed at untrusted input;
 * the backend already sanitises what admins write.
 */

type BlockKind = "paragraph" | "h1" | "h2" | "h3" | "item";

interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

interface Block {
  kind: BlockKind;
  spans: Span[];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  times: "×",
};

function decode(s: string): string {
  return s.replace(/&(#?\w+);/g, (whole, name: string) => {
    if (ENTITIES[name]) return ENTITIES[name];
    const num = /^#(\d+)$/.exec(name);
    return num ? String.fromCharCode(Number(num[1])) : whole;
  });
}

const BLOCK = /^(p|div|h[1-6]|li|ul|ol|blockquote|section|article)$/;

/**
 * Walk the markup once, emitting blocks of styled spans.
 *
 * A single pass with an explicit state machine — no sentinel characters, no
 * splitting on markers, so nothing depends on a byte the editor might one day
 * emit itself.
 */
function parse(html: string): Block[] {
  const blocks: Block[] = [];

  let kind: BlockKind = "paragraph";
  let spans: Span[] = [];
  let buffer = "";
  let bold = 0;
  let italic = 0;

  const flushSpan = () => {
    const text = decode(buffer);
    if (text) spans.push({ text, bold: bold > 0, italic: italic > 0 });
    buffer = "";
  };

  const flushBlock = (next: BlockKind = "paragraph") => {
    flushSpan();
    const kept = spans
      .map((s) => ({ ...s, text: s.text.replace(/[ \t]+/g, " ") }))
      .filter((s) => s.text.trim());
    if (kept.length) blocks.push({ kind, spans: kept });
    spans = [];
    kind = next;
  };

  const token = /<\s*(\/?)\s*([a-zA-Z0-9]+)[^>]*>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = token.exec(html))) {
    buffer += html.slice(last, m.index);
    last = token.lastIndex;

    const closing = m[1] === "/";
    const name = m[2].toLowerCase();

    if (name === "br") {
      buffer += "\n";
    } else if (name === "b" || name === "strong") {
      flushSpan();
      bold = Math.max(0, bold + (closing ? -1 : 1));
    } else if (name === "i" || name === "em") {
      flushSpan();
      italic = Math.max(0, italic + (closing ? -1 : 1));
    } else if (BLOCK.test(name)) {
      // A block boundary either way: closing ends this one, opening starts the
      // next. Headings and list items carry their kind from the opening tag.
      if (closing) {
        flushBlock("paragraph");
      } else if (/^h[1-3]$/.test(name)) {
        flushBlock(name as BlockKind);
      } else if (/^h[4-6]$/.test(name)) {
        flushBlock("h3");
      } else if (name === "li") {
        flushBlock("item");
      } else {
        flushBlock("paragraph");
      }
    }
    // Everything else (span, font, a, img …) contributes its text, not itself.
  }

  buffer += html.slice(last);
  flushBlock();

  return blocks;
}

export function RichText({ html, style }: { html: string; style?: StyleProp<TextStyle> }) {
  const styles = useThemedStyles(makeStyles);
  const blocks = parse(html);

  // Nothing survived — show the bare text rather than an empty gap, with any
  // residual markup stripped so a tag never reaches the screen.
  if (!blocks.length) {
    const bare = decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    return bare ? <Text style={[styles.body, style]}>{bare}</Text> : null;
  }

  return (
    <View>
      {blocks.map((block, i) => {
        const children = block.spans.map((s, j) => (
          <Text
            key={j}
            style={[
              s.bold && { fontFamily: fonts.medium },
              s.italic && { fontStyle: "italic" as const },
            ]}
          >
            {s.text}
          </Text>
        ));

        if (block.kind === "item") {
          return (
            <View key={i} style={styles.item}>
              <Text style={styles.bullet}>•</Text>
              <Text style={[styles.body, style, { flex: 1 }]}>{children}</Text>
            </View>
          );
        }

        if (block.kind !== "paragraph") {
          const head =
            block.kind === "h1" ? styles.h1 : block.kind === "h2" ? styles.h2 : styles.h3;
          return (
            <Text key={i} style={[head, i > 0 && { marginTop: 16 }]}>
              {children}
            </Text>
          );
        }

        return (
          <Text key={i} style={[styles.body, style, i > 0 && { marginTop: 10 }]}>
            {children}
          </Text>
        );
      })}
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  body: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 21,
    color: t.textInk.body,
    includeFontPadding: false,
  },
  h1: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 24,
    color: t.textInk.strong,
    includeFontPadding: false,
  },
  h2: {
    fontFamily: fonts.display,
    fontSize: 16,
    lineHeight: 22,
    color: t.textInk.strong,
    includeFontPadding: false,
  },
  h3: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: t.textInk.strong,
    includeFontPadding: false,
  },
  item: { flexDirection: "row", gap: 8, marginTop: 6 },
  bullet: { fontFamily: fonts.body, fontSize: 13, lineHeight: 21, color: t.textInk.faint },
});
