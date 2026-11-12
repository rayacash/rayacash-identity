// Prueba manual de la librería. Sin dependencias y sin scripts inline, para que
// csp.html la cargue tal cual.

function startDemo() {
  var SCENARIOS = ["ok", "declined", "camera", "storage", "unsupported", "unavailable", "silent", "slow", "reload", "hostile"];
  var BASE_URLS = {
    fake: "http://localhost:" + window.location.port,
    production: "https://raya.cash",
  };

  function byId(id) {
    return document.getElementById(id);
  }

  var environment = byId("environment");
  var danger = byId("danger");
  var understood = byId("understood");
  var scenario = byId("scenario");
  var scenarioField = byId("scenario-field");
  var verification = byId("verification");
  var closeOnComplete = byId("close-on-complete");
  var openButton = byId("open");
  var openTwice = byId("open-twice");
  var closeLater = byId("close-later");
  var logBox = byId("log");

  function log(label, value) {
    var line = new Date().toISOString().slice(11, 23) + "  " + label;
    if (value !== undefined) line += "  " + JSON.stringify(value);
    logBox.textContent += line + "\n";
  }

  function fakeId(name) {
    return "idv_" + ("demo" + name).padEnd(24, "0");
  }

  function refresh() {
    var isFake = environment.value === "fake";
    var isReal = environment.value === "production";
    scenarioField.hidden = !isFake;
    danger.hidden = !isReal;
    if (isFake) verification.value = fakeId(scenario.value);
    else if (verification.value.indexOf("idv_demo") === 0) verification.value = "";
    var blocked = isReal && !understood.checked;
    openButton.disabled = blocked;
    openTwice.disabled = blocked;
  }

  SCENARIOS.forEach(function (name) {
    var option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    scenario.appendChild(option);
  });
  environment.addEventListener("change", refresh);
  scenario.addEventListener("change", refresh);
  understood.addEventListener("change", refresh);

  function instance() {
    return window.RayaIdentity({ baseUrl: BASE_URLS[environment.value] });
  }

  function onEvent(event) {
    log("evento", event);
    if (closeOnComplete.checked && event.type === "completed") window.RayaIdentity().close();
  }

  function start() {
    try {
      var promise = instance().open(verification.value, { onEvent: onEvent });
      promise.then(function (result) {
        log("resultado", result);
      });
      return promise;
    } catch (error) {
      log(error.name, error.message);
      return null;
    }
  }

  openButton.addEventListener("click", start);
  openTwice.addEventListener("click", function () {
    var first = start();
    var second = start();
    log("misma promesa", first === second);
  });
  closeLater.addEventListener("click", function () {
    log("close() en 3 s");
    setTimeout(function () {
      window.RayaIdentity().close();
      log("close() llamado");
    }, 3000);
  });
  byId("clear").addEventListener("click", function () {
    logBox.textContent = "";
  });

  log("versión", window.RayaIdentity && window.RayaIdentity.version);
  refresh();
}

// El debug por defecto; con ?min, el minificado (el mismo archivo que se sube al
// CDN para el <script>).
(function () {
  var library = document.createElement("script");
  library.src = "../dist/" + (/[?&]min\b/.test(window.location.search) ? "identity.js" : "identity.debug.js");
  library.onload = startDemo;
  document.head.appendChild(library);
})();
