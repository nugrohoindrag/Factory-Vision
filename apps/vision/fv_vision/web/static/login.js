"use strict";
const form = document.getElementById("form");
const error = document.getElementById("error");
const submit = document.getElementById("submit");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.textContent = "";
  submit.disabled = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-FV-Request": "1" },
      body: JSON.stringify({ username: form.username.value, password: form.password.value }),
    });
    if (res.ok) { location.href = "/"; return; }
    const body = await res.json().catch(() => ({}));
    error.textContent = body?.error?.message || "Gagal masuk";
  } catch (err) {
    error.textContent = "Server tidak dapat dihubungi";
  } finally {
    submit.disabled = false;
  }
});
