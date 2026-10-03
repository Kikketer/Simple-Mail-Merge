import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Simple Mail Merge",
    identifier: "com.cjweed.simplemailmerge",
    version: "0.2.1",
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
      },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
      "src/mainview/style.css": "views/mainview/style.css",
    },
    mac: {
      icons: "icon.iconset",
      codesign: true,
      notarize: false,
      createDmg: true,
    },
  },
} satisfies ElectrobunConfig;
