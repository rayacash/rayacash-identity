// Página alojada falsa: el lado del iframe del protocolo v1, sin cámara ni API.
// El escenario va en el id: "idv_" + ("demo" + nombre).padEnd(24, "0").
// Sirve de referencia para el lado real (composables/useIdentityHostedEmbed.ts).

(function () {
  var SOURCE = "raya-identity";
  var VERSION = 1;
  var HELLO_DELAYS_MS = [0, 250, 1000, 3000];
  var RELOAD_KEY = "idj-reloaded";

  var id = window.location.pathname.split("/").pop();
  var scenario = id.slice(8).replace(/0+$/, "");
  var parentOrigin = null;
  var nonce = null;
  var started = false;

  var statusBox = document.getElementById("status");
  var eventsBox = document.getElementById("events");
  var finishButton = document.getElementById("finish");

  function note(text) {
    var item = document.createElement("li");
    item.textContent = text;
    eventsBox.appendChild(item);
  }

  function hello() {
    if (!nonce) window.parent.postMessage({ source: SOURCE, v: VERSION, type: "hello", id: id }, "*");
  }

  function send(type, extra) {
    if (!parentOrigin) return;
    var message = Object.assign({ source: SOURCE, v: VERSION, type: type, id: id, nonce: nonce }, extra || {});
    window.parent.postMessage(message, parentOrigin);
    note(type + " " + JSON.stringify(extra || {}));
  }

  function later(ms, run) {
    setTimeout(run, ms);
  }

  function steps(names, gap, done) {
    names.forEach(function (name, index) {
      later(gap * (index + 1), function () {
        send("step", { step: name });
      });
    });
    later(gap * (names.length + 1), done);
  }

  function showFinish() {
    finishButton.hidden = false;
    statusBox.textContent = "Pantalla final de la página alojada.";
  }

  function okFlow(finalStatus) {
    steps(["intro", "front", "back", "liveness", "processing"], 700, function () {
      send("completed", { status: "processing" });
      later(5000, function () {
        send("step", { step: "done" });
        send("completed", { status: finalStatus });
        showFinish();
      });
    });
  }

  function hostile() {
    var target = parentOrigin;
    var base = { source: SOURCE, v: VERSION, id: id };
    window.parent.postMessage(Object.assign({}, base, { type: "step", step: "front", nonce: "mal" }), target);
    window.parent.postMessage(Object.assign({}, base, { type: "completed", status: "verified", id: "idv_" + "0".repeat(24), nonce: nonce }), target);
    window.parent.postMessage(Object.assign({}, base, { type: "step", step: "intro", nonce: nonce, person: { name: "no debe llegar" } }), target);
    window.parent.postMessage({ type: "ready", nonce: nonce }, target);
    okFlow("verified");
  }

  var flows = {
    ok: function () {
      okFlow("verified");
    },
    declined: function () {
      okFlow("declined");
    },
    camera: function () {
      send("step", { step: "front" });
      later(300, function () {
        send("fallback", { reason: "camera_blocked" });
      });
      later(15000, function () {
        send("completed", { status: "processing" });
      });
    },
    storage: function () {
      send("step", { step: "intro" });
      later(300, function () {
        send("fallback", { reason: "storage_blocked" });
      });
    },
    unsupported: function () {
      send("step", { step: "intro" });
      later(300, function () {
        send("fallback", { reason: "unsupported" });
      });
    },
    unavailable: function () {
      send("step", { step: "unavailable" });
    },
    slow: function () {
      okFlow("verified");
    },
    hostile: hostile,
    reload: function () {
      var reloaded = false;
      try {
        reloaded = window.sessionStorage.getItem(RELOAD_KEY) === "1";
        window.sessionStorage.setItem(RELOAD_KEY, "1");
      } catch (_) {
        reloaded = true;
      }
      if (reloaded) okFlow("verified");
      else later(800, function () {
        window.location.reload();
      });
    },
  };

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.source !== SOURCE || data.v !== VERSION || data.id !== id) return;
    if (data.type === "init") {
      if (parentOrigin && (event.origin !== parentOrigin || data.nonce !== nonce)) return;
      parentOrigin = event.origin;
      nonce = data.nonce;
      statusBox.textContent = "Conectado con " + parentOrigin;
      send("ready");
      if (!started) {
        started = true;
        (flows[scenario] || flows.ok)();
      }
    } else if (data.type === "close" && event.origin === parentOrigin && data.nonce === nonce) {
      note("close del padre");
    }
  });

  finishButton.addEventListener("click", function () {
    send("close");
  });

  if (scenario === "silent") {
    statusBox.textContent = "Este escenario nunca dice hello.";
  } else {
    var delay = scenario === "slow" ? 25000 : 0;
    HELLO_DELAYS_MS.forEach(function (ms) {
      later(delay + ms, hello);
    });
  }
})();
