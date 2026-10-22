import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { SvgUri } from "react-native-svg";
import { native, useThemedStyles } from "../lib/native";

/** Use the catalog artwork, matching web, with a local fallback for missing logos. */
export function ConnectorIcon({
  name,
  logo,
  size = 36,
}: {
  name: string;
  logo?: string | null;
  size?: number;
}) {
  const styles = useThemedStyles(createStyles);
  // Catalogs often serve SVG from extensionless URLs, which Image cannot decode,
  // so a failed raster load retries as SVG before falling back to the initial.
  const [failure, setFailure] = useState<{ logo: string; svgFailed: boolean } | null>(null);
  const failed = logo && failure?.logo === logo ? failure : null;
  const svg = Boolean(logo && (/\.svg(?:[?#]|$)/i.test(logo) || failed));
  const uri = logo && !failed?.svgFailed ? logo : null;
  // Inline sizes (mention chips) keep the same proportions as the 36pt list icon.
  const art = size - Math.min(8, Math.round(size / 4));
  const initial = (
    <Text style={[styles.letter, { fontSize: Math.min(16, Math.round(size * 0.45)) }]}>
      {(name.trim()[0] || "?").toUpperCase()}
    </Text>
  );
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.frame, { width: size, height: size, borderRadius: Math.min(10, size * 0.28) }]}
    >
      {uri ? (
        svg ? (
          <SvgUri
            uri={uri}
            width={art}
            height={art}
            onError={() => setFailure({ logo: uri, svgFailed: true })}
            // SvgUri does not report XML parse errors, only renders this fallback.
            fallback={initial}
          />
        ) : (
          <Image
            source={{ uri }}
            resizeMode="contain"
            onError={() => setFailure({ logo: uri, svgFailed: false })}
            style={{ width: art, height: art }}
          />
        )
      ) : (
        initial
      )}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    frame: {
      backgroundColor: native.fillPressed,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    letter: { color: native.label, fontWeight: "600" },
  });
}
