// Todo lo que los tests usan de ../src, en un solo lugar.

export { default as RayaIdentity } from "../src/index.ts";
export { createInstance } from "../src/controller.ts";
export * from "../src/constants.ts";
export { hooks } from "../src/env.ts";
export { IntegrationError } from "../src/errors.ts";
export type { IdentityEvent, IdentityResult } from "../src/identity.d.ts";
export { createModal } from "../src/modal.ts";
export type { Modal, ModalConfig, PanelState } from "../src/modal.ts";
export * from "../src/protocol.ts";
export * from "../src/validate.ts";
