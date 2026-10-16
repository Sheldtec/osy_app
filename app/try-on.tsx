import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  AccountShell,
  Empty,
  Failed,
  Loading,
  Panel,
  SectionLabel,
  Thumb,
} from "@/components/account-ui";
import { GradientButton, Txt } from "@/components/ui";
import { getProduct, getProducts } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canBeStyle, preparePhoto, renderLook } from "@/lib/face-match-api";
import { naira } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { useStorefrontSettings } from "@/lib/settings";
import type { Product } from "@/lib/types";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Try it on — the Face-Match studio.
 *
 * A photo of the customer plus a style from the catalogue goes to
 * `POST /face-match/render`, which proxies a generative image model and sends
 * back the customer wearing it. Nothing is stored server-side.
 *
 * Three things govern this screen, and each is a server rule rather than a
 * design choice:
 *
 *  · `feature_facematch_app` gates it. The owner can switch the app's try-on
 *    off independently of the website's, so the screen has to be able to say
 *    it is unavailable — and the entry point has to disappear with it.
 *  · Styles are limited to products whose photo is on Cloudinary, because the
 *    server will only fetch a style image from that host. In this catalogue
 *    that is a small minority of products, so the picker is built from what
 *    can actually render instead of from everything.
 *  · It is member-only and costs the shop money per call, so a guest is asked
 *    to sign in rather than allowed to press a button that 401s.
 *
 * The photo never leaves the device except as part of a render the customer
 * asked for, and that is stated on the screen before they choose one. Sending
 * someone's face to a third-party model is not something to do quietly.
 */

/** How many eligible styles to offer. Enough to choose from, not a catalogue. */
const STYLE_LIMIT = 12;

interface Shot {
  uri: string;
  width: number;
  height: number;
}

