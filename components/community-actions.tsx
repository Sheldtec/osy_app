import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { IconCopy, IconHeart, IconReply, IconTrash } from "@/components/icons";
import { Txt } from "@/components/ui";
import type { CommunityMessage } from "@/lib/community";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * What you can do to a message you are holding down.
 *
 * The room used to put `like` on a long press and nothing else, which made the
 * only reaction in the app invisible: a gesture with no affordance is a feature
 * nobody finds. Worse, the server has supported REPLIES and DELETE-YOUR-OWN all
 * along — bubbles even rendered the quote — and there was no way to reach
 * either from the app.
 *
 * It is a sheet rather than a floating pill over the bubble because the sheet
 * pattern is already this app's (`SelectField`, `CountryField`), and a phone
 * holding a thumb over the message it is acting on cannot also read a menu
 * drawn on top of it.
 *
 * Destructive last and in the danger colour, with its own confirm step, because
 * a delete here is not undoable — `destroyOwn` soft-deletes server-side and the
 * app has no route to bring one back.
 */
export function CommunityActions({
  message,
  canDelete,
  onClose,
  onReply,
  onCopy,
  onLike,
  onDelete,
}: {
  /** null closes the sheet — it is driven by which message is held. */
  message: CommunityMessage | null;
  canDelete: boolean;
  onClose: () => void;
  onReply: (m: CommunityMessage) => void;
  onCopy: (m: CommunityMessage) => void;
  onLike: (m: CommunityMessage) => void;
  onDelete: (m: CommunityMessage) => void;
}) {
  const theme = useTheme();
  const s = useThemedStyles(makeS);
  const m = message;

  /** The text a copy would put on the clipboard — a product post has none. */
  const copyable = (m?.body ?? "").trim().length > 0;

  function run(action: (msg: CommunityMessage) => void) {
    if (!m) return;
    // Closed BEFORE the action: a reply focuses the composer and raises the
    // keyboard, which cannot happen under an open modal.
    onClose();
    action(m);
  }

  return (
    <Modal
      visible={m !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close message actions" />

      <View style={s.wrap}>
        <View style={s.sheet}>
          <View style={s.handle} />

          {/* The message being acted on, quoted once, so the sheet cannot be
              about a different bubble than the one that was held. */}
          <View style={s.subject}>
            <Txt tone="faint" size={10} style={s.subjectName} numberOfLines={1}>
              {m?.mine ? "Your message" : m?.name}
            </Txt>
            <Txt tone="body" size={12.5} numberOfLines={2} style={{ lineHeight: 18 }}>
              {m?.type === "product"
                ? ((m.product as { name?: string } | null)?.name ?? "Product")
                : (m?.body ?? "")}
            </Txt>
          </View>

          <Action
            label="Reply"
            icon={<IconReply width={18} height={18} color={theme.textInk.strong} />}
            onPress={() => run(onReply)}
          />
          <Action
            label={m?.liked ? "Remove your like" : "Like"}
            icon={
              <IconHeart
                width={17}
                height={17}
                color={m?.liked ? theme.colors.primaryOn : theme.textInk.strong}
              />
            }
            onPress={() => run(onLike)}
          />
          {copyable && (
            <Action
              label="Copy text"
              icon={<IconCopy width={18} height={18} color={theme.textInk.strong} />}
              onPress={() => run(onCopy)}
            />
          )}
          {canDelete && (
            <Action
              label="Delete for everyone"
              danger
              icon={<IconTrash width={18} height={18} color={theme.colors.danger} />}
              onPress={() => run(onDelete)}
            />
          )}

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [s.cancel, pressed && { opacity: 0.7 }]}
          >
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Action({
  label,
  icon,
  danger,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  onPress: () => void;
}) {
  const s = useThemedStyles(makeS);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [s.action, pressed && s.actionPressed]}
    >
      <View style={s.actionIcon}>{icon}</View>
      <Text style={[s.actionLabel, danger && s.actionLabelDanger]}>{label}</Text>
    </Pressable>
  );
}

const makeS = (t: Theme) => StyleSheet.create({
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(20,12,26,0.42)" },
  // The sheet is bottom-anchored inside a full-height wrapper rather than
  // positioned, so its height follows the number of actions.
  wrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: t.colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 14,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.surfaces.handle,
    alignSelf: "center",
    marginBottom: 12,
  },

  subject: {
    paddingHorizontal: 10,
    paddingBottom: 12,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: t.surfaces.lineSoft,
  },
  subjectName: { letterSpacing: 1.1, textTransform: "uppercase", marginBottom: 4 },

  action: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 10, height: 52, borderRadius: 14 },
  actionPressed: { backgroundColor: t.surfaces.actionTint },
  actionIcon: { width: 22, alignItems: "center" },
  actionLabel: { fontFamily: fonts.body, fontSize: 14.5, color: t.textInk.strong },
  actionLabelDanger: { color: t.colors.danger },

  cancel: { height: 48, alignItems: "center", justifyContent: "center", marginTop: 4 },
  cancelText: { fontFamily: fonts.medium, fontSize: 14, color: t.textInk.faint },
});
