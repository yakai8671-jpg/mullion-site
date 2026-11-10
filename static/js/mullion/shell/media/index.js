import { connect } from "./deps.js";
import { diskAddress, extensionOf, locate, mediaOfName } from "./media.js";

export default {
  setup(ctx) {
    connect({ server: ctx.use("server") });
    return { extensionOf, mediaOfName, locate, diskAddress };
  },
};