export default function TryOnScreen() {
  const theme = useTheme();
  const s = useThemedStyles(makeS);
  // Opened from a product page: that piece is what they want to see on
  // themselves, so it arrives already chosen.
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const { signedIn } = useAuth();
  const { features, loading: gating } = useStorefrontSettings();

  const [styles_, setStyles] = useState<Product[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [shot, setShot] = useState<Shot | null>(null);
  const [picked, setPicked] = useState<Product | null>(null);
  const [rendering, setRendering] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = features.face_match_app;

  // ---- the styles that can actually be rendered -------------------------
  /** Preselect happens once; a pull-to-refresh must not undo a later choice. */
  const preselected = useRef(false);

  const loadStyles = useCallback(async () => {
    setLoadError(null);
    try {
      // Asking for more than we show because most of this catalogue's photos
      // are not on the host the server will fetch from, so the eligible set is
      // much smaller than the page.
      const page = await getProducts({ per_page: 60, sort: "bestselling" });
      let list = page.items.filter((p) => canBeStyle(p.image)).slice(0, STYLE_LIMIT);

      if (slug) {
        const inRail = list.find((p) => p.slug === slug);

        if (inRail) {
          if (!preselected.current) setPicked(inRail);
        } else {
          // The rail is the most popular few. A piece opened from its own page
          // need not be in them — and selecting something the rail does not
          // show reads as nothing being selected at all. So it is fetched and
          // PREPENDED, which also puts it first, where it is already expected.
          const one = await getProduct(slug).catch(() => null);
          if (one && canBeStyle(one.image)) {
            list = [one as Product, ...list].slice(0, STYLE_LIMIT);
            if (!preselected.current) setPicked(one as Product);
          }
        }
        preselected.current = true;
      }

      setStyles(list);
    } catch {
      setLoadError("We couldn’t load the styles. Pull to try again.");
    }
  }, [slug]);

  useEffect(() => {
    if (enabled && signedIn) void loadStyles();
  }, [enabled, signedIn, loadStyles]);

  // ---- choosing a photo --------------------------------------------------
  async function choose(from: "camera" | "library") {
    setError(null);

    const permission =
      from === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setError(
        from === "camera"
          ? "We need camera access to take your photo. You can allow it in Settings."
          : "We need photo access to use a picture you already have. You can allow it in Settings.",
      );

      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [3, 4],
      quality: 1,
    };

    const res =
      from === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (res.canceled || !res.assets?.length) return;

    const a = res.assets[0];
    setShot({ uri: a.uri, width: a.width, height: a.height });
    // A new face means the old render is no longer of this person.
    setResult(null);
    setShowBefore(false);
  }

  // ---- render ------------------------------------------------------------
  async function render() {
    if (!shot || !picked?.image) return;

    setError(null);
    setRendering(true);
    setResult(null);

    try {
      const photo = await preparePhoto(shot.uri, shot.width, shot.height);
      const image = await renderLook(photo, picked.image, picked.name);
      setResult(image);
    } catch (err) {
      if (err instanceof ApiError) {
        // 429 is the shop's own cost throttle, and its message already says
        // so. 401 means the session went while they were choosing.
        setError(
          err.status === 401
            ? "Please sign in again to use the studio."
            : err.message,
        );
      } else {
        setError(
          err instanceof Error ? err.message : "That render didn’t work. Please try again.",
        );
      }
    } finally {
      setRendering(false);
    }
  }

  // ---- gates -------------------------------------------------------------
  if (gating) {
    return (
      <AccountShell title="Try it on" subtitle="Loading the studio…">
        <Loading label="Opening the studio…" />
      </AccountShell>
    );
  }

  if (!enabled) {
    return (
      <AccountShell title="Try it on" subtitle="The studio is closed just now.">
        <Empty
          title="Not available"
          body="Our try-on studio is switched off at the moment. Everything else in the shop is open as usual."
          action={{ label: "Browse the shop", onPress: () => router.replace("/shop") }}
        />
      </AccountShell>
    );
  }

  if (!signedIn) {
    return (
      <AccountShell title="Try it on" subtitle="See a piece on your own photo.">
        <Empty
          title="Sign in to use the studio"
          body="Each try-on is rendered for you personally, so it needs an account. It takes a minute to make one."
          action={{
            label: "Sign in or join",
            onPress: () => router.push({ pathname: "/auth", params: { mode: "signup" } }),
          }}
        />
      </AccountShell>
    );
  }

  const ready = Boolean(shot && picked);

  return (
    <AccountShell
      title="Try it on"
      subtitle="Add your photo, pick a piece, and see it on you."
      onRefresh={() => void loadStyles()}
      footerSpace={120}
      footer={
        <View style={[s.footer, { paddingBottom: 28 }]}>
          <GradientButton
            label={
              rendering ? "Rendering…" : result ? "Try another style" : "See it on me"
            }
            disabled={!ready || rendering}
            onPress={() => void render()}
          />
          {!ready ? (
            <Txt tone="body" size={9} center style={{ marginTop: 8 }}>
              {shot ? "Choose a style above." : "Add your photo to begin."}
            </Txt>
          ) : null}
        </View>
      }
    >
      {/* ---------------- the render, once there is one ------------------ */}
      {result ? (
        <Panel padded={false} style={{ padding: 12 }}>
          <View style={s.canvas}>
            <Image
              source={{ uri: showBefore ? shot!.uri : result }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={180}
            />
          </View>

          <View style={s.toggleRow}>
            {(["after", "before"] as const).map((k) => {
              const active = (k === "before") === showBefore;

              return (
                <Pressable
                  key={k}
                  onPress={() => setShowBefore(k === "before")}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[s.toggle, active && s.toggleActive]}
                >
                  <Text
                    style={{
                      fontFamily: fonts.medium,
                      fontSize: 11.5,
                      color: active ? theme.colors.primary : theme.textInk.soft,
                    }}
                  >
                    {k === "after" ? "With the piece" : "Your photo"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {picked ? (
            <Pressable
              onPress={() =>
                router.push({ pathname: "/product/[slug]", params: { slug: picked.slug } })
              }
              accessibilityRole="button"
              accessibilityLabel={`View ${picked.name}`}
              style={({ pressed }) => [s.resultRow, pressed && { opacity: 0.8 }]}
            >
              <Thumb src={picked.image} seed={picked.slug} alt={picked.name} width={44} height={52} />
              <View style={{ flex: 1 }}>
                <Txt tone="strong" size={11} numberOfLines={2} style={{ lineHeight: 15 }}>
                  {picked.name}
                </Txt>
                <Txt tone="strong" display size={14} style={{ marginTop: 3 }}>
                  {naira(picked.sale_price ?? picked.price)}
                </Txt>
              </View>
              <Text style={s.viewLink}>View</Text>
            </Pressable>
          ) : null}

          <Txt tone="body" size={9} style={{ marginTop: 12, lineHeight: 14 }}>
            A guide, not a photograph — lace, parting and fit are finished to your own head in
            the studio.
          </Txt>
        </Panel>
      ) : null}

      {/* ---------------- your photo -------------------------------------- */}
      <SectionLabel>YOUR PHOTO</SectionLabel>
      <Panel padded={false} style={{ padding: 12 }}>
        {shot ? (
          <View style={s.shotWrap}>
            <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          </View>
        ) : (
          <View style={s.shotEmpty}>
            <Txt tone="body" size={11} center style={{ lineHeight: 17 }}>
              Face the camera, hair back from your face, in even light.
            </Txt>
          </View>
        )}

        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <Choice label={shot ? "Retake" : "Take a photo"} onPress={() => void choose("camera")} />
          <Choice label={shot ? "Change" : "Choose one"} onPress={() => void choose("library")} />
        </View>

        {/* Said before they can send anything, not after. */}
        <Txt tone="body" size={9} style={{ marginTop: 12, lineHeight: 14 }}>
          Your photo stays on this phone until you tap “See it on me”. It is then sent to our
          rendering service for that one render and is not kept.
        </Txt>
      </Panel>

      {/* ---------------- the styles -------------------------------------- */}
      <SectionLabel>CHOOSE A PIECE</SectionLabel>

      {styles_ === null && loadError === null ? <Loading label="Loading styles…" /> : null}

      {loadError ? <Failed message={loadError} onRetry={() => void loadStyles()} /> : null}

      {/* Nothing eligible is a shop-data problem, not the shopper's. It is
          said plainly rather than shown as an empty rail. */}
      {styles_?.length === 0 ? (
        <Panel style={{ padding: 16 }}>
          <Txt tone="strong" size={13} weight="medium">
            No styles are ready for the studio
          </Txt>
          <Txt tone="body" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
            Try-on needs a piece photographed to studio standard, and none are published yet.
            Our team is adding them.
          </Txt>
        </Panel>
      ) : null}

      {styles_?.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 10, paddingVertical: 12, paddingRight: 8 }}
        >
          {styles_.map((p) => {
            const active = picked?.slug === p.slug;

            return (
              <Pressable
                key={p.slug}
                onPress={() => {
                  setPicked(p);
                  // The render on screen is of the OLD style.
                  setResult(null);
                  setShowBefore(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${p.name}, ${naira(p.sale_price ?? p.price)}`}
                style={({ pressed }) => [s.style, pressed && { opacity: 0.85 }]}
              >
                <View style={[s.styleImg, active && s.styleImgActive]}>
                  <Image
                    source={{ uri: p.image ?? undefined }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                </View>
                <Txt tone="strong" size={10} numberOfLines={2} style={{ lineHeight: 14, marginTop: 8 }}>
                  {p.name}
                </Txt>
                <Txt tone="body" size={9} style={{ marginTop: 2 }}>
                  {naira(p.sale_price ?? p.price)}
                </Txt>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {rendering ? (
        <Panel style={{ padding: 16, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <ActivityIndicator color={theme.colors.primary} />
          <View style={{ flex: 1 }}>
            <Txt tone="strong" size={12} weight="medium">
              Rendering your look
            </Txt>
            <Txt tone="body" size={9} style={{ marginTop: 4, lineHeight: 14 }}>
              This takes up to a minute or so. Keep the app open.
            </Txt>
          </View>
        </Panel>
      ) : null}

      {error ? (
        <Txt tone="danger" size={11} style={{ marginTop: 14, lineHeight: 16 }}>
          {error}
        </Txt>
      ) : null}
    </AccountShell>
  );
}

function Choice({ label, onPress }: { label: string; onPress: () => void }) {
  const s = useThemedStyles(makeS);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [s.choice, pressed && { opacity: 0.75 }]}
    >
      <Text style={s.choiceText}>{label}</Text>
    </Pressable>
  );
}

const makeS = (t: Theme) => StyleSheet.create({
  canvas: {
    aspectRatio: 3 / 4,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: t.colors.imgBg,
  },

  shotWrap: {
    aspectRatio: 3 / 4,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: t.colors.imgBg,
  },
  shotEmpty: {
    aspectRatio: 3 / 4,
    borderRadius: 16,
    backgroundColor: t.surfaces.cart,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },

  choice: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceText: { fontFamily: fonts.medium, fontSize: 12.5, color: t.colors.primaryOn },

  toggleRow: {
    flexDirection: "row",
    backgroundColor: t.surfaces.segmentTrack,
    borderRadius: 14,
    padding: 4,
    marginTop: 12,
  },
  toggle: { flex: 1, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  toggleActive: { backgroundColor: t.colors.surface },

  resultRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 },
  viewLink: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.primaryOn },

  style: { width: 118 },
  styleImg: {
    width: 118,
    height: 140,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: t.colors.imgBg,
  },
  // The selected state across this app is a thin gold ring, not a tint.
  styleImgActive: { borderWidth: 2, borderColor: t.colors.gold2 },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: t.surfaces.cart,
  },
});
