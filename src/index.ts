// Entrada de los módulos (dist/identity.mjs para import y dist/identity.cjs para
// require): arma RayaIdentity y lo exporta, también por default. Sin efectos al
// cargar (no toca window), así se puede importar en el servidor durante el SSR.

import type { RayaIdentityInstance, RayaIdentityOptions, RayaIdentityStatic } from "./identity.d.ts";
import { createInstance } from "./controller.ts";
import { IntegrationError } from "./errors.ts";
import { VERSION } from "./version.ts";

// Anda con y sin `new`: devuelve un objeto, así que `new RayaIdentity()` da lo mismo.
function RayaIdentityFactory(options?: RayaIdentityOptions): RayaIdentityInstance {
  return createInstance(options);
}

Object.defineProperty(RayaIdentityFactory, "version", { value: VERSION, enumerable: true });
Object.defineProperty(RayaIdentityFactory, "IntegrationError", { value: IntegrationError, enumerable: true });

// La firma de llamada se chequea acá: RayaIdentityFactory tiene que poder ser RayaIdentityStatic.
const callSignature: (options?: RayaIdentityOptions) => RayaIdentityInstance = RayaIdentityFactory;
const RayaIdentity = callSignature as unknown as RayaIdentityStatic;

export default RayaIdentity;
export { RayaIdentity };
