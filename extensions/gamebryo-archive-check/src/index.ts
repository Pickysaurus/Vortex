import { types } from "@nexusmods/vortex-api";

import { archiveHealthCheck } from "./diagnostics";

function main(context: types.IExtensionContext) {
  context.requireExtension("gamebryo-plugin-management");

  context.registerHealthCheck(archiveHealthCheck);
  return true;
}

export default main;
