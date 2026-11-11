import { connect, defaultFor, formatValue, packValue, readValue, unpackValue, upgradeValue, versionOf, writeValue } from "./values.js";

export default {
  setup(ctx) {
    connect(ctx.emitter(), ctx.use("registry"));
    ctx.fill("registry.write", writeValue);
    ctx.fill("registry.defaultOf", defaultFor);
    ctx.fill("registry.format", formatValue);
    return { readValue, writeValue, defaultFor, formatValue, versionOf, upgradeValue, packValue, unpackValue };
  },
};
