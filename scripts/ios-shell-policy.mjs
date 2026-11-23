/**
 * Facts the iOS shell must keep. The plist apply script and the Linux check
 * both read this module so the Info.plist text cannot drift from the docs.
 */

export const CAPACITOR_VERSION = "8.6.0";
export const APP_ID = "tech.seanbc618.puxian";
export const APP_NAME = "谱线";
export const WEB_DIR = "dist-static";

/**
 * Local pitch and rhythm only. The suggested sentence 「不会上传录音」 stays
 * out until a packaged-app network audit. See docs/appstore-path.md.
 */
export const MIC_USAGE =
  "用于在你点击「开始哼唱」之后，在本机录下哼唱，并识别音高和节奏以写成曲谱。";

/** System or imported types the shell may offer to view. Not owners of XML or audio. */
export const OPEN_CONTENT_TYPES = [
  "org.musicxml.musicxml",
  "public.midi-audio",
  "app.puxian.import.jpwabc",
];

/** Must not appear as an LSItemContentTypes entry. Conformance tags are separate. */
export const FORBIDDEN_OPEN_TYPES = [
  "public.xml",
  "public.audio",
  "public.mp3",
  "public.mpeg-4-audio",
  "public.image",
  "public.data",
  "public.text",
  "public.plain-text",
];

export const SHELL_PLIST_BEGIN = "<!-- puxian-ios-shell:start -->";
export const SHELL_PLIST_END = "<!-- puxian-ios-shell:end -->";

export function shellPolicyXml() {
  return `	<key>NSMicrophoneUsageDescription</key>
	<string>${MIC_USAGE}</string>
	<key>LSSupportsOpeningDocumentsInPlace</key>
	<false/>
	<key>CFBundleDocumentTypes</key>
	<array>
		<dict>
			<key>CFBundleTypeName</key>
			<string>MusicXML</string>
			<key>CFBundleTypeRole</key>
			<string>Viewer</string>
			<key>LSHandlerRank</key>
			<string>Alternate</string>
			<key>LSItemContentTypes</key>
			<array>
				<string>org.musicxml.musicxml</string>
			</array>
		</dict>
		<dict>
			<key>CFBundleTypeName</key>
			<string>MIDI</string>
			<key>CFBundleTypeRole</key>
			<string>Viewer</string>
			<key>LSHandlerRank</key>
			<string>Alternate</string>
			<key>LSItemContentTypes</key>
			<array>
				<string>public.midi-audio</string>
			</array>
		</dict>
		<dict>
			<key>CFBundleTypeName</key>
			<string>JP-Word</string>
			<key>CFBundleTypeRole</key>
			<string>Viewer</string>
			<key>LSHandlerRank</key>
			<string>Alternate</string>
			<key>LSItemContentTypes</key>
			<array>
				<string>app.puxian.import.jpwabc</string>
			</array>
		</dict>
	</array>
	<key>UTImportedTypeDeclarations</key>
	<array>
		<dict>
			<key>UTTypeIdentifier</key>
			<string>org.musicxml.musicxml</string>
			<key>UTTypeDescription</key>
			<string>MusicXML</string>
			<key>UTTypeConformsTo</key>
			<array>
				<string>public.xml</string>
			</array>
			<key>UTTypeTagSpecification</key>
			<dict>
				<key>public.filename-extension</key>
				<array>
					<string>musicxml</string>
					<string>mxl</string>
				</array>
				<key>public.mime-type</key>
				<array>
					<string>application/vnd.recordare.musicxml+xml</string>
					<string>application/vnd.recordare.musicxml</string>
				</array>
			</dict>
		</dict>
		<dict>
			<key>UTTypeIdentifier</key>
			<string>app.puxian.import.jpwabc</string>
			<key>UTTypeDescription</key>
			<string>JP-Word 文本谱</string>
			<key>UTTypeConformsTo</key>
			<array>
				<string>public.data</string>
			</array>
			<key>UTTypeTagSpecification</key>
			<dict>
				<key>public.filename-extension</key>
				<array>
					<string>jpwabc</string>
				</array>
			</dict>
		</dict>
	</array>`;
}

export function applyShellPolicy(plist) {
  const block = `\t${SHELL_PLIST_BEGIN}\n${shellPolicyXml()}\n\t${SHELL_PLIST_END}`;
  const marked = new RegExp(
    `${SHELL_PLIST_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${SHELL_PLIST_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );
  let next = plist;
  if (marked.test(next)) next = next.replace(marked, block.trim());
  else {
    const close = next.lastIndexOf("</dict>");
    if (close < 0) throw new Error("Info.plist has no </dict>");
    next = `${next.slice(0, close)}${block}\n${next.slice(close)}`;
  }
  return next.replace(
    /(<key>CFBundleDevelopmentRegion<\/key>\s*<string>)[^<]*(<\/string>)/,
    "$1zh-Hans$2",
  );
}

/** LSItemContentTypes string values only. Conformance tags are not open handlers. */
export function openContentTypes(plist) {
  const types = [];
  const arrays = plist.matchAll(/<key>LSItemContentTypes<\/key>\s*<array>([\s\S]*?)<\/array>/g);
  for (const match of arrays) {
    for (const inner of match[1].matchAll(/<string>([^<]*)<\/string>/g)) {
      types.push(inner[1]);
    }
  }
  return types;
}

export function filenameExtensions(plist) {
  const types = [];
  const blocks = plist.matchAll(
    /<key>public\.filename-extension<\/key>\s*<array>([\s\S]*?)<\/array>/g,
  );
  for (const match of blocks) {
    for (const inner of match[1].matchAll(/<string>([^<]*)<\/string>/g)) {
      types.push(inner[1]);
    }
  }
  return types;
}
