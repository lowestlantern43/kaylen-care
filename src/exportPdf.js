import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export async function exportPdf(pdf, filename) {
  if (!Capacitor.isNativePlatform()) {
    await pdf.save(filename, { returnPromise: true });
    return;
  }
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `reports/${Date.now()}-${safeName}`;
  const { uri } = await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    data: pdf.output("datauristring").split(",")[1],
    recursive: true,
  });
  try {
    await Share.share({ files: [uri], title: "FamilyTrack report" });
  } finally {
    await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {});
  }
}
