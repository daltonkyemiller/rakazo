import { readFile } from "node:fs/promises";

const { build } = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));

export default {
  ...build,
  appId: "dev.rakazo.desktop.local",
  productName: "Rakazo Local",
  directories: { ...build.directories, output: "out/local" },
  extraMetadata: {
    ...build.extraMetadata,
    name: "rakazo-local",
    productName: "Rakazo Local",
  },
  mac: { ...build.mac, identity: "-", notarize: false, target: ["dir"] },
  publish: null,
};
