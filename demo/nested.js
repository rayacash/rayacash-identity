// El iframe va a localhost (otro sitio que 127.0.0.1) y sin allow, a propósito.
document.getElementById("nested").src = "http://localhost:" + window.location.port + "/demo/index.html";
