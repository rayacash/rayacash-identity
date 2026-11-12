// IntegrationError: un error de programación (clave en el navegador, id con otra
// forma, opción desconocida). Se tira sincrónico y siempre igual. Ningún mensaje
// repite un valor recibido: solo el nombre de una opción desconocida.

export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationError";
  }
}

export function integrationError(message: string): IntegrationError {
  return new IntegrationError("Raya Identity: " + message);
}
