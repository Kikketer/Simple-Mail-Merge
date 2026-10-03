export default {
  electrobun: { version: "2.0.2" },
  scripts: {
    dev: ["hutch", "electrobun", "dev", "--watch"],
    build: ["hutch", "electrobun", "build", "--env=stable"],
  },
};
