import { connect } from "./registry.js";
import { API_VERSIONS, buildPlugin } from "./build.js";
import { VALUE_ADAPTERS, adaptDescriptor } from "./value-adapters.js";

export default {
  setup(ctx) {
    connect(ctx.use("registry"), ctx.use("values"));
    return { API_VERSIONS, buildPlugin, VALUE_ADAPTERS, adaptDescriptor };
  },
};
