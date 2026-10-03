import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Bulk Mailer",
    identifier: "dev.kikketer.bulk-mailer",
    version: "0.1.0",
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
      notarize: true,
      createDmg: true,
    },
  },
} satisfies ElectrobunConfig;
