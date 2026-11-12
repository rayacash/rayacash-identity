import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { IntegrationError, parseVerification, validateBaseUrl, validateFactoryOptions, validateOpenOptions } from "./_src.ts";
import { ID, ORIGIN } from "./_dom.ts";

function throwsIntegration(run: () => unknown, match?: RegExp): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof IntegrationError);
    assert.equal(error.name, "IntegrationError");
    assert.ok(error.message.startsWith("Raya Identity: "), error.message);
    if (match) assert.match(error.message, match);
    return true;
  });
}

describe("baseUrl", () => {
  const accepted: [string, string][] = [
    ["https://raya.cash", "https://raya.cash"],
    ["https://raya.cash/", "https://raya.cash"],
    ["https://otro.raya.cash", "https://otro.raya.cash"],
    ["HTTPS://RAYA.CASH", "https://raya.cash"],
    ["https://raya.cash:443", "https://raya.cash"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:5051", "http://127.0.0.1:5051"],
    ["http://[::1]:3000", "http://[::1]:3000"],
    ["http://app.localhost:3000", "http://app.localhost:3000"],
  ];
  for (const [input, origin] of accepted) {
    test(`acepta ${input}`, () => assert.equal(validateBaseUrl(input), origin));
  }

  const rejected: unknown[] = [
    5,
    null,
    {},
    "raya.cash",
    "//raya.cash",
    "http://raya.cash",
    "https://evil.com",
    "https://raya.cash.evil.com",
    "https://evilraya.cash",
    "https://raya.cash@evil.com",
    "https://user:pw@raya.cash",
    "https://raya.cash/identity",
    "https://raya.cash?x",
    "https://raya.cash/?x=1",
    "https://raya.cash#x",
    "https://raya.cash/#",
    "https://raya.cash.",
    "javascript:alert(1)",
    " https://raya.cash",
    "https://raya.cash ",
    "https://raya .cash",
    "https:\\\\raya.cash",
    "https://raya.cash\t",
  ];
  for (const input of rejected) {
    test(`rechaza ${JSON.stringify(input)}`, () => throwsIntegration(() => validateBaseUrl(input)));
  }

  test("los mensajes no repiten el valor", () => {
    assert.throws(
      () => validateBaseUrl("https://secreto.example.com"),
      (error: Error) => !error.message.includes("secreto"),
    );
  });
});

describe("parseVerification", () => {
  test("el id", () => assert.equal(parseVerification(ID, ORIGIN), ID));
  test("el id con espacios alrededor", () => assert.equal(parseVerification(`  ${ID}\n`, ORIGIN), ID));
  test("la url de producción", () => assert.equal(parseVerification(`https://raya.cash/identity/${ID}`, ORIGIN), ID));
  test("la url de otro origen de Raya con su baseUrl", () => {
    assert.equal(parseVerification(`https://otro.raya.cash/identity/${ID}`, "https://otro.raya.cash"), ID);
  });
  test("mayúsculas en el esquema y el host", () => assert.equal(parseVerification(`HTTPS://RAYA.CASH/identity/${ID}`, ORIGIN), ID));

  const badIds: unknown[] = [
    5,
    null,
    undefined,
    {},
    "",
    "idv_" + "a".repeat(23),
    "idv_" + "a".repeat(25),
    "idv-" + "a".repeat(24),
    "idb_" + "a".repeat(24),
    "idv_" + "a".repeat(23) + "/",
    "/identity/" + ID,
  ];
  for (const value of badIds) {
    test(`rechaza el id ${JSON.stringify(value)}`, () => throwsIntegration(() => parseVerification(value, ORIGIN)));
  }

  test("url de otro origen: el mensaje nombra baseUrl", () => {
    throwsIntegration(() => parseVerification(`https://otro.raya.cash/identity/${ID}`, ORIGIN), /baseUrl/);
    throwsIntegration(() => parseVerification(`https://evil.com/identity/${ID}`, ORIGIN), /baseUrl/);
  });

  test("el truco del userinfo no pasa por raya.cash", () => {
    throwsIntegration(() => parseVerification(`https://raya.cash@evil.com/identity/${ID}`, ORIGIN), /baseUrl/);
  });

  const badShapes = [
    `https://raya.cash/identity/${ID}?embed=1`,
    `https://raya.cash/identity/${ID}?`,
    `https://raya.cash/identity/${ID}#x`,
    `https://raya.cash/identity/${ID}#`,
    `https://raya.cash/identity/${ID}/`,
    `https://raya.cash/x/identity/${ID}`,
    `https://raya.cash/identity/%41${ID.slice(5)}`,
    `https://user@raya.cash/identity/${ID}`,
    "https://raya.cash/identity/",
  ];
  for (const url of badShapes) {
    test(`rechaza la forma ${url}`, () => throwsIntegration(() => parseVerification(url, ORIGIN), /forma esperada/));
  }

  test("el mensaje no repite el valor", () => {
    assert.throws(
      () => parseVerification("idv_secreto", ORIGIN),
      (error: Error) => !error.message.includes("secreto"),
    );
  });
});

describe("opciones", () => {
  test("undefined y null son sin opciones", () => {
    assert.deepEqual(validateFactoryOptions(undefined), { origin: ORIGIN });
    assert.deepEqual(validateFactoryOptions(null), { origin: ORIGIN });
    assert.deepEqual(validateOpenOptions(undefined), { onEvent: null });
    assert.deepEqual(validateOpenOptions(null), { onEvent: null });
  });

  test("baseUrl pasa por la validación", () => {
    assert.deepEqual(validateFactoryOptions({ baseUrl: "https://otro.raya.cash/" }), { origin: "https://otro.raya.cash" });
    throwsIntegration(() => validateFactoryOptions({ baseUrl: "https://example.com" }));
    throwsIntegration(() => validateFactoryOptions({ baseUrl: null }));
  });

  test("una opción desconocida se nombra", () => {
    throwsIntegration(() => validateFactoryOptions({ baseURL: "x" }), /"baseURL"\. La única opción válida es baseUrl\./);
    throwsIntegration(() => validateOpenOptions({ onevent: () => undefined }), /"onevent"\. La única opción válida es onEvent\./);
  });

  test("un nombre muy largo se corta", () => {
    assert.throws(
      () => validateFactoryOptions({ ["x".repeat(100)]: 1 }),
      (error: Error) => !error.message.includes("x".repeat(41)),
    );
  });

  test("arrays, instancias y strings tiran", () => {
    class Custom {}
    for (const value of [[], new Custom(), "hola", 5, true]) {
      throwsIntegration(() => validateFactoryOptions(value), /tienen que ser un objeto/);
      throwsIntegration(() => validateOpenOptions(value), /tienen que ser un objeto/);
    }
  });

  test("una clave como primer argumento tira sin repetirla", () => {
    for (const prefix of ["raya_sk_", "raya_pk_"]) {
      const key = prefix + "live_" + "Qw7".repeat(16);
      assert.throws(
        () => validateFactoryOptions(key),
        (error: Error) => error.name === "IntegrationError" && /no lleva clave/.test(error.message) && !error.message.includes("Qw7"),
      );
    }
  });

  test("onEvent tiene que ser función", () => {
    throwsIntegration(() => validateOpenOptions({ onEvent: 5 }), /onEvent tiene que ser una función/);
    const onEvent = () => undefined;
    assert.deepEqual(validateOpenOptions({ onEvent }), { onEvent });
    assert.deepEqual(validateOpenOptions({ onEvent: null }), { onEvent: null });
  });
});
