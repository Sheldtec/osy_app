import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";

import { AccountShell, Failed, Loading, Panel } from "@/components/account-ui";
import { RichText } from "@/components/rich-text";
import { Txt } from "@/components/ui";
import { ApiError } from "@/lib/http";
import { getLegal, type LegalDoc, type LegalSlug } from "@/lib/settings";
import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * One published policy — terms, privacy or returns.
 *
 * The body is HTML, but it is SANITISED SERVER-SIDE to a small allowlist
 * (p, h3, ul, ol, li, strong, em, a[href]), so it is rendered with `RichText`
 * rather than a WebView: a WebView here would be a browser engine pointed at
 * admin-authored markup, which is a much larger surface than the content needs.
 *
 * The revision is shown because these documents change. Somebody deciding
 * whether to commit money over months — an instalment plan, a pre-order — is
 * entitled to know which version they are reading.
 */

const TITLES: Record<string, string> = {
  terms: "Terms & conditions",
  privacy: "Privacy policy",
  returns: "Returns & refunds",
};

const VALID = ["terms", "privacy", "returns"];

export default function LegalScreen() {
  const s = useThemedStyles(makeS);
  const { slug } = useLocalSearchParams<{ slug?: string }>();

  const [doc, setDoc] = useState<LegalDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);

    // An unknown slug is a 404 from the server; catching it here means a bad
    // deep link reads as "we couldn't find that" rather than a crash.
    if (!slug || !VALID.includes(slug)) {
      setError("We couldn’t find that policy.");

      return;
    }

    try {
      setDoc(await getLegal(slug as LegalSlug));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn’t load that policy.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AccountShell
      title={doc?.title ?? TITLES[slug ?? ""] ?? "Policy"}
      subtitle={effective(doc)}
    >
      {doc === null && error === null ? <Loading label="Loading…" /> : null}
      {error ? <Failed message={error} onRetry={() => void load()} /> : null}

      {doc ? (
        <Panel>
          {doc.body.trim() ? (
            <RichText html={doc.body} />
          ) : (
            <Txt tone="body" size={11} style={{ lineHeight: 17 }}>
              This policy hasn’t been published yet. Ask us and we’ll tell you where we stand.
            </Txt>
          )}
        </Panel>
      ) : null}

      {doc?.revision ? (
        <Text style={s.rev}>Revision {doc.revision}</Text>
      ) : null}
    </AccountShell>
  );
}

/** "In effect since 12 Aug 2026", when the server says so. */
function effective(doc: LegalDoc | null): string | undefined {
  if (!doc?.effective_from) return undefined;

  const d = new Date(doc.effective_from);
  if (Number.isNaN(d.getTime())) return undefined;

  return `In effect since ${d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

const makeS = (t: Theme) => StyleSheet.create({
  rev: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: t.textInk.faint,
    textAlign: "center",
    marginTop: 20,
  },
});
